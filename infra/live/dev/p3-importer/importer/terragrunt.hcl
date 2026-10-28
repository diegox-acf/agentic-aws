include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/lambda-function"
}

locals {
  p3 = read_terragrunt_config(find_in_parent_folders("p3.hcl")).locals
}

dependency "queue" {
  config_path  = "../queue"
  mock_outputs = { queue_arn = "arn:aws:sqs:us-east-1:111111111111:mock-imports" }
}

dependency "bucket" {
  config_path = "../bucket"
  mock_outputs = {
    bucket_name = "mock-imports-bucket"
    bucket_arn  = "arn:aws:s3:::mock-imports-bucket"
  }
}

dependency "imports_table" {
  config_path = "../imports-table"
  mock_outputs = {
    name = "mock-imports"
    arn  = "arn:aws:dynamodb:us-east-1:111111111111:table/mock-imports"
  }
}

dependency "results_topic" {
  config_path  = "../results-topic"
  mock_outputs = { arn = "arn:aws:sns:us-east-1:111111111111:mock-import-results" }
}

# Cross-project: the importer writes links into P1's table. P3 depends on P1, never the reverse
# (P1's api depends on P3's presign, a different unit, so there is no cycle).
dependency "links_table" {
  config_path = "../../p1-shortener/table"
  mock_outputs = {
    name = "mock-links"
    arn  = "arn:aws:dynamodb:us-east-1:111111111111:table/mock-links"
  }
}

# Build first: archive_file zips dist/importer during plan (apps/p3-importer/build.sh).
inputs = {
  name        = "importer"
  source_dir  = "${get_repo_root()}/apps/p3-importer/dist/importer"
  runtime     = "nodejs24.x"
  handler     = "index.handler"
  timeout     = local.p3.importer_timeout_seconds # the queue's visibility timeout is 6x this
  memory_size = 256                               # CSV parsing + concurrent writes; CPU scales with memory
  env_vars = {
    LINKS_TABLE             = dependency.links_table.outputs.name
    IMPORTS_TABLE           = dependency.imports_table.outputs.name
    BUCKET_NAME             = dependency.bucket.outputs.bucket_name # reads only this bucket
    RESULTS_TOPIC_ARN       = dependency.results_topic.outputs.arn
    MAX_UPLOAD_BYTES        = "1048576" # same limit as presign's POST policy, checked again here
    MAX_ROWS                = "1000"    # caps the DynamoDB writes one unauthenticated upload can cause
    WRITE_CONCURRENCY       = "10"
    MAX_RECEIVE_COUNT       = tostring(local.p3.max_receive_count) # same number as the queue's redrive
    POWERTOOLS_SERVICE_NAME = "importer"
  }
  policy_statements = [
    {
      # What the event source mapping's pollers need (they run as this role).
      actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
      resources = [dependency.queue.outputs.queue_arn]
    },
    {
      actions   = ["s3:GetObject"]
      resources = ["${dependency.bucket.outputs.bucket_arn}/incoming/*"]
    },
    {
      # Without ListBucket, S3 answers a missing key with 403 AccessDenied (so as not to reveal
      # whether it exists) instead of 404 NoSuchKey: an expired upload would look like a
      # permissions error and be retried into the DLQ instead of marked FAILED.
      actions   = ["s3:ListBucket"]
      resources = [dependency.bucket.outputs.bucket_arn]
    },
    {
      # Conditional PutItem only (ADR 0004): never UpdateItem/DeleteItem on P1's links.
      actions   = ["dynamodb:PutItem"]
      resources = [dependency.links_table.outputs.arn]
    },
    {
      actions   = ["dynamodb:UpdateItem"]
      resources = [dependency.imports_table.outputs.arn]
    },
    {
      actions   = ["sns:Publish"]
      resources = [dependency.results_topic.outputs.arn]
    },
  ]
  sqs_trigger = {
    queue_arn           = dependency.queue.outputs.queue_arn
    batch_size          = 1 # one file per invocation: a failure retries just that file
    maximum_concurrency = 2 # AWS's minimum; leaves the account's other 8 for P1 and presign
  }
}
