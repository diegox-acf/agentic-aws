# How the tutorial page is built

## TL;DR

- `docs/site/build.mjs` embeds every tutorial Markdown file into one HTML page as JSON. The
  browser renders the Markdown itself, so there's no build dependency and no second file to serve.
- The concept that matters: **escaping depends on context**. The same text needs different
  escaping inside a `<script>` tag, inside HTML, and inside a `String.replace` replacement string.
- The trap: `String.replace(placeholder, someString)` treats `$&`, `$'` and `` $` `` inside
  `someString` as commands. Docs full of shell snippets will hit that.

## Concepts

**Data island.** A `<script type="application/json">` block is never executed. The page reads it
with `JSON.parse(el.textContent)`. That gives you a single self-contained file that works
offline and can be hosted anywhere static. The trade-off: the page has to render Markdown at
runtime, so it depends on a CDN script (marked) and shows plain text if that script is blocked.

**Context-aware escaping.** The browser ends a `<script>` element at the first `</script`, even
inside a JSON string. Escaping `<` as the JSON unicode escape `<` makes that sequence
impossible, and `JSON.parse` turns it back into `<`. The same idea, applied to other contexts:
`&lt;` inside HTML, and a function replacer inside `String.replace`.

**Syntax highlighting is a tree, lines are flat.** highlight.js returns nested `<span>` tags,
and a multi-line comment or string is a single span that crosses newlines. Highlighting
individual lines means cutting that tree at every newline without producing broken HTML.

## Code walkthrough

### 1. Embedding the docs safely

```js title="docs/site/build.mjs" {3,6-8,11}
// Escape "<" so the JSON cannot close the <script> tag it is embedded in.
const json = JSON.stringify(docs)
  .replace(/</g, '\\u003c');

const template = readFileSync(join(here, 'template.html'), 'utf8');
if (!template.includes('__DOCS_JSON__')) {
  throw new Error('template.html is missing the __DOCS_JSON__ placeholder');
}

// Function replacer: markdown contains "$" sequences that String.replace would interpret.
writeFileSync(join(here, 'index.html'), template.replace('__DOCS_JSON__', () => json));
```

Line 3 is the script-context escape. In the regex the target is the literal `<`, and the
replacement `'\\u003c'` writes the six characters `<` into the output. Lines 6–8 fail the
build if someone edits the template and deletes the placeholder; otherwise the build would
"succeed" and ship a page with no content. Line 11 passes a **function** as the replacement,
so the JSON is inserted exactly as is, `$` signs included.

### 2. Splitting highlighted code into lines

This is from the `code-lesson` skill's page template. It's what draws the highlighted lines
in this lesson.

```js title="~/.claude/skills/code-lesson/assets/template.html" {5,8-10,13}
  function splitLines(html) {
    const lines = [];
    const open = [];
    let cur = '';
    const re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<[^>]*>)/g;
    let m;
    while ((m = re.exec(html))) {
      if (m[1]) { open.push(m[1]); cur += m[1]; }
      else if (m[2]) { open.pop(); cur += m[2]; }
      else if (m[3]) { lines.push(cur + '</span>'.repeat(open.length)); cur = open.join(''); }
      else cur += m[4];
    }
    lines.push(cur + '</span>'.repeat(open.length));
    return lines;
  }
