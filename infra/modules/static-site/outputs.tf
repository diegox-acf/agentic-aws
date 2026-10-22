output "bucket_name" {
  value       = aws_s3_bucket.site.bucket
  description = "Name of the private bucket that holds the site files (deploy target)."
}

output "bucket_arn" {
  value       = aws_s3_bucket.site.arn
  description = "ARN of the site bucket (for a deploy role's policy)."
}

output "distribution_id" {
  value       = aws_cloudfront_distribution.site.id
  description = "CloudFront distribution id (for cache invalidations)."
}

output "distribution_arn" {
  value       = aws_cloudfront_distribution.site.arn
  description = "CloudFront distribution ARN."
}

output "domain_name" {
  value       = aws_cloudfront_distribution.site.domain_name
  description = "Distribution domain, e.g. d111111abcdef8.cloudfront.net. The site is https://<domain_name>/."
}
