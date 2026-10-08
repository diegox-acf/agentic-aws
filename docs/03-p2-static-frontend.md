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
  code    = <<-JS
    function handler(event) {
      var req = event.request;
      if (req.uri.endsWith('/')) { req.uri += 'index.html'; }
      else if (!req.uri.includes('.')) { req.uri += '/index.html'; }
      return req;
    }
  JS
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
}

inputs = {
  # ...existing inputs
  cors_origins = ["https://${dependency.web.outputs.domain_name}", "http://localhost:3000"]
}
```

The dependency direction matters: P1's API depends on P2's distribution, never the
reverse, so there's no cycle. The web app gets the API URL at **build** time, not from
Terraform.

### M5 · Deploy

```bash
root=$(git rev-parse --show-toplevel)
live=$root/infra/live/dev

(cd "$live/p2-web/site" && terragrunt apply)
bucket=$(cd "$live/p2-web/site" && terragrunt output -raw bucket_name)
dist=$(cd "$live/p2-web/site" && terragrunt output -raw distribution_id)
(cd "$live/p1-shortener/api" && terragrunt apply)             # picks up the CORS origin
export NEXT_PUBLIC_API_URL=$(cd "$live/p1-shortener/api" && terragrunt output -raw api_endpoint)

cd "$root/apps/p2-web"
pnpm build                                                    # -> out/
# long cache for fingerprinted assets, no-cache for HTML
aws s3 sync out/_next/static "s3://$bucket/_next/static" --cache-control "public,max-age=31536000,immutable"
aws s3 sync out "s3://$bucket" --delete --exclude "_next/static/*" --cache-control "no-cache"
# MSYS_NO_PATHCONV stops Git Bash from turning "/*" into a Windows path
MSYS_NO_PATHCONV=1 aws cloudfront create-invalidation --distribution-id "$dist" --paths "/*"
```

Put this in `apps/p2-web/deploy.sh` once it works.

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

### M7 · Review, verify, learn

```
/ecc:react-review
ecc:verification-loop
git commit -m "feat(p2): static frontend on cloudfront"
/ecc:learn-eval
```

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

Idle cost is ~$0, so keep it if you like. Otherwise:

1. In `infra/live/dev/p1-shortener/api/terragrunt.hcl`, remove the `dependency "web"` block
   and the CloudFront origin from `cors_origins`, then `terragrunt apply` that unit. (If you
   destroy P2 first, the dependency has no outputs to read and P1's api unit errors.)
2. Then:

   ```bash
   cd infra/live/dev/p2-web && terragrunt run --all destroy
   ```

CloudFront distributions take several minutes to disable and delete. That's normal.
