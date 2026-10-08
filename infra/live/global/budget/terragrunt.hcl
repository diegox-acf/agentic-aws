include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/budget"
}

inputs = {
  limit_usd = "5"
  email     = get_env("BUDGET_EMAIL") # keep your email out of git
}
