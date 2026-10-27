include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/lambda-function"
}

dependency "imports_table" {
  config_path = "../imports-table"
  mock_outputs = {
    name = "mock-imports"
    arn  = "arn:aws:dynamodb:us-east-1:111111111111:table/mock-imports"
  }
}

dependency "bucket" {
  config_path = "../bucket"
  mock_outputs = {
    bucket_name = "mock-imports-bucket"
    bucket_arn  = "arn:aws:s3:::mock-imports-bucket"
  }
}

# Build first: archive_file zips dist/presign during plan (apps/p3-importer/build.sh).
inputs = {
  name       = "presign"
  source_dir = "${get_repo_root()}/apps/p3-importer/dist/presign"
  runtime    = "nodejs24.x"
  handler    = "index.handler" # dist/presign/index.mjs, export "handler"
  env_vars = {
    IMPORTS_TABLE           = dependency.imports_table.outputs.name
    BUCKET_NAME             = dependency.bucket.outputs.bucket_name
    URL_TTL_SECONDS         = "300"
    MAX_UPLOAD_BYTES        = "1048576" # 1 MB; S3 enforces it through the presigned POST policy
    POWERTOOLS_SERVICE_NAME = "presign"
  }
  policy_statements = [
    {
      actions   = ["dynamodb:PutItem", "dynamodb:GetItem"]
      resources = [dependency.imports_table.outputs.arn]
    },
    {
      # A presigned POST carries this role's signature: S3 checks THIS permission at upload time.
      actions   = ["s3:PutObject"]
      resources = ["${dependency.bucket.outputs.bucket_arn}/incoming/*"]
    },
  ]
}
