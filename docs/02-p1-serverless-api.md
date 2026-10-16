# Module 2 · P1 · Serverless URL shortener (Go)

A URL shortener is small enough to finish in a weekend and touches the core serverless
trio: **Lambda + API Gateway + DynamoDB**. P2 puts a frontend on it and P4 adds auth, so
keep it running after you finish.

**Time:** 1–2 weekends · **Cost:** ≈ $0 idle, cents under use

## What you'll learn

| AWS | ECC |
|---|---|
| Lambda execution model: cold starts, handler lifecycle, `provided.al2023` custom runtime, arm64 | `/ecc:plan` with a real requirements list, and rejecting parts of a plan |
| IAM execution roles: trust policy vs permission policy, least privilege to one table ARN | `/ecc:go-test` TDD loop (table-driven tests, fakes behind interfaces) |
| API Gateway **HTTP API** vs REST API vs Lambda Function URL | `/ecc:go-review` in a fresh subagent |
| DynamoDB key design, conditional writes, atomic counters, TTL | `ecc:security-reviewer` on IAM + input validation |
| CloudWatch Logs retention, Logs Insights, metric alarms | `ecc:verification-loop` PASS/FAIL before commit |
| Throttling as both a security and a cost control | `/ecc:learn-eval` and growing your `aws-terraform` skill |

## Architecture

```
            ┌──────────────────────────── AWS us-east-1 ───────────────────────────┐
 client ──► │ API Gateway HTTP API ──► Lambda (Go, arm64) ──► DynamoDB "links"     │
  curl      │  POST /links             bootstrap binary       pk: code (S)         │
  browser   │  GET  /{code}  (301)     role: Get/Put/Update   url, createdAt,      │
            │  GET  /links/{code}       on table ARN only     clicks, expiresAt    │
            │  stage throttling                │                (TTL)              │
            │                                  ▼                                   │
            │                       CloudWatch Logs (7d) ──► alarm on Errors ► SNS │
            └──────────────────────────────────────────────────────────────────────┘
```

## Cost

| Resource | Pricing | Here |
|---|---|---|
| Lambda | Always free: 1M requests + 400k GB-s/month | $0 |
| DynamoDB on-demand | Always free 25 GB storage; on-demand requests are cents per million | ~$0 |
| HTTP API | ~$1.00 per million requests (no free tier on post-2025 accounts) | ~$0 |
| CloudWatch Logs | 5 GB ingest free | $0 with 7-day retention |

Idle cost is zero, so you can leave P1 deployed for P2 and P4.

## Repo layout

```
apps/p1-shortener/
├── go.mod
├── cmd/lambda/main.go             # wiring only: deps -> router, lambda.Start(httpadapter.NewV2(router))
├── cmd/local/main.go              # same wiring on :8080, for curl against the real table
├── internal/links/                # domain (the port): Link, Store interface, codes, URL validation, Service
│   ├── link.go  code.go  service.go
│   └── *_test.go                  # incl. fake_store_test.go, the in-memory Store
├── internal/httpapi/              # chi router: HTTP <-> links.Service (plain net/http handlers)
│   ├── router.go
│   ├── router_test.go             # httptest, no AWS
│   └── lambda_bridge_test.go      # API Gateway v2 events through httpadapter
├── internal/store/                # DynamoDB adapter implementing links.Store
│   ├── dynamo.go
│   ├── dynamo_test.go             # fake client, asserts the requests sent
│   └── dynamo_integration_test.go # real table, only when P1_TABLE is set
├── build.sh
└── smoke.sh                       # end-to-end check against the deployed API
infra/modules/
├── dynamodb-table/
├── lambda-function/               # reused in P3
└── http-api/
infra/live/dev/p1-shortener/
├── table/terragrunt.hcl
├── fn/terragrunt.hcl              # depends on table
└── api/terragrunt.hcl             # depends on fn
```

---

## M1 · Plan (30 min)

```
/ecc:plan P1 URL shortener in apps/p1-shortener (Go) with infra under infra/.
Requirements:
- POST /links {url} -> 201 {code, shortUrl}. Only http/https URLs, max 2048 chars.
- GET /{code} -> 301 to the URL, increments a click counter atomically.
- GET /links/{code} -> {url, clicks, createdAt}.
- Codes: 7 chars base62, random; retry on collision using a conditional write.
- Links expire after 30 days via DynamoDB TTL.
- Lambda provided.al2023 on arm64, HTTP API, DynamoDB on-demand.
- Follow the aws-terraform skill. Cost must stay ~$0.
Before the step list, compare HTTP API vs REST API vs Lambda Function URL for this.
```

