// Builds docs/site/index.html: embeds docs/*.md into template.html as JSON.
// Usage: node docs/site/build.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, '..');

const files = readdirSync(docsDir)
  .filter((f) => f === 'README.md' || /^\d\d-[\w-]+\.md$/.test(f))
  .sort((a, b) => (a === 'README.md' ? -1 : b === 'README.md' ? 1 : a.localeCompare(b)));

const docs = files.map((file) => {
  const md = readFileSync(join(docsDir, file), 'utf8');
  const heading = md.match(/^#\s+(.+)$/m);
  const id = file === 'README.md' ? 'start' : `m${file.slice(0, 2)}`;
  return { id, file, title: heading ? heading[1].trim() : file, md };
});

// Escape "<" so the JSON cannot close the <script> tag it is embedded in.
const json = JSON.stringify(docs)
  .replace(/</g, '\\u003c');

const template = readFileSync(join(here, 'template.html'), 'utf8');
if (!template.includes('__DOCS_JSON__')) {
  throw new Error('template.html is missing the __DOCS_JSON__ placeholder');
}

// Function replacer: markdown contains "$" sequences that String.replace would interpret.
writeFileSync(join(here, 'index.html'), template.replace('__DOCS_JSON__', () => json));
console.log(`Built docs/site/index.html from ${docs.length} files: ${files.join(', ')}`);
