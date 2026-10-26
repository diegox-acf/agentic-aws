include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/http-api"
}

dependency "fn" {
  config_path = "../fn"
  mock_outputs = {
    function_name = "mock-fn"
    invoke_arn    = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:111111111111:function:mock-fn/invocations"
  }
}

# Cross-project: P1's API allows P2's CloudFront origin (CORS). P1 depends on P2, never the
# reverse; the web app gets the API URL at build time, so there is no cycle.
dependency "web" {
  config_path  = "../../p2-web/site"
  mock_outputs = { domain_name = "example.cloudfront.net" }
  # Mocks only where a fake origin can't reach AWS: an apply must use the real domain.
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

locals {
  fn_key = "shortener"
}

# One-time state migration (P3 M1): http-api went from one integration and permission to one
# per function, so their addresses gained a key. Without these moved blocks Terraform would
# destroy and recreate both, and the API would fail for a moment. Remove once applied.
generate "moved" {
  path      = "moved.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<-EOF
    moved {
      from = aws_apigatewayv2_integration.lambda
      to   = aws_apigatewayv2_integration.lambda["${local.fn_key}"]
    }

    moved {
      from = aws_lambda_permission.apigw
      to   = aws_lambda_permission.apigw["${local.fn_key}"]
    }
  EOF
}

inputs = {
  name = "shortener"
  functions = {
    (local.fn_key) = {
      invoke_arn    = dependency.fn.outputs.invoke_arn
      function_name = dependency.fn.outputs.function_name
    }
  }
  routes = {
    "POST /links"       = local.fn_key
    "GET /{code}"       = local.fn_key
    "GET /links/{code}" = local.fn_key
  }
  cors_origins = [
    "https://${dependency.web.outputs.domain_name}",
    "http://localhost:3000", # pnpm dev
  ]
}