Read the plan critically:

- Did it pick the right API option and say why? (HTTP API: cheaper, simpler, JWT authorizers built in, which you'll need in P4. REST API: usage plans, API keys, request validation, WAF directly. Function URL: free but no routing/throttling/authorizers.)
- Did it put the store behind an interface so the handler is testable without AWS?
- Is anything hourly-billed? It shouldn't be.

Ask for an ADR of the API decision: `use ecc:architecture-decision-records to write docs/adr/0001-http-api.md`.

## M2 · DynamoDB table (you write it)

Write `infra/modules/dynamodb-table` yourself: inputs `project`, `env`, `name`,
`hash_key`, `ttl_attribute` (nullable); `billing_mode = "PAY_PER_REQUEST"`; outputs
`name` and `arn`. Then:

```
> Review infra/modules/dynamodb-table with the ecc:code-reviewer agent against the aws-terraform skill.
```

Unit `infra/live/dev/p1-shortener/table/terragrunt.hcl`:

```hcl
include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/dynamodb-table"
}

inputs = {
  name          = "links"
  hash_key      = "code"
  ttl_attribute = "expiresAt"
}
```

Apply it, then play with the table **by hand** before writing any Go. This is where
DynamoDB starts to make sense:

```bash
t=agentic-aws-dev-links
aws dynamodb put-item --table-name "$t" \
  --item '{"code":{"S":"abc1234"},"url":{"S":"https://aws.amazon.com"},"clicks":{"N":"0"}}'
# conditional write: run it twice, the second fails with ConditionalCheckFailedException
aws dynamodb put-item --table-name "$t" --condition-expression "attribute_not_exists(code)" \
  --item '{"code":{"S":"abc1234"},"url":{"S":"https://x.com"}}'
# atomic counter
aws dynamodb update-item --table-name "$t" --key '{"code":{"S":"abc1234"}}' \
  --update-expression "ADD clicks :one" --expression-attribute-values '{":one":{"N":"1"}}' \
  --return-values UPDATED_NEW
```

(Single quotes keep the JSON literal in bash. For bigger items, use `--item file://item.json`.)

## M3 · Go code, test-first

### Decide the libraries first

Before any Go, settle the stack and record it:
`use ecc:architecture-decision-records to write docs/adr/0002-...`. This repo chose
([ADR-0002](adr/0002-p1-go-libraries-and-structure.md)):

- **One Lambda** for all routes, ports-and-adapters layout (`links` / `httpapi` / `store` / `cmd`).
- **chi** router with plain `net/http` handlers, bridged to Lambda by
  **`aws-lambda-go-api-proxy/httpadapter.NewV2`**. Handlers then run under `httptest` and
  `go run ./cmd/local`, not only inside Lambda.
- **Explicit API Gateway routes** (no `$default`), so unknown paths 404 without invoking Lambda.
- **aws-sdk-go-v2** with `attributevalue` and the **`expression` builder**.
- Standard `testing` + `go-cmp`.

The alternative is a handler that switches on `routeKey` over raw
`events.APIGatewayV2HTTPRequest`: zero dependencies, but every test builds event structs and
nothing runs outside Lambda. The ADR lists why it lost.

### Domain and HTTP adapter

```
/ecc:go-test implement internal/links: Service with Create(ctx, rawURL), Resolve(ctx, code)
and Stats(ctx, code), behind a Store interface. Table-driven tests first with an in-memory
fake store. Cases: valid https URL, ftp URL rejected, javascript: URL rejected, >2048 chars
rejected, collision on first two attempts then success, unknown code -> ErrNotFound,
expired link -> ErrNotFound.
```

Watch the red → green cycle. Then the HTTP adapter:

```
/ecc:go-test implement internal/httpapi per ADR-0002: a chi router (plain net/http handlers)
for POST /links, GET /{code}, GET /links/{code} on top of a LinkService interface. Test with
httptest: each route, bad JSON -> 400, body over 8 KiB -> 400, ErrNotFound -> 404, unexpected
error -> 500 with no internal details in the body (logged instead). Add a test that drives the
router through httpadapter.NewV2 with API Gateway v2 events, including a base64 body.
```

Two details worth noticing in the result: the redirect sends `Cache-Control: no-store`
(browsers cache 301s forever and would skip your click counter), and `shortUrl` is built from
the request host, which the adapter sets to the API Gateway domain.

### DynamoDB adapter (you write it)

Write `internal/store/dynamo.go` **yourself** (aws-sdk-go-v2 `dynamodb`,
`feature/dynamodb/attributevalue`, `feature/dynamodb/expression`). It is the part that teaches
you the API: `PutItem` with `ConditionExpression`, `GetItem`, `UpdateItem` with `ADD`, mapping
`*types.ConditionalCheckFailedException` to a domain error with `errors.As`.

Then review it against this checklist. Each item is a bug that compiles fine and fails only
against the real table:

| Check | Why |
|---|---|
| `var _ links.Store = (*Dynamo)(nil)` | Nothing else checks the interface until `cmd/lambda` |
| Struct tag is `dynamodbav`, on a private `item` struct in `store` | A misspelled tag is silently ignored (attributes get Go field names, so `PutItem` misses the `code` key); tags on `links.Link` would leak storage names into the domain |
| `expiresAt` is a **Number** of epoch seconds (`dynamodbav:"expiresAt,unixtime"`) | TTL silently skips items whose attribute is missing, misnamed, or a String |
| `PutItem` has `attribute_not_exists(code)` | `PutItem` is an upsert: a collision overwrites someone's link |
| `UpdateItem` has `attribute_exists(code) AND expiresAt > :now` | `UpdateItem` is an upsert too, and the TTL sweep is eventual (expired items stay readable for a while) |
| `ReturnValues: ALL_NEW` | `UPDATED_NEW` returns only `clicks`, so the redirect has no URL |
| Only a failed condition maps to `ErrNotFound` / `ErrCodeTaken`; everything else is wrapped with `%w` | Otherwise a DynamoDB outage looks like a 404 |
| `GetItem` with `ConsistentRead` | Default reads are eventually consistent: stats right after create could 404 |

Make `NewDynamo` accept a small interface with the three methods you use
(`*dynamodb.Client` satisfies it) so unit tests can pass a fake and assert the requests. Add
an integration test that skips unless `P1_TABLE` is set, and run it against the real table:

```bash
cd apps/p1-shortener
P1_TABLE=agentic-aws-dev-links AWS_PROFILE=learn-admin go test -count=1 -run Integration -v ./internal/store/
```

Give test items an `expiresAt` within the hour and let TTL delete them, instead of deleting.

Useful skills to pull in by name: `ecc:golang-patterns`, `ecc:golang-testing`,
`ecc:hexagonal-architecture` (the Store interface is a port, Dynamo is an adapter).

### Wiring and build

`cmd/lambda/main.go` and `cmd/local/main.go` contain wiring only: read `TABLE_NAME` (fail fast
if it is empty), load the AWS config, then `dynamodb.Client` → `store.NewDynamo` →
`links.NewService(store, time.Now, links.NewCode)` → `httpapi.NewRouter`. Lambda hands the
router to `lambda.Start(httpadapter.NewV2(router).ProxyWithContext)`; local runs
`http.ListenAndServe(":8080", router)`, so you can curl the whole API before any Lambda exists:

```bash
cd apps/p1-shortener
TABLE_NAME=agentic-aws-dev-links AWS_PROFILE=learn-admin go run ./cmd/local
```

`build.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# env vars set inline apply to this one command only
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
  go build -tags lambda.norpc -trimpath -ldflags '-s -w' -o dist/bootstrap ./cmd/lambda
```

The binary **must** be named `bootstrap` for the `provided.al2023` runtime. `lambda.norpc`
drops the legacy RPC code path you don't need.

## M4 · Lambda + HTTP API infra

`infra/modules/lambda-function` should create: log group (7-day retention), IAM role
with a trust policy for `lambda.amazonaws.com`, a permission policy built from an input
list of statements, and the function (`runtime = "provided.al2023"`,
`architectures = ["arm64"]`, `handler = "bootstrap"`, code from `archive_file` over an
input `source_dir`). Outputs: `function_name`, `function_arn`, `invoke_arn`, `role_arn`.

The trickiest part of `http-api` is the permission that lets API Gateway invoke Lambda:

```hcl
resource "aws_apigatewayv2_api" "this" {
  name          = "${var.project}-${var.env}-${var.name}"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.lambda_invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "routes" {
  for_each  = toset(var.routes) # ["POST /links", "GET /{code}", "GET /links/{code}"]
  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 20 # protects your wallet as much as your service
    throttling_rate_limit  = 10
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
```

The `fn` unit wires the table in through a dependency:

```hcl
include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/lambda-function"
}

dependency "table" {
  config_path = "../table"
  mock_outputs = {
    name = "mock-table"
    arn  = "arn:aws:dynamodb:us-east-1:111111111111:table/mock-table"
  }
}

inputs = {
  name       = "shortener"
  source_dir = "${get_repo_root()}/apps/p1-shortener/dist"
  env_vars   = { TABLE_NAME = dependency.table.outputs.name }
  policy_statements = [{
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [dependency.table.outputs.arn]
  }]
}
```

Deploy. Claude runs `plan` and summarises it; **you** run `apply` (project `CLAUDE.md` rule):

```bash
apps/p1-shortener/build.sh
cd infra/live/dev/p1-shortener
terragrunt run --all plan    # read it: only creates, nothing hourly-billed
terragrunt run --all apply   # you, not Claude
```

Note how `run --all` applies `table → fn → api` in dependency order.

Then `apps/p1-shortener/smoke.sh` checks it end to end: create a link, expect `301` with the
right `Location`, then expect `clicks` = 1 from the stats route. The core of it (JSON parsed
with `node`, since `jq` isn't installed here):

```bash
api=$(cd infra/live/dev/p1-shortener/api && terragrunt output -raw api_endpoint)
code=$(curl -s -X POST "$api/links" -H "content-type: application/json" \
  -d '{"url":"https://aws.amazon.com/lambda/"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).code')
curl -s -i "$api/$code"      # expect 301 + Location header
curl -s "$api/links/$code"   # clicks should be 1
```

## M5 · Review

```
/ecc:go-review
```

Then a security pass. This is where AWS-specific problems surface:

```
> Use the ecc:security-reviewer agent on apps/p1-shortener and infra/modules/{lambda-function,http-api}.
> Focus: IAM least privilege, open-redirect abuse, input validation, error leakage, abuse/cost controls.
```

Things it should find (if it doesn't, ask about them):

- A URL shortener is an **open redirect by design**. Mitigations: scheme allow-list,
  optional domain deny-list, rate limiting (you have stage throttling).
- Does the role allow `dynamodb:*` or `Resource: "*"`? It shouldn't.
- Do 500 responses leak AWS error messages?
- Is `logs:CreateLogGroup` granted even though Terraform already made the group? Remove it,
  so a typo'd function name can't create unmanaged, never-expiring log groups.

Fix findings, then add each lesson to `.claude/skills/aws-terraform/SKILL.md`.

## M6 · Observability

1. Log JSON with `log/slog`. `httpapi.NewRouter` already takes a `*slog.Logger` (it logs the
   real error behind every 500); in `cmd/lambda` pass
   `slog.New(slog.NewJSONHandler(os.Stdout, nil))`, and add a chi middleware that logs `code`,
   `route`, `status`, `latency_ms` and the request ID for every request.
2. CloudWatch → Logs Insights on `/aws/lambda/agentic-aws-dev-shortener`:

   ```
   fields @timestamp, route, status, latency_ms
   | filter status >= 400
   | stats count() by route, status
   ```

3. Add to the `lambda-function` module: an SNS topic + email subscription and a
   `aws_cloudwatch_metric_alarm` on `AWS/Lambda` `Errors` `Sum > 0` over 5 minutes.
4. Break it on purpose (bad `TABLE_NAME`), watch the alarm fire, read the logs, fix.
5. `> Use ecc:silent-failure-hunter on apps/p1-shortener`. Does any path swallow a DynamoDB error and return 404?

## M7 · Verify, commit, learn

```
ecc:verification-loop          # build, vet, tests + coverage, security grep, diff review
git add -A; git commit -m "feat(p1): serverless url shortener"
/ecc:learn-eval                # save what's reusable (e.g. "Go Lambda build on Windows")
```

---

## Check yourself (no Claude)

1. What's the difference between the role's **trust policy** and its **permission policy**? Which one did `aws_lambda_permission` modify, and on which resource?
2. Why does `GET /{code}` use `UpdateItem ADD` instead of read-increment-write?
3. Your conditional `PutItem` fails. Which exception, and why is retrying with a new code safe?
4. TTL deletes are "eventually" processed. What does that mean for `Resolve` on an expired item?
5. Name two things a REST API gives you that an HTTP API doesn't.
6. Where does a cold start's time go for a Go `provided.al2023` function, and why is it small?
7. Why is a 7-day log retention a cost decision?

## Stretch goals

- Enable X-Ray active tracing on the function and API; find the DynamoDB subsegment.
- Add `GET /links?owner=…` with a GSI on `owner`. You'll need it in P4.
- Benchmark arm64 vs x86_64 duration and price with the same payload.
- Swap HTTP API for a Function URL in a branch; list what you lost.

## Teardown

Keep P1 running; it costs ~$0 idle and P2/P4 build on it. To remove it:

```bash
cd infra/live/dev/p1-shortener
terragrunt run --all -- plan -destroy   # Claude can run this and summarise it
terragrunt run --all destroy           # you run this
```
