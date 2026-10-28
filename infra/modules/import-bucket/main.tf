locals {
  bucket_name = "${var.project}-${var.env}-${var.name}"
}

data "aws_caller_identity" "me" {}

# --- Bucket: private, encrypted; uploads arrive through presigned POSTs only -------------

# Bucket names are global across all AWS accounts; the account id makes ours unique.
resource "aws_s3_bucket" "imports" {
  bucket        = "${local.bucket_name}-${data.aws_caller_identity.me.account_id}"
  force_destroy = true # learning repo: destroy empties the bucket instead of failing
}

resource "aws_s3_bucket_public_access_block" "imports" {
  bucket                  = aws_s3_bucket.imports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Already the default for new buckets; explicit so the code says ACLs are off and the
# bucket owner owns every object (access is decided by policies only).
resource "aws_s3_bucket_ownership_controls" "imports" {
  bucket = aws_s3_bucket.imports.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "imports" {
  bucket = aws_s3_bucket.imports.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # SSE-S3: free, AWS-managed keys
    }
  }
}

# No Allow statements: who may write is decided by IAM. A presigned POST acts with the
# permissions of whoever signed it (the presign function's role), so that role needs
# s3:PutObject on the incoming/ prefix and nobody else does.
data "aws_iam_policy_document" "imports" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.imports.arn, "${aws_s3_bucket.imports.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "imports" {
  bucket = aws_s3_bucket.imports.id
  policy = data.aws_iam_policy_document.imports.json

  # S3 rejects a policy write while the public access block is still being applied.
  depends_on = [aws_s3_bucket_public_access_block.imports]
}

# Uploaded CSVs are only needed until the importer has read them; expiring them keeps the
# bucket (and its storage bill) from growing forever. Lifecycle runs once a day, not instantly.
resource "aws_s3_bucket_lifecycle_configuration" "imports" {
  bucket = aws_s3_bucket.imports.id

  rule {
    id     = "expire-incoming"
    status = "Enabled"

    filter {
      prefix = var.incoming_prefix
    }

    expiration {
      days = var.incoming_expiration_days
    }

    # Multipart parts of an abandoned upload are billed but invisible in listings.
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# --- S3 -> EventBridge -> SQS ---------------------------------------------------------------

# S3 emits no events by default. This sends every event of this bucket to the account's
# default event bus; picking which ones matter is the rule's job, not the bucket's.
resource "aws_s3_bucket_notification" "imports" {
  bucket      = aws_s3_bucket.imports.id
  eventbridge = true
}

# The default bus carries events from every AWS service in the account. In a pattern a list
# means "any of these", and { prefix = ... } matches the start of the string.
resource "aws_cloudwatch_event_rule" "csv_uploaded" {
  name        = "${local.bucket_name}-csv-uploaded"
  description = "Object Created under ${var.incoming_prefix} in ${aws_s3_bucket.imports.id}"
  event_pattern = jsonencode({
    source        = ["aws.s3"]
    "detail-type" = ["Object Created"]
    detail = {
      bucket = { name = [aws_s3_bucket.imports.id] }
      object = { key = [{ prefix = var.incoming_prefix }] }
    }
  })
}

# A standard SQS target needs no role: EventBridge is allowed in by the queue policy below.
resource "aws_cloudwatch_event_target" "imports_queue" {
  rule = aws_cloudwatch_event_rule.csv_uploaded.name
  arn  = var.queue_arn
}

# Resource-based policy on the queue. Without the aws:SourceArn condition any EventBridge
# rule, in any account, could use this grant to fill the queue (confused deputy). If this
# is wrong the rule still counts MatchedEvents, but every delivery is a FailedInvocation.
data "aws_iam_policy_document" "queue" {
  statement {
    sid       = "AllowCsvUploadedRule"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [var.queue_arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.csv_uploaded.arn]
    }
  }

  # Same rule as the bucket: refuse plain HTTP. EventBridge and Lambda's pollers use TLS.
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["sqs:*"]
    resources = [var.queue_arn]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

# EventBridge retries a failed delivery for up to 24 hours, then drops the event: the upload is
# never imported and its record stays PENDING, with no error anywhere. FailedInvocations counts
# those failed deliveries (e.g. a broken queue policy), so this alarm is the only signal.
resource "aws_cloudwatch_metric_alarm" "csv_uploaded_failed_invocations" {
  alarm_name          = "${aws_cloudwatch_event_rule.csv_uploaded.name}-failed-invocations"
  alarm_description   = "EventBridge couldn't deliver upload events to the imports queue (check the queue policy). Those uploads stay PENDING."
  namespace           = "AWS/Events"
  metric_name         = "FailedInvocations"
  dimensions          = { RuleName = aws_cloudwatch_event_rule.csv_uploaded.name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  # The metric only exists while there are failures: no data is healthy.
  treat_missing_data = "notBreaching"
  alarm_actions      = [var.alarm_topic_arn]
  ok_actions         = [var.alarm_topic_arn]
}

# A queue has one policy, and this module owns all of it: don't attach another
# aws_sqs_queue_policy to the same queue, or the two overwrite each other on every apply.
resource "aws_sqs_queue_policy" "imports" {
  queue_url = var.queue_url
  policy    = data.aws_iam_policy_document.queue.json
}
