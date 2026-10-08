# Module 4 · P3 · Event-driven bulk import (TypeScript)

Add **bulk import** to the shortener: upload a CSV of URLs and an asynchronous pipeline
creates the short links. This is where AWS gets interesting. Delivery is
at-least-once, failures are partial, and nothing returns a stack trace to you.

**Time:** 2 weekends · **Cost:** ≈ $0 (S3, EventBridge default bus, SQS, SNS, Lambda all within free usage)

## What you'll learn

| AWS | ECC |
|---|---|
| S3 presigned URLs (upload without proxying bytes through Lambda) | `/ecc:orch-refine-code` on **infrastructure**, verified by an empty `terragrunt plan` |
| S3 → EventBridge notifications, event patterns, rules, targets | `/ecc:orch-add-feature` end to end with its two gates |
| SQS: visibility timeout, DLQ + `maxReceiveCount`, redrive | `ecc:silent-failure-hunter` on async code |
| Lambda event source mappings, batch size, `ReportBatchItemFailures` | `/ecc:orch-fix-defect` on a bug you trigger on purpose |
| Idempotency under at-least-once delivery | `/ecc:checkpoint` across a multi-day task |
| DynamoDB `BatchWriteItem` and `UnprocessedItems` | `/ecc:save-session` / `/ecc:resume-session` |
| SNS fan-out, Powertools for AWS Lambda (TypeScript) | |
| (Stretch) Step Functions | |

## Architecture

```
 web/curl ─POST /imports─► HTTP API (P1) ─► Lambda "presign" (TS)
                                              │ 1. put imports{id, status:PENDING}
                                              │ 2. return presigned PUT url
 web/curl ─PUT csv────────► S3 imports bucket  incoming/{id}.csv
                                │ (EventBridge notifications on)
                                ▼
                       EventBridge default bus
                       rule: source=aws.s3, detail-type="Object Created",
                             bucket=imports, key prefix "incoming/"
                                │
                                ▼
                       SQS imports-queue ──(3 failed receives)──► SQS imports-dlq ─► alarm
                                │ event source mapping, batch 1, ReportBatchItemFailures
                                ▼
                       Lambda "importer" (TS)
                         stream CSV → validate rows → BatchWriteItem into links (P1 table)
                         update imports{id} counts/status
                                │
                                ▼
                       SNS import-results ──► email
```

Why EventBridge in the middle instead of S3 → SQS directly? Content filtering on any
event field, several targets per event, archive and replay. You'll compare both in the
check-yourself questions.

## Steps

### M1 · Refactor first: make `lambda-function` multi-runtime

P1's module hardcodes `provided.al2023`. Generalize it **without changing P1**:

```
/ecc:orch-refine-code generalize infra/modules/lambda-function: runtime, handler,
architecture, timeout, memory become variables with P1's current values as defaults.
Also generalize infra/modules/http-api so routes map to different Lambda functions
(a map of route_key -> {invoke_arn, function_name}), one integration + permission per function.
Success criterion: `terragrunt run --all plan` in infra/live/dev/p1-shortener shows
"No changes." for every unit.
```

This is the most useful habit in IaC: a refactor is proven by an **empty plan**, just as a
code refactor is proven by green tests. Use `moved {}` blocks if any resource address
changes.

### M2 · Plan the feature

```bash
# skip if you already copied it in P2
[ -d .claude/rules/ecc/typescript ] || cp -R ~/.claude/plugins/cache/ecc/ecc/2.2.3/rules/typescript .claude/rules/ecc/
```

```
/ecc:orch-add-feature P3 bulk import for the P1 shortener, code in apps/p3-importer (TypeScript,
esbuild-bundled, latest Node.js Lambda runtime, arm64), infra in infra/live/dev/p3-importer.
- POST /imports on the existing P1 HTTP API -> Lambda "presign": creates an imports record
  {importId, status: PENDING, createdAt} and returns a presigned S3 PUT URL (5 min) for
  incoming/{importId}.csv, content-type text/csv, max 1 MB.
- S3 bucket with EventBridge notifications. Rule on Object Created under incoming/ -> SQS queue.
- SQS queue: visibility timeout 6x the importer timeout, DLQ after 3 receives, DLQ depth alarm.
- Lambda "importer": event source mapping batch size 1 with ReportBatchItemFailures.
  Streams the CSV (one URL per row, optional header), validates each URL with the same rules
  as P1, writes links with BatchWriteItem in chunks of 25 retrying UnprocessedItems with backoff,
  updates imports{importId} with created/rejected counts and status DONE or FAILED,
  publishes a summary to an SNS topic.
- Must be idempotent: the same S3 object delivered twice must not create duplicate links.
- Use Powertools for AWS Lambda (TypeScript): Logger, and the batch utility for partial failures.
- GET /imports/{importId} returns the record.
```

**Gate 1:** read the plan. Push back on at least one thing. For example: how exactly is
idempotency achieved? (Options: deterministic link codes derived from `importId + row`, a
conditional write on the imports record's status, or Powertools' idempotency utility.
Ask for the trade-offs.)

