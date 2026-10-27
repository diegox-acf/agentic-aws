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

# Cross-project: P3's bulk-import routes live on P1's API. To destroy P3 alone, first remove
# this dependency and the presign entries below and apply this unit (see docs/04 teardown).
dependency "presign" {
  config_path = "../../p3-importer/presign"
  mock_outputs = {
    # Its own name: http-api rejects two keys on one function, and "mock-fn" is taken.
    function_name = "mock-presign"
    invoke_arn    = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:111111111111:function:mock-presign/invocations"
  }
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
    presign = {
      invoke_arn    = dependency.presign.outputs.invoke_arn
      function_name = dependency.presign.outputs.function_name
    }
  }
  routes = {
    "POST /links"       = local.fn_key
    "GET /{code}"       = local.fn_key
    "GET /links/{code}" = local.fn_key
    # P3 bulk import. Path parameters match one segment, so "GET /{code}" never catches
    # /imports/<id>; a bare GET /imports does reach the shortener and is a 404 there.
    "POST /imports"           = "presign"
    "GET /imports/{importId}" = "presign"
  }
  # Each import can cost up to MAX_ROWS (1000) DynamoDB writes, and the API has no auth: allow
  # one new import per second (burst 2) instead of the stage's 10 rps.
  route_throttling = {
    "POST /imports" = { rate_limit = 1, burst_limit = 2 }
  }
  cors_origins = [
    "https://${dependency.web.outputs.domain_name}",
    "http://localhost:3000", # pnpm dev
  ]
}
