# ADR-0004: P3 imports: deterministic codes with conditional writes, presigned POST uploads

**Date**: 2026-10-26
**Status**: accepted
**Deciders**: Diego (with Claude Code, `/ecc:orch-add-feature`, Gate 1)

## Context

P3 adds bulk import to the P1 shortener: a client gets an upload URL from `POST /imports`,
uploads a CSV of URLs straight to S3, and an asynchronous pipeline (S3 → EventBridge → SQS →
Lambda "importer") turns each valid row into a P1 link in P1's `links` table.

Three properties are hard requirements:

1. **Idempotent:** SQS and EventBridge deliver at least once. The same S3 object processed twice
   (or a retry after a crash halfway through the file) must not create duplicate links.
2. **Never overwrite:** an imported link must never replace an existing P1 link. P1 itself
   avoids that with a conditional `PutItem` (`attribute_not_exists(code)`) and 3 retries.
3. **At most 1 MB per upload**, enforced, not just requested. The API has no authentication.

Each SQS delivery gets a new `messageId`, so it cannot identify "the same file"; the object key
`incoming/<importId>.csv` (and so the `importId`) can.

## Decision

1. **Deterministic codes + conditional `PutItem` per row (not `BatchWriteItem`).** Row *n* of
   import *i* gets the 7-character base62 code derived from `SHA-256("<i>:<n>:<attempt>")`, so a
   re-run produces the same codes. Each row is written with `attribute_not_exists(code)`; on a
   failed condition the importer reads the existing item (`ReturnValuesOnConditionCheckFailure:
   ALL_OLD`):
   - its `importId` is ours: an earlier delivery wrote it; count it as created, move on;
   - it belongs to someone else: try `attempt + 1`, up to 3 attempts (like P1), then reject the
     row as a collision.

   Imported items have P1's exact shape plus an `importId` attribute, which P1's Go decoder
   ignores (it unmarshals into a fixed struct).
2. **A status guard on the imports record, not a lock.** The importer moves the record to
   `PROCESSING` only from `PENDING` or `PROCESSING`, skips `DONE`/`FAILED` imports, and finishes
   with a conditional `PROCESSING → DONE|FAILED`. Only the delivery that wins that transition
   notifies. A crashed run leaves `PROCESSING`; the redelivery re-runs from row 1 and every row it
   already wrote resolves as "ours".

   *Added in M5 (silent failures):* if the last delivery (`MAX_RECEIVE_COUNT`, the queue's
   `maxReceiveCount`) throws as well, the importer marks the import `FAILED` with
   `gaveUp = true` and a generic reason ("gave up after 3 deliveries; see the importer logs":
   `GET` is public, and SDK messages can name roles or the account), then lets the message go to
   the DLQ. Without that the record would stay `PROCESSING` until its TTL. A given-up import has no
   counts: only the crashed run knew them, and links it wrote before failing do exist. `start` also accepts a
   given-up import, so a DLQ redrive is a real retry. An import that creates no link at all is
   `FAILED` ("no rows", "every row was rejected"), and the first 10 rejected rows are kept with
   their reasons. A Lambda timeout never reaches the give-up code; M6 handles long files.
3. **Presigned POST with a policy**, not a presigned PUT. `POST /imports` returns
   `{ importId, upload: { url, fields } }`; the policy carries
   `["content-length-range", 1, 1048576]` and `["eq", "$Content-Type", "text/csv"]`, which S3
   enforces at upload. The importer also checks `detail.object.size` before downloading
   (defense in depth, and the one place M6 raises the limit).
4. **Invoke permissions stay `${execution_arn}/*/*` per function.** The route table decides which
   function a request reaches; the permission answers "which API may invoke this function".
5. **Cap the work one unauthenticated request can cause** (added after the security review).
   1 MB of short URLs is ~80,000 rows, i.e. ~80,000 billed writes per upload. So the importer fails
   files over `MAX_ROWS` (1000) and `POST /imports` gets its own route throttle (1 rps, burst 2)
   on top of the stage's 10 rps. The importer runs at most 2 at once (`maximum_concurrency`),
   reads only its configured bucket, and ignores messages about any other.