Let the pipeline run TDD (the `tdd-workflow` skill, via the orchestrator) and its review
step. **Gate 2:** read the diff before allowing the commit.

### M3 · Write the event pattern yourself

The EventBridge rule is short and teaches a lot, so write it yourself:

```hcl
resource "aws_cloudwatch_event_rule" "csv_uploaded" {
  name = "${var.project}-${var.env}-csv-uploaded"
  event_pattern = jsonencode({
    source        = ["aws.s3"]
    "detail-type" = ["Object Created"]
    detail = {
      bucket = { name = [aws_s3_bucket.imports.id] }
      object = { key = [{ prefix = "incoming/" }] }
    }
  })
}
```

Then the pieces people forget, which the security reviewer should catch if you don't:

- `aws_s3_bucket_notification` with `eventbridge = true`. Without it, nothing is emitted.
- An **SQS queue policy** allowing `events.amazonaws.com` to `sqs:SendMessage`, conditioned
  on `aws:SourceArn` = the rule ARN.
- The importer role: `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` on the queue,
  `s3:GetObject` on `incoming/*`, `dynamodb:BatchWriteItem` on the links table,
  `dynamodb:UpdateItem` on the imports table, `sns:Publish` on the topic. Nothing else.

### M4 · Deploy and watch it work

```bash
cd infra/live/dev/p3-importer && terragrunt run --all apply
api=$(cd ../p1-shortener/api && terragrunt output -raw api_endpoint)

# get a presigned URL, upload the CSV straight to S3, then poll the import record
r=$(curl -s -X POST "$api/imports")
import_id=$(jq -r .importId <<<"$r")
upload_url=$(jq -r .uploadUrl <<<"$r")
curl -s -X PUT -H "content-type: text/csv" --data-binary @sample.csv "$upload_url"
curl -s "$api/imports/$import_id" | jq
```

Follow one import through the console: S3 object → EventBridge rule metrics
(`MatchedEvents`, `Invocations`) → SQS `NumberOfMessagesReceived` → Lambda logs → the
imports record → email.

### M5 · Hunt silent failures

```
> Use ecc:silent-failure-hunter on apps/p3-importer.
```

Async code fails quietly. Typical findings: `UnprocessedItems` ignored after retries,
`catch` that logs and returns success (message deleted, data lost), a rejected row
counted as created, SNS publish failure marking the import FAILED after links were
written.

### M6 · Break it on purpose, then fix it with the defect pipeline

1. Generate a CSV with 20,000 rows (above the 1 MB limit you set, so first raise the limit
   in a branch). Upload it.
2. Watch: the importer hits its timeout → message becomes visible again → reprocessed →
   after 3 receives lands in the DLQ → alarm email.
3. Check DynamoDB: did retries create duplicates? If your idempotency is right, no.
4. Fix it properly:

```
/ecc:orch-fix-defect importer times out on large CSVs; retries reprocess from the start.
Expected: large files are processed in resumable chunks and never duplicate links.
```

The orchestrator first writes a failing regression test that reproduces the bug, then fixes
it. Options it may propose: checkpoint progress (row offset) on the imports record, split
the file into chunk messages, or move to Step Functions (see stretch goals).

5. Redrive the DLQ: SQS console → `imports-dlq` → **Start DLQ redrive**. Watch the message
   succeed this time.

Long task? Use `/ecc:checkpoint` before M6 and `/ecc:save-session` at the end of the day.

### M7 · Verify, learn

```
ecc:verification-loop
/ecc:learn-eval      # good candidates: "SQS visibility vs Lambda timeout", "EventBridge S3 pattern"
```

Add the queue-policy and visibility-timeout rules to your `aws-terraform` skill.

---

## Check yourself (no Claude)

1. Why must the SQS visibility timeout be larger than the Lambda timeout? What happens if it isn't?
2. With batch size 10 and no `ReportBatchItemFailures`, one bad message fails. What happens to the other 9?
3. Name two ways to make "the same S3 object delivered twice" harmless.
4. S3 → SQS directly vs S3 → EventBridge → SQS: give one reason for each.
5. What does `BatchWriteItem` do with items it couldn't write, and does it throw?
6. Why does the presigned URL approach scale better than POSTing the CSV body to Lambda through API Gateway? (Hint: payload limits.)
7. Your DLQ has 5 messages. Before redriving, what do you check?

## Stretch goals

- **Step Functions:** replace the importer with a Standard workflow: `ValidateFile` → Distributed Map over CSV rows from S3 (batching 100) → `UpdateImport` → `Notify`. Compare cost (4,000 state transitions/month free) and debuggability with the SQS design. Write an ADR.
- Enable an EventBridge **archive** on the default bus for this rule's pattern and **replay** yesterday's uploads.
- Add Powertools Tracer + X-Ray and look at the trace across presign → S3 → importer.
- Add a second rule target: a "virus scan" stub Lambda. Fan-out without touching the importer.

## Teardown

Idle cost ~$0. To remove:

```bash
cd infra/live/dev/p3-importer && terragrunt run --all destroy
```

Remove the `/imports` routes from P1's api unit first if they reference P3 outputs.
