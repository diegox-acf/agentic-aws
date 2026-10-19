# ADR-0003: P2 served from a private S3 bucket via CloudFront OAC; CORS on the P1 API

**Date**: 2026-10-19
**Status**: accepted
**Deciders**: Diego (with Claude Code, `/ecc:plan`)

## Context

P2 is a Next.js static export (`output: 'export'`) that calls the P1 HTTP API from the
browser. It must cost ~$0, keep the bucket private, and serve over HTTPS. A static export has
no server: routing, headers and redirects must come from the hosting layer. The browser
calls a different origin (the execute-api domain), so either the API allows that origin
(CORS) or both are put behind one origin.

## Decision

1. **Origin:** a private S3 bucket (all public access blocked, SSE-S3) read through the
   bucket's **REST endpoint** by a CloudFront distribution using **Origin Access Control**
   (SigV4). The bucket policy allows `s3:GetObject` only to `cloudfront.amazonaws.com` with
   `AWS:SourceArn` equal to this distribution.
2. **Directory indexes:** `trailingSlash: true` in Next.js plus a CloudFront Function on
   viewer-request that appends `index.html`, because the REST endpoint has no index documents.
3. **Errors:** S3 answers 403 (not 404) for missing keys, since the distribution has no
   `s3:ListBucket`. Both 403 and 404 map to `/404.html` with status 404.
4. **Cross-origin calls:** CORS on the P1 HTTP API (`cors_configuration`) allowing only the
   CloudFront domain and `http://localhost:3000`. API Gateway answers preflights itself.

## Alternatives Considered

### Alternative 1: S3 static website endpoint
- **Pros**: index documents and error pages built in; no CloudFront Function.
- **Cons**: the bucket must be **public** (it serves only publicly readable objects); it is
  a custom origin to CloudFront, so it cannot sign requests and **cannot use OAC**; HTTP only
  between CloudFront and S3; anyone can bypass CloudFront and read S3 directly.
- **Why not**: a private bucket is the point of the exercise.

### Alternative 2: Origin Access Identity (OAI)
- **Pros**: works with private buckets.
- **Cons**: legacy; no SSE-KMS, no newer regions, no `PUT`/`POST` to origin; AWS recommends OAC.
- **Why not**: OAC is the current mechanism at the same price ($0).

### Alternative 3: Single origin (API as a second CloudFront origin under `/links*`)
- **Pros**: same origin, so no CORS and no preflight latency; no cross-project dependency.
- **Cons**: more CloudFront configuration (CachingDisabled + AllViewerExceptHostHeader
  policies); hides CORS, which this module exists to teach.
- **Why not now**: kept as the stretch goal; revisit with its own ADR.

## Consequences

### Positive
- Nothing can read the bucket except this distribution; HTTPS end to end.
- `$0`: CloudFront always-free tier (1 TB, 10M requests, 2M function invocations/month).

### Negative
- P1's `api` unit depends on P2's `site` unit (for the CloudFront domain). Apply P2 first;
  tear down by removing the dependency from P1 before destroying P2.
- CORS is enforced by browsers only: it protects users' browsers, not the API. `curl`
  ignores it.
- No CSP from CloudFront: the API domain would have to flow P1 → P2 while CORS already
  flows P2 → P1, which is a dependency cycle.

### Risks
- A stale `index.html` after deploy (edge cache, browser cache). Mitigated by `no-cache` on
  HTML, immutable caching only for fingerprinted `_next/static/*`, and an invalidation per deploy.