## Alternatives Considered

### Alternative 1: deterministic codes + `BatchWriteItem` (the original request)
- **Pros**: 25 items per call; teaches the `UnprocessedItems` retry loop.
- **Cons**: `BatchWriteItem` takes **no condition expressions**. A code that collides with a
  random P1 code silently overwrites that link; reprocessing resets `clicks` to 0.
- **Why not**: breaks requirement 2, however unlikely a collision is.

### Alternative 2: `BatchGetItem` pre-check, then `BatchWriteItem`
- **Pros**: keeps batching and the `UnprocessedItems` lesson.
- **Cons**: P1 can create the same code between the check and the write (a race).
- **Why not**: "almost never" is not "never".

### Alternative 3: `TransactWriteItems` in chunks of up to 100
- **Pros**: conditions per item, fewer calls.
- **Cons**: 2× the write capacity; one collision cancels the whole chunk, which then needs
  per-item handling anyway.
- **Why not**: more cost and code for no extra guarantee.

### Alternative 4: Powertools idempotency utility, key `detail.object.key`
- **Pros**: off-the-shelf; handles concurrent duplicates.
- **Cons**: its own DynamoDB table; after a crash the in-progress lock expires and a full
  reprocess with random codes duplicates links. It doesn't address requirement 2 at all.
- **Why not**: deterministic codes already make reprocessing safe.

### Alternative 5: presigned PUT + importer-side size check only
- **Pros**: simplest client (`curl -X PUT --data-binary`); M4's original curl works.
- **Cons**: a presigned PUT can't limit size; anyone who calls `POST /imports` can store up to
  5 GB per URL until the 7-day lifecycle deletes it.
- **Why not**: the limit should be enforced where the bytes arrive.

### Alternative 6: invoke permissions scoped per route
- **Pros**: each function invokable only from its own routes.
- **Cons**: replaces P1's existing permission (`statement_id` and `source_arn` change), with a
  window of 500s unless applied in two steps; P1's `GET /{code}` becomes `*/GET/*`, which
  matches every GET path anyway.
- **Why not**: little real gain for a live-traffic risk.

## Consequences

### Positive
- No duplicates and no overwritten P1 links, by construction; reprocessing is always safe, so
  M6's resumable chunks can be added later without a redesign.
- Uploads over 1 MB, or not `text/csv`, never reach the bucket.

### Negative
- One `PutItem` per row instead of one call per 25 rows: more requests and latency for large
  files (same write capacity cost: 1 WCU per item either way). Bounded concurrency in the writer.
- The `UnprocessedItems` lesson moves to the docs (check-yourself question 5).
- Clients must send a multipart form (`curl -F` each field, then `-F file=@x.csv` last).

- Rows are written while the file streams, so a FAILED import can be partial (an unparseable
  line or the row cap after some rows): `created` counts the links that exist.
- `MAX_ROWS` must be raised (in a branch) for M6's large-file exercise.

### Risks
- A foreign link that collided on attempt 0 is TTL-deleted between two deliveries: the second
  delivery writes attempt 0 while attempt 1 already exists for that row, so the row ends up with
  two codes. Rare (needs a collision and an expiry in between); accepted.
- A presigned POST is valid no longer than the signing role's session credentials.
- The policy can be reused until it expires (5 min): the same key can be uploaded again. If the
  import already finished, the second file is ignored (status DONE); accepted.
- The importer has `s3:ListBucket` on the whole bucket (so a missing key is a 404, not a 403); the
  module's policy statements can't carry an `s3:prefix` condition yet. Only `incoming/` exists.
- Uploads are kept 7 days: at the route limit (1 upload/s) sustained abuse could store up to
  ~600 GB (~$14/month) before the lifecycle catches up. The budget alarm is the backstop.
