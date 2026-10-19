output "api_id" {
  value       = aws_apigatewayv2_api.this.id
  description = "HTTP API id."
}

output "api_endpoint" {
  value       = aws_apigatewayv2_api.this.api_endpoint
  description = "Base URL of the API, e.g. https://abc123.execute-api.us-east-1.amazonaws.com."
}

output "execution_arn" {
  value       = aws_apigatewayv2_api.this.execution_arn
  description = "Execution ARN, the prefix used in invoke permissions."
}

output "access_log_group_name" {
  value       = aws_cloudwatch_log_group.access.name
  description = "CloudWatch log group for stage access logs."
}