```

Line 5 is a tokenizer: every match is an opening span, a closing span, a newline, or a run of
text. Lines 8–9 keep `open` in sync with how deep the tree is at the current position. Line 10
is the trick: at a newline, close everything still open (so the line is valid HTML on its
own), then start the next line by reopening the same spans in the same order. Line 13 does the
same for the last line.

## Patterns, algorithms & data structures

> [!PATTERN]
> **Data island + client-side render**: `docs/site/build.mjs:22-31` with
> `docs/site/template.html` (`<script type="application/json" id="docs-data">`).
> **Why here:** one file to publish, no npm dependencies, Markdown stays the single source of
> truth. **Alternatives:** render to HTML at build time with `marked` as a dependency (no runtime
> CDN, but adds a `package.json` to the repo), or `fetch()` a separate JSON file (two files to
> host and keep in sync).

> [!PATTERN]
> **Fail fast on a contract**: `docs/site/build.mjs:26-28`. The template and the script share
> an implicit contract (the placeholder). Checking it turns a silent bad output into a loud
> build error. It's the same idea as validating config at startup instead of at first use.

> [!ALGORITHM]
> **Span balancing while splitting**: `template.html:356-370`. A single pass over the HTML.
> Each token is visited once, so the scan is **O(n)** in the HTML length. Each newline also
> re-emits the open spans, so the total is **O(n + L·d)** for L lines with nesting depth d. In
> practice d ≤ 3, so it's effectively linear.

> [!DATA-STRUCTURE]
> **Stack**: `open` in `splitLines` (`push` on `<span>`, `pop` on `</span>`). HTML tags nest
> last-in-first-out, which is exactly what a stack models. **Alternative:** walk the real DOM
> with a `TreeWalker` and clone ancestor nodes at each newline. That's more robust to arbitrary
> HTML, but it's more code and slower for something this small.

## Pitfalls

> [!WARNING]
> **`$` in replacement strings.** `'a'.replace('a', "$'")` doesn't insert `$'`; it inserts the
> text *after* the match. Shell snippets (`$HOME`, `$'...'`) are full of these. Always use a
> replacer function when the replacement is data: `s.replace(marker, () => data)`.

> [!CAUTION]
> **Invisible characters in source.** While this builder was being written, a ` `
> escape was saved as the literal U+2028 character, which JavaScript treats as a line break, and
> the regex stopped parsing. The fix was to delete those lines: `JSON.parse` already accepts
> U+2028 inside strings. If a syntax error points at code that looks fine, check for invisible
> characters with `grep -nP '[\x{2028}\x{2029}\x{200B}]'`.

> [!WARNING]
> **Regex over HTML only works for HTML you control.** The tokenizer assumes no `>` inside
> attribute values. That holds for highlight.js output (`<span class="hljs-string">`), but not
> for arbitrary HTML. For untrusted markup, use the DOM.

## Check yourself

1. Why is `<` safe inside the JSON but a literal `</script>` is not, even inside a JSON string?
   <details><summary>Answer</summary>The HTML parser runs before any JavaScript and ends the script element at the first <code>&lt;/script</code> it sees, regardless of JSON quoting. <code><</code> contains no <code>&lt;</code> character, so the HTML parser never sees a tag. <code>JSON.parse</code> decodes it back to <code>&lt;</code> afterwards.</details>
2. What would the page show if `build.mjs` used `template.replace('__DOCS_JSON__', json)` and a doc contained `` $` ``?
   <details><summary>Answer</summary>Everything in the template <em>before</em> the placeholder would be inserted at that point, inside the JSON. The JSON becomes invalid, <code>JSON.parse</code> throws, and the page shows nothing.</details>
3. In `splitLines`, why must the next line *reopen* the spans instead of just continuing?
   <details><summary>Answer</summary>Each line becomes its own <code>&lt;span class="line"&gt;</code> element. A span opened in one line element can't legally continue into the next element, so the styling (for example, a multi-line comment's color) would be lost or the HTML would be malformed.</details>
4. When would you switch from the data-island approach to rendering HTML at build time?
   <details><summary>Answer</summary>When the page must work without third-party scripts (strict CSP, offline intranets), when SEO matters (crawlers see real HTML), or when docs get large enough that client-side parsing is noticeably slow.</details>

## Further reading

- [MDN: `String.prototype.replace`, specifying a string as the replacement](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace#specifying_a_string_as_the_replacement)
- [MDN: `<script>` element, embedding data in HTML](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script#embedding_data_in_html)
- [highlight.js: API (`highlightElement`)](https://highlightjs.readthedocs.io/en/latest/api.html)
