# TDD evidence: P3 M2 bulk import (apps/p3-importer)

**Source plan:** the Gate 1 plan of `/ecc:orch-add-feature` (2026-10-26), with the decisions
recorded in `docs/adr/0004-p3-import-idempotency-and-upload-limits.md`.
**Checkpoint commits:** deferred. The orch pipeline's Gate 2 (no commit before the user confirms)
overrides tdd-workflow's per-stage commits; this report preserves the RED/GREEN evidence instead.

## User journeys

1. As a client, I POST /imports and get an importId plus a presigned POST that S3 limits to 1 MB of
   text/csv, so I can upload a CSV without sending it through Lambda.
2. As a client, I GET /imports/{importId} and see PENDING, then DONE/FAILED with counts.
3. As the system, I turn each valid URL row into a P1 link exactly once, even if the file is
   delivered twice or the importer crashes halfway, and never overwrite an existing P1 link.
4. As the owner, I get one email per finished import, even if the first SNS publish fails.

## Task report

| Task | RED (command, result) | GREEN (command, result) |
|---|---|---|
| Presign config (`shared/config.ts`) | `pnpm test src/shared/config.test.ts`: `Cannot find module './config'` | same: 10 passed |
| Presign handler + `toView` (scaffold, then body) | `pnpm test`: 20 failed, every one `Error: TODO(user): implement ...` (typecheck + lint clean) | `pnpm test:coverage`: 30 passed, handler 100% lines / 92% branches |
| Domain: url, code, link, s3-event; importer csv | `pnpm test`: 5 files `Cannot find module` | `pnpm test`: 89 passed |
| Importer: links-writer, imports-repo, notify, process-import, handler, importer-config | `pnpm test`: 6 files `Cannot find module` | `pnpm test`: 132 passed |
| Refactor: shared `isImportId`, csv download-error test | n/a | `pnpm test:coverage`: 133 passed |

The presign body was written by Claude at the user's request ("please complete the work"); the
tests were written first, as a contract, before either implementation.

## Test specification (what the passing tests guarantee)

| # | Guarantee | Test file | Type |
|---|---|---|---|
| 1 | Config fails fast, naming every missing or invalid env var | `shared/config.test.ts`, `shared/importer-config.test.ts` | unit |
| 2 | POST writes a PENDING record (30-day TTL) only if the id is new, before presigning | `presign/handler.test.ts` | integration (mocked DynamoDB) |
| 3 | The presigned POST carries `content-length-range [1, MAX]` and `Content-Type = text/csv` for `incoming/<id>.csv` | `presign/handler.test.ts` | integration |
| 4 | GET: 200 view with ConsistentRead; 404 for unknown, expired, non-UUID (no DynamoDB call) and other routes | `presign/handler.test.ts` | integration |
| 5 | AWS errors give a generic 500 that doesn't leak the error, and are logged | `presign/handler.test.ts` | integration |
| 6 | `toView` hides storage fields, treats `expiresAt <= now` as gone, doesn't mutate | `presign/view.test.ts` | unit |
| 7 | URL rules match P1's Go `validateURL` test table, plus the WHATWG-vs-Go gaps | `domain/url.test.ts` | unit |
| 8 | Codes are deterministic, 7-char base62, golden-vector checked, unique over 10,000 rows | `domain/code.test.ts` | unit |
| 9 | Link items have P1's exact shape plus `importId` | `domain/link.test.ts` | unit |
| 10 | Only well-formed "Object Created" events for `incoming/<uuid>.csv` are accepted | `domain/s3-event.test.ts` | unit |
| 11 | CSV: header, CRLF, BOM, blank lines, quoted commas, extra columns, chunk splits, stable numbering, malformed CSV, broken download | `importer/csv.test.ts` | unit |
| 12 | Writes never overwrite: own earlier write recognised (importId + url), foreign code -> next attempt, 3 attempts then collision, other errors rethrown | `importer/links-writer.test.ts` | integration |
| 13 | Status guard: start only from PENDING/PROCESSING, finish only from PROCESSING, missing/finished reported | `importer/imports-repo.test.ts` | integration |
| 14 | Oversized file fails without download; missing file and bad CSV fail; transient errors throw without finishing; redelivery writes nothing new | `importer/process-import.test.ts` | integration |
| 15 | Partial batch failures; full failure throws; SNS failure leaves `notified` unset and the retry announces once | `importer/handler.test.ts` | integration |
| 16 | SNS subject within 100 chars; publish failures rethrown | `importer/notify.test.ts` | integration |

## Coverage and known gaps

`pnpm test:coverage`: **98.14% statements, 92.85% branches, 100% functions, 98.06% lines**
(thresholds 80%). `src/**/index.ts` (client wiring) is excluded; `./build.sh` bundles both
functions and smoke-imports them.

Not covered by automated tests (verified by deploying, M4):
- Real AWS behaviour: presigned POST accepted by S3, IAM policies, the event source mapping.
- End to end S3 -> EventBridge -> SQS: the rule is the user's M3 task; until then
  `test/fixtures/send-object-created.sh` sends the event by hand.
- `terragrunt plan` for the new units could not be run in this session (the command was denied);
  the modules pass `terraform validate` and `fmt -check`.
