output "function_name" {
  value       = aws_lambda_function.this.function_name
  description = "Function name."
}

output "function_arn" {
  value       = aws_lambda_function.this.arn
  description = "Function ARN."
}

output "invoke_arn" {
  value       = aws_lambda_function.this.invoke_arn
  description = "ARN API Gateway uses as the integration URI."
}

output "role_arn" {
  value       = aws_iam_role.this.arn
  description = "Execution role ARN."
}

output "alarm_topic_arn" {
  value       = one(aws_sns_topic.alarms[*].arn)
  description = "SNS topic the alarms notify (subscribe an email to it); null when alarms are disabled."
}

output "log_group_name" {
  value       = aws_cloudwatch_log_group.this.name
  description = "CloudWatch log group the function writes to."
}
