output "queue_name" {
  value       = aws_sqs_queue.this.name
  description = "Work queue name."
}

output "queue_url" {
  value       = aws_sqs_queue.this.id
  description = "Work queue URL (the id SQS APIs and aws_sqs_queue_policy take)."
}

output "queue_arn" {
  value       = aws_sqs_queue.this.arn
  description = "Work queue ARN, for IAM, event source mappings and EventBridge targets."
}

output "dlq_name" {
  value       = aws_sqs_queue.dlq.name
  description = "Dead-letter queue name."
}

output "dlq_url" {
  value       = aws_sqs_queue.dlq.id
  description = "Dead-letter queue URL."
}

output "dlq_arn" {
  value       = aws_sqs_queue.dlq.arn
  description = "Dead-letter queue ARN."
}

output "alarm_topic_arn" {
  value       = aws_sns_topic.alarms.arn
  description = "SNS topic the DLQ alarm notifies (subscribe an email to it)."
}
