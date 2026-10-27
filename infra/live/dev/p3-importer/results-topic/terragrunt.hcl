include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/sns-topic"
}

inputs = {
  name = "import-results"
}
