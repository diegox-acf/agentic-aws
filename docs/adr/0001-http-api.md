# ADR-0001: API Gateway HTTP API in front of the P1 shortener Lambda

**Date**: 2026-10-08
**Status**: accepted
**Deciders**: Diego (with Claude Code, `/ecc:plan`)

## Context

P1 is a URL shortener: one Go Lambda (`provided.al2023`, arm64) behind three routes
(`POST /links`, `GET /{code}`, `GET /links/{code}`) backed by DynamoDB. It must cost ~$0,
and P2 (frontend) and P4 (Cognito auth) will build on the same endpoint. A shortener is an
open redirect by design, so it is an abuse target: we need a cheap way to cap request rate.
AWS offers three front doors for a Lambda: API Gateway HTTP API, API Gateway REST API, and a
Lambda Function URL.

## Decision

We use an API Gateway **HTTP API** (payload format 2.0, `AWS_PROXY` integration) with one
route per endpoint and stage-level throttling (10 rps, burst 20) on the `$default` stage.

## Alternatives Considered

### Alternative 1: API Gateway REST API
- **Pros**: usage plans and API keys (per-client quotas), request validation with models,
  direct WAF association, response caching, private endpoints, mapping templates.
- **Cons**: ~$3.50 per million requests vs ~$1.00; many more Terraform resources
  (resource/method/integration per path plus explicit deployments); the response cache bills
  hourly.
- **Why not**: we need none of its extra features now, and it costs 3.5× more per request.

### Alternative 2: Lambda Function URL
- **Pros**: free (only Lambda is billed); one resource; same v2-style event.
- **Cons**: no routing (the Go code must parse paths), no throttling except Lambda reserved
  concurrency (often unavailable on new accounts with a low concurrency limit), auth is only
  `NONE` or `AWS_IAM`, no custom domain without CloudFront.
- **Why not**: no request throttling on a public open redirect, and no JWT authorizer for P4.

## Consequences

### Positive
- Routing lives in API Gateway; the handler switches on `routeKey` and reads path parameters.
- Built-in JWT authorizers make P4 (Cognito) a configuration change, not a rewrite.
- Stage throttling caps both abuse and cost.
- Roughly $0 at learning volumes, nothing billed hourly.

### Negative
- ~$1 per million requests (Function URL would be $0).
- No per-client quotas, request-schema validation, or direct WAF; validation stays in Go.

### Risks
- Throttling is per stage, not per client: one abusive client can use the whole budget and
  starve others. Acceptable for a learning app; revisit (REST API usage plans or WAF via
  CloudFront) if it ever serves real users.
