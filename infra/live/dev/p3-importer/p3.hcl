# Shared by the P3 units through read_terragrunt_config. Not a unit (no terragrunt.hcl).
locals {
  # The importer's timeout, and the queue's visibility timeout derived from it (6x, as AWS
  # advises for Lambda consumers). One number, so the two can't drift apart.
  importer_timeout_seconds = 60
}
