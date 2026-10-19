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

inputs = {
  name                 = "shortener"
  lambda_function_name = dependency.fn.outputs.function_name
  lambda_invoke_arn    = dependency.fn.outputs.invoke_arn
  routes               = ["POST /links", "GET /{code}", "GET /links/{code}"]
}
