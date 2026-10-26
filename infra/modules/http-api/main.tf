locals {
  api_name = "${var.project}-${var.env}-${var.name}"
}

resource "aws_apigatewayv2_api" "this" {
  name          = local.api_name
  protocol_type = "HTTP"

  # With CORS configured, API Gateway answers OPTIONS preflights itself (no route, no Lambda
  # call) and adds Access-Control-* headers to the Lambdas' responses. Omitted when empty.
  dynamic "cors_configuration" {
    for_each = length(var.cors_origins) > 0 ? [var.cors_origins] : []
    content {
      allow_origins = cors_configuration.value
      allow_methods = ["GET", "POST"] # a browser call with any other method fails its preflight
      allow_headers = ["content-type"]
      max_age       = 3600 # seconds the browser may reuse a preflight answer
    }
  }
}

# One integration per function. A function can still route internally: P1's Go Lambda gets
# all its routes through one integration and routes them again with chi.
resource "aws_apigatewayv2_integration" "lambda" {
  for_each               = var.functions
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.invoke_arn
  payload_format_version = "2.0"
}

# Explicit routes, no $default route: unknown paths get a 404 from API Gateway
# without invoking (or billing) any Lambda.
resource "aws_apigatewayv2_route" "routes" {
  for_each  = var.routes
  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.lambda[each.value].id}"
}

# Access logs show what Lambda logs never see: throttled (429) and unmatched (404) requests.
resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${local.api_name}"
  retention_in_days = 7
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.throttling_burst_limit # protects your wallet as much as your service
    throttling_rate_limit  = var.throttling_rate_limit
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      ip               = "$context.identity.sourceIp"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      latencyMs        = "$context.responseLatency"
      integrationError = "$context.integrationErrorMessage"
    })
  }
}

# Resource-based policy on each function: lets THIS API (any stage, method, path) invoke it.
resource "aws_lambda_permission" "apigw" {
  for_each      = var.functions
  statement_id  = "AllowHttpApiInvoke" # changing it replaces the permission
  action        = "lambda:InvokeFunction"
  function_name = each.value.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
