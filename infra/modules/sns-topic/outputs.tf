output "name" {
  value       = aws_sns_topic.this.name
  description = "Topic name."
}

output "arn" {
  value       = aws_sns_topic.this.arn
  description = "Topic ARN, for sns:Publish grants and subscriptions."
}
