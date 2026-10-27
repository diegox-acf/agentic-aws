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

# TODO(M3): S3 -> EventBridge -> SQS, using var.queue_arn and var.queue_url. You write these:
#   - aws_s3_bucket_notification with eventbridge = true (without it S3 emits no events)
#   - aws_cloudwatch_event_rule: Object Created in this bucket under var.incoming_prefix
#   - aws_cloudwatch_event_target: the imports queue
#   - aws_sqs_queue_policy: events.amazonaws.com may sqs:SendMessage, only for this rule's ARN
