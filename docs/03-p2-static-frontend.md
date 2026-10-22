# Module 3 · P2 · Static frontend on the edge (Next.js)

Give P1 a web UI: a Next.js static export served from a **private** S3 bucket through
**CloudFront**. Small app, lots of AWS concepts: origins, origin access control, cache
behavior, edge functions, CORS.

**Time:** 1 weekend · **Cost:** ≈ $0 (CloudFront always-free: 1 TB out + 10M requests/month)

## What you'll learn

| AWS | ECC |
|---|---|
| S3 as a private origin; why not the S3 website endpoint | Adding the `typescript` rule pack only when you need it |
| CloudFront distributions, origins, behaviors, cache policies, TTLs | `frontend-design` skill for UI direction |
| Origin Access Control (OAC) + bucket policy with `AWS:SourceArn` | `/ecc:react-test` (Testing Library, Vitest) |
| CloudFront Functions (viewer-request rewrite) | `/ecc:react-review` + `ecc:typescript-reviewer` |
| CORS on API Gateway HTTP APIs, and who actually enforces it | ECC's bundled **chrome-devtools MCP** for a real browser check + Lighthouse |
| Cache-Control strategy and invalidations | Terragrunt cross-project `dependency` |

## Architecture

```
                  ┌──────────────── CloudFront distribution ─────────────────┐
 browser ───────► │ viewer-request: CF Function (append index.html)          │
                  │ default behavior ──► S3 origin (private, OAC, SigV4)     │
                  │ /_next/static/*  ──► same origin, 1-year immutable cache │
                  └──────────────────────────────────────────────────────────┘
     │
     │ fetch() with Origin: https://dxxxx.cloudfront.net
     ▼
 P1 HTTP API (CORS allow_origins = [cloudfront domain]) ──► Lambda ──► DynamoDB
```

## Cost

| Resource | Here |
|---|---|
| S3 | A few MB, cents at most |
| CloudFront | Always free up to 1 TB/month + 10M requests; PriceClass_100 |
| Invalidations | First 1,000 paths/month free; `/*` counts as one path |

## Steps

### M1 · Plan + rules

```bash
cp -R ~/.claude/plugins/cache/ecc/ecc/2.2.3/rules/typescript .claude/rules/ecc/
```

```
/ecc:plan P2: Next.js static export in apps/p2-web that calls the P1 API.
- Home page: form to shorten a URL, shows the short link and a copy button.
- /stats?code=… page: shows url, clicks, createdAt from GET /links/{code}.
- next.config: output 'export', trailingSlash true. API base URL from NEXT_PUBLIC_API_URL at build time.
- Infra: private S3 bucket + CloudFront with OAC, a CloudFront Function for index.html
  rewrites, PriceClass_100, managed cache policies. P1's HTTP API gets CORS for the
  CloudFront domain only.
Explain why the S3 static website endpoint is NOT used.
```

Things to check in the plan: dynamic routes like `/s/[code]` don't work with
`output: 'export'` unless every code is known at build time. That's why stats use a query
string. Did the plan notice?

### M2 · UI, test-first

Use the `frontend-design` skill for direction, then:

```
/ecc:react-test build the shorten form: validates URL client-side, calls POST /links,
shows the result, handles 400 and network errors. Mock fetch in tests.
```

```
/ecc:react-test build /stats: reads ?code, calls GET /links/{code}, renders loading,
not-found, and error states.
```

### M3 · Infra: bucket + distribution

Write `infra/modules/static-site`. Key resources:

```hcl
resource "aws_s3_bucket" "site" {
  bucket        = "${var.project}-${var.env}-${var.name}-${data.aws_caller_identity.me.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project}-${var.env}-${var.name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "site" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_cloudfront_function" "index_rewrite" {
  name    = "${var.project}-${var.env}-${var.name}-index"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/index-rewrite.js") # a real file: easy to test with node
}
```

```js
// index-rewrite.js: /stats/ -> /stats/index.html, /stats -> /stats/index.html.
// Only the LAST segment decides "is this a file?", so /v1.2/docs is still a directory.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!lastSegment.includes('.')) {
    request.uri = uri + '/index.html';
  }
  return request; // the query string (?code=...) is not part of uri, so it survives
}
```

Then the distribution: S3 origin with `origin_access_control_id`, default behavior with
the managed **CachingOptimized** cache policy, the function on `viewer-request`,
`viewer_protocol_policy = "redirect-to-https"`, `default_root_object = "index.html"`,
`price_class = "PriceClass_100"`, a `custom_error_response` for 403/404 → `/404.html`,
and the managed **SecurityHeadersPolicy** response headers policy. Look up managed
policy IDs with `data "aws_cloudfront_cache_policy"` by name rather than hardcoding them.

Review before applying, with security focus:

