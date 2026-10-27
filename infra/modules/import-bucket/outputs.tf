output "bucket_name" {
  value       = aws_s3_bucket.imports.id
  description = "Bucket name (globally unique: includes the account id)."
}

output "bucket_arn" {
  value       = aws_s3_bucket.imports.arn
  description = "Bucket ARN; object ARNs are \"<arn>/<key>\", e.g. for IAM on the incoming/ prefix."
}
