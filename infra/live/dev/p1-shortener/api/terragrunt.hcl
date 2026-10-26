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
