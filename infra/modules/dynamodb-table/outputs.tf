output "name" {
  description = "Full name of the DynamoDB table."
  value       = aws_dynamodb_table.this.name
}

output "arn" {
  description = "ARN of the DynamoDB table, for IAM policies."
  value       = aws_dynamodb_table.this.arn
}
