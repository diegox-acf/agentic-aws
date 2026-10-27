include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/dynamodb-table"
}

inputs = {
  name          = "imports"
  hash_key      = "importId"
  ttl_attribute = "expiresAt" # unix seconds, set to createdAt + 30 days by presign
}
