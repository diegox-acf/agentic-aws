locals {
  site_name = "${var.project}-${var.env}-${var.name}"
  origin_id = "s3-${local.site_name}"
}

data "aws_caller_identity" "me" {}

# --- Bucket: private, encrypted, readable only by this distribution -----------------------

# Bucket names are global across all AWS accounts; the account id makes ours unique.
resource "aws_s3_bucket" "site" {
  bucket        = "${local.site_name}-${data.aws_caller_identity.me.account_id}"
  force_destroy = true # learning repo: destroy empties the bucket instead of failing
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Already the default for new buckets; explicit so the code says ACLs are off and the
# bucket owner owns every object (access is decided by policies only).
resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # SSE-S3: free, AWS-managed keys
    }
  }
}

# Resource-based policy: the bucket says who may read it. Only the CloudFront service, and only
# when acting for THIS distribution (AWS:SourceArn), not any distribution in any account.
data "aws_iam_policy_document" "site" {
  statement {
    sid       = "AllowThisDistributionRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.site.arn, "${aws_s3_bucket.site.arn}/*"]
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

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json

  # S3 rejects a policy write while the public access block is still being applied.
  depends_on = [aws_s3_bucket_public_access_block.site]
}

# --- CloudFront --------------------------------------------------------------------------

# OAC: CloudFront signs every origin request with SigV4, so S3 can check the bucket policy.
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = local.site_name
  description                       = "Signed reads from ${aws_s3_bucket.site.bucket}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "index_rewrite" {
  name    = "${local.site_name}-index"
  comment = "Append index.html to directory URIs"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/index-rewrite.js")
}

# AWS-managed policies, looked up by name: their ids are the same in every account, but a
# name is readable and fails loudly at plan time if it is ever wrong.
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = local.site_name
  default_root_object = "index.html"
  price_class         = var.price_class
  http_version        = "http2and3"
  is_ipv6_enabled     = true

  origin {
    origin_id                = local.origin_id
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name # REST endpoint, not website
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index_rewrite.arn
    }
  }

  # Without s3:ListBucket, S3 answers 403 (not 404) for a missing key, so map both.
  # Side effect: a real 403 (e.g. a broken bucket policy) also shows up as a 404 page.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # *.cloudfront.net certificate; a custom domain would need ACM + Route 53.
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
