# ADR-0002: P1 Go libraries and code structure

**Date**: 2026-10-08
**Status**: accepted
**Deciders**: Diego (with Claude Code)

## Context

P1 (`apps/p1-shortener`) is one Go Lambda behind an HTTP API (ADR-0001) with three routes and a
DynamoDB table. Before writing tests we need to fix the router, the DynamoDB expression style,
the test tooling, and whether the routes share one function. Goals: idiomatic Go, code that can
run locally without Lambda, and few dependencies. Versions below were current on 2026-10-08.

## Decision

- **One Lambda for all three routes** ("Lambdalith"), with a ports-and-adapters layout:
  `internal/links` (domain + `Store` port), `internal/httpapi` (HTTP adapter),
  `internal/store` (DynamoDB adapter), `cmd/lambda` and `cmd/local` (wiring only).
- **Router: `github.com/go-chi/chi/v5`** (v5.3.2). Handlers are plain `net/http`.
- **Lambda bridge: `github.com/awslabs/aws-lambda-go-api-proxy/httpadapter`** (v0.16.2),
  `httpadapter.NewV2(router)`. It takes any `http.Handler`, so `cmd/lambda` does not depend on chi.
- **API Gateway keeps explicit routes** (`POST /links`, `GET /{code}`, `GET /links/{code}`),
  not a `$default` catch-all; chi mirrors them.
- **DynamoDB: `aws-sdk-go-v2`** (`config`, `service/dynamodb`), **`feature/dynamodb/attributevalue`**
  for struct (un)marshalling, and **`feature/dynamodb/expression`** to build condition and update
  expressions.
- **Tests: standard `testing`**, table-driven, `net/http/httptest` for handlers,
  `github.com/google/go-cmp` for struct diffs. No testify.
- **Standard library for the rest:** `net/url` (validation), `crypto/rand` (codes), `log/slog`.

## Alternatives Considered

### Switch on `routeKey` over raw `events.APIGatewayV2HTTPRequest`
- **Pros**: zero dependencies; no request conversion.
- **Cons**: handlers only run inside Lambda (or fake events); tests build event structs; the
  code is coupled to API Gateway's event format.
- **Why not**: we want `go run ./cmd/local` and `httptest`, and handlers that would survive a
  move to Function URL, ALB, or a container.

### `chiadapter.NewV2` from the same proxy library
- **Pros**: one obvious adapter for chi.
- **Cons**: ties `cmd/lambda` to the chi type.
- **Why not**: `httpadapter.NewV2` does the same for any `http.Handler`.

### `$default` catch-all route in API Gateway, all routing in chi
- **Pros**: routes defined once (in Go).
- **Cons**: every unknown path (scanners, typos) invokes and bills the Lambda.
- **Why not**: explicit routes make API Gateway return 404 without invoking Lambda.

### Raw expression strings (`"ADD clicks :one"`)
- **Pros**: identical to the AWS CLI commands; nothing to learn on top.
- **Cons**: names, placeholders, and values are maintained by hand; typos fail only at runtime;
  reserved words need manual `#name` aliases.
- **Why not**: the builder generates placeholders and aliases and keeps values typed.

### One Lambda per route
- **Pros**: least-privilege IAM per route (stats only needs `GetItem`); independent scaling.
- **Cons**: 3× the infra, more cold starts, shared code duplicated in each artifact.
- **Why not**: too much overhead for three tiny routes; revisit in P3.

### testify
- **Pros**: shorter assertions.
- **Cons**: extra dependency; non-idiomatic for table-driven Go tests.
- **Why not**: `testing` + `go-cmp` covers it.

## Consequences

### Positive
- Handlers are ordinary `http.HandlerFunc`s, tested with `httptest`, runnable locally.
- The adapter decodes base64 bodies and sets `r.Host` to the API domain, so `shortUrl` can
  be built from the request without knowing the API URL in advance.
- The DynamoDB adapter has no hand-written placeholder maps.

### Negative
- Routes are declared twice (API Gateway and chi); adding a route means changing both.
- Two more dependencies (chi, api-proxy) and a request/response conversion on every invoke
  (microseconds).
- The shared execution role allows `PutItem`/`UpdateItem` for the read-only stats route.
- The expression builder hides the raw expression; compare with the CLI form when debugging.

### Risks
- `aws-lambda-go-api-proxy` releases are infrequent. Mitigation: it's isolated in
  `cmd/lambda` (about 5 lines); replacing it with a hand-written v2 event → `http.Request`
  conversion would not touch handlers.
- Route drift between API Gateway and chi. Mitigation: the smoke test (`scripts/smoke.sh`)
  calls every route on the deployed API.
