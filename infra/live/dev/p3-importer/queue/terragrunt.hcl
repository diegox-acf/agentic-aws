include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules/sqs-queue-dlq"
}

locals {
  p3 = read_terragrunt_config(find_in_parent_folders("p3.hcl")).locals
}

inputs = {
  name = "imports"
  # Longer than any importer run, so a message isn't redelivered while still being processed.
  visibility_timeout_seconds = 6 * local.p3.importer_timeout_seconds
  max_receive_count          = local.p3.max_receive_count
}