```
> Use ecc:security-reviewer on infra/modules/static-site. Can anything read the bucket except this distribution?
```

What the built module (`infra/modules/static-site`) adds on top of the snippet above:

- `aws_s3_bucket_ownership_controls` = `BucketOwnerEnforced`: already the default for new
  buckets, but explicit says "ACLs are off; only policies decide access".
- A second bucket-policy statement denying any request with `aws:SecureTransport = false`.
  OAC and `aws s3 sync` both use HTTPS, so nothing legitimate is affected.
- The bucket policy references the distribution ARN, so Terraform creates the distribution
  first and the policy last (`plan` shows the policy document as "read during apply").
- Mapping 403 → `/404.html` has a cost: a broken bucket policy also looks like a 404 page.
  When debugging, `curl -sI` the S3 object directly or check CloudFront's `x-cache` header.
- Expect `minimum_protocol_version = "TLSv1"` in the plan: the default `*.cloudfront.net`
  certificate can't be raised. A custom domain + ACM certificate can (`TLSv1.2_2021`).

### M4 · CORS on P1 (cross-project dependency)

Add `cors_origins` to the `http-api` module:

```hcl
cors_configuration {
  allow_origins = var.cors_origins
  allow_methods = ["GET", "POST"]
  allow_headers = ["content-type"]
  max_age       = 3600
}
```

In `infra/live/dev/p1-shortener/api/terragrunt.hcl`:

```hcl
dependency "web" {
  config_path  = "../../p2-web/site"
  mock_outputs = { domain_name = "example.cloudfront.net" }
  # Without this, an apply while P2 isn't deployed would silently allow the fake origin.
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  # ...existing inputs
  cors_origins = ["https://${dependency.web.outputs.domain_name}", "http://localhost:3000"]
}
```

The dependency direction matters: P1's API depends on P2's distribution, never the
reverse, so there's no cycle. The web app gets the API URL at **build** time, not from
Terraform.

Two details that bite:

- An origin is `scheme://host[:port]`, with **no trailing slash**. The browser sends
  `Origin: https://d111.cloudfront.net`, so `https://d111.cloudfront.net/` never matches and
  CORS fails with no hint why. The module rejects that (and `"*"`) with a `validation` block.
- With `cors_configuration` set, API Gateway answers `OPTIONS` preflights itself: no route,
  no Lambda invocation, no Lambda bill. It also adds `Access-Control-Allow-Origin` and
  `Vary: Origin` to the Lambda's responses, so the Go code needs no CORS logic.

Check it after the apply:

```bash
api=$(cd infra/live/dev/p1-shortener/api && terragrunt output -raw api_endpoint)
curl -si -X OPTIONS "$api/links" -H "Origin: https://<your-domain>.cloudfront.net" \
  -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" \
  | grep -iE '^HTTP|^access-control'                  # 204 + allow-origin = your domain
curl -si -X OPTIONS "$api/links" -H "Origin: https://evil.example" \
  -H "Access-Control-Request-Method: POST" | grep -iE '^HTTP|^access-control'   # no allow-origin
```

### M5 · Deploy

Infra first (you apply): `p2-web/site`, then `p1-shortener/api` to pick up the CORS origin.
Then publish with `apps/p2-web/deploy.sh`:

```bash
DRY_RUN=1 apps/p2-web/deploy.sh   # build and list what would change in S3; changes nothing
apps/p2-web/deploy.sh             # publish, invalidate, then check 4 URLs
```

It reads Terragrunt outputs (it never applies), runs the tests, builds with
`NEXT_PUBLIC_API_URL`, and uploads. Why it looks the way it does:

| Choice | Why |
|---|---|
| `_next/static/*` → `public, max-age=31536000, immutable`; the rest → `no-cache` | Hashed names change when content changes, so they can be cached forever. HTML keeps its URL, so browsers must revalidate (cheap 304s via ETag). |
| Upload order: hashed assets, `.txt` payloads, HTML last, then delete stale pages | A visitor mid-deploy never gets HTML pointing at files that aren't there yet. Old chunks are kept so open tabs keep working. |
| Explicit `--content-type` per extension; unknown extension = stop | The CLI guesses types from the OS (the registry on Windows). With the `nosniff` header a mislabeled `.js` won't run, and in a static export a `.txt` payload that isn't `text/plain` makes Next.js fall back to full page loads on every click. |
| The delete pass uses `--size-only` | It must only delete; mtime-based sync could re-upload with guessed types. |
| Invalidate `/*` and wait | HTML is `no-cache` already; this clears cached error pages. `/*` is one path (1,000 free/month). `MSYS_NO_PATHCONV=1` stops Git Bash rewriting `/*`. |
| `terragrunt output` errors are shown, not swallowed | "SSO expired" and "not applied" need different fixes. |

### M6 · Verify in a real browser with ECC's chrome-devtools MCP

