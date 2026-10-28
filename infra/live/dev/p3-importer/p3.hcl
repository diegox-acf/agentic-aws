# Shared by the P3 units through read_terragrunt_config. Not a unit (no terragrunt.hcl).
locals {
  # The importer's timeout, and the queue's visibility timeout derived from it (6x, as AWS
  # advises for Lambda consumers). One number, so the two can't drift apart.
  importer_timeout_seconds = 60

  # Deliveries before SQS moves a message to the DLQ. The importer reads it too: on the last
  # delivery it marks the import FAILED instead of leaving it PROCESSING forever.
  max_receive_count = 3
}
