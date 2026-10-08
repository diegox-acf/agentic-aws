include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/dynamodb-table"
}

inputs = {
  name          = "links"
  hash_key      = "code"
  ttl_attribute = "expiresAt"
}