ECC bundles a Chrome DevTools MCP server. Ask:

```
> Use the chrome-devtools MCP: open the CloudFront URL, shorten https://aws.amazon.com,
> open the stats page for the new code, then list console errors and the network requests
> to the API with their status and CORS headers. Then run a Lighthouse audit.
```

Then break CORS on purpose (remove the CloudFront origin, apply) and look at what the
browser reports versus what `curl` reports. curl still works, because CORS is enforced
by browsers, not by the API.

**What this check found:** one console error, a 404 for
`stats/__next.stats.__PAGE__.txt` (Lighthouse Best Practices 96). The export had written
`stats/__next.stats/__PAGE__.txt`. It's a Next.js 16 bug that only happens when building on
**Windows** ([vercel/next.js#85374](https://github.com/vercel/next.js/issues/85374)): the
export collects segment files with `path.relative()`, which returns backslashes on Windows,
and the file-name encoder only turns `/` into `.`. The router then gets a 404 for the
segment prefetch and falls back to the whole page payload (`stats/index.txt`), so it still
works, just slower and noisier. `deploy.sh` renames those files after the build
(`flatten_segment_dirs`); on Linux/macOS builds it does nothing. After the fix: no console
errors, Lighthouse 100 on every category.

Lesson: "works in the browser" isn't "works as designed". Read the network panel, not just
the page.

### M7 · Review, verify, learn

```
/ecc:react-review                 # or the ecc:react-reviewer agent on apps/p2-web
> Use ecc:code-reviewer on infra/modules/{static-site,http-api}, the two units and deploy.sh.
> Work out the exact teardown order.
ecc:verification-loop
/ecc:learn-eval
```

What the reviews caught here, all fixed test-first:

- Fields from the API landed in `href`s without a scheme check. P1 validates URLs today, but
  the client shouldn't depend on it: the zod schemas now require `http(s)` URLs, a 7-character
  code and an ISO timestamp, so a `javascript:` destination is rejected, never rendered.
- A build without `NEXT_PUBLIC_API_URL` showed "Can't reach the API" (the config error was
  thrown inside the `try` that maps network errors). Now it says what's actually wrong.
- The "not found" message had no live region, so screen readers announced nothing.
- `deploy.sh`: swallowed `terragrunt output` errors, a `curl` timeout that would silently
  abort the final checks under `set -e`, and HTML uploaded before its `.txt` payloads.

---

## Check yourself (no Claude)

1. OAC vs the legacy OAI vs a public bucket website endpoint: which can serve a private bucket, and why can't the website endpoint use OAC?
2. What is in CloudFront's cache key by default with CachingOptimized? What breaks if you add all query strings to it?
3. Why can fingerprinted `/_next/static/*` files be cached for a year but HTML can't?
4. CORS: who sends the preflight, who answers it, who enforces the result?
5. A user sees an old version after deploy. List three possible causes.
6. Why must an ACM certificate for CloudFront be created in `us-east-1`?

## Stretch goals

- **Single origin, no CORS:** add the HTTP API as a second CloudFront origin with a `/links*` behavior using the managed `CachingDisabled` + `AllViewerExceptHostHeader` policies. Delete the CORS config. Compare the two designs in an ADR.
- Custom domain: Route 53 hosted zone ($0.50/month) + ACM cert in us-east-1 + alias record.
- Add a Playwright smoke test with `ecc:e2e-testing` that runs against the deployed URL.

## Teardown

Idle cost is ~$0, so keep it if you like. P1's `api` unit depends on P2's `site` unit
(for the CORS origin), so the order matters.

**Everything (P1 and P2).** Run from `infra/live/dev`, so Terragrunt sees both projects and
orders the destroy itself: `api` before `site`, `fn` before `table`.

```bash
cd infra/live/dev
terragrunt run --all -- plan -destroy   # read it first; run it in a shell without personal env vars
terragrunt run --all destroy
```

Per project also works, P1 first: `cd infra/live/dev/p1-shortener && terragrunt run --all destroy`,
then the same in `p2-web`. P2 first also works, because `destroy` may use the mock output.

**Only P2, keeping P1.** Unhook P1 first:

1. In `infra/live/dev/p1-shortener/api/terragrunt.hcl`, remove the `dependency "web"` block
   and the CloudFront entry in `cors_origins` (keep `http://localhost:3000`), then
   `terragrunt apply` that unit.
2. `cd infra/live/dev/p2-web && terragrunt run --all destroy`

Why: with P2 gone, `plan` and `destroy` on P1's `api` still work (they may use the mock
domain), but `apply` and `output` don't, because they aren't in
`mock_outputs_allowed_terraform_commands`. And until you apply, the live API keeps allowing
a CloudFront domain that no longer exists.

CloudFront distributions take several minutes to disable and delete; `force_destroy = true`
empties the bucket. That's normal.
