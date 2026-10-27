output "bucket_name" {
  value       = aws_s3_bucket.imports.id
  description = "Bucket name (globally unique: includes the account id)."
}

output "csv_uploaded_rule_name" {
  value       = aws_cloudwatch_event_rule.csv_uploaded.name
  description = "EventBridge rule name, for its MatchedEvents / FailedInvocations metrics."
}

output "csv_uploaded_rule_arn" {
  value       = aws_cloudwatch_event_rule.csv_uploaded.arn
  description = "EventBridge rule ARN (the queue policy's aws:SourceArn)."
}

output "bucket_arn" {
  value       = aws_s3_bucket.imports.arn
  description = "Bucket ARN; object ARNs are \"<arn>/<key>\", e.g. for IAM on the incoming/ prefix."
}
