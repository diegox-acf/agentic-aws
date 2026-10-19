include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/lambda-function"
}

dependency "table" {
  config_path = "../table"
  mock_outputs = {
    name = "mock-table"
    arn  = "arn:aws:dynamodb:us-east-1:111111111111:table/mock-table"
  }
}

inputs = {
  name       = "shortener"
  source_dir = "${get_repo_root()}/apps/p1-shortener/dist"
  env_vars   = { TABLE_NAME = dependency.table.outputs.name }
  # Export ALARM_EMAIL in ~/.bashrc; keep your email out of git (like BUDGET_EMAIL).
  alarm_email = get_env("ALARM_EMAIL")
  policy_statements = [{
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [dependency.table.outputs.arn]
  }]
}
