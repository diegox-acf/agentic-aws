locals {
  env_vars   = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env        = local.env_vars.locals.env
  region     = "us-east-1"
  project    = "agentic-aws"
  account_id = get_aws_account_id()
  # State bucket keeps the original project name: renaming it would orphan existing state.
  state_bucket = "learn-aws-tfstate-${local.account_id}"
  # Forward slashes on every OS: Windows returns "live\global\budget", which breaks HCL strings
  # ("\g" is an invalid escape) and would give different S3 state keys than Linux/macOS/CI.
  unit_path = replace(path_relative_to_include(), "\\", "/")
}

remote_state {
  backend = "s3"
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    bucket       = local.state_bucket
    key          = "${local.unit_path}/terraform.tfstate"
    region       = local.region
    encrypt      = true
    use_lockfile = true # S3-native locking (Terraform >= 1.10), no DynamoDB table
  }
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  # Only the provider *configuration*. Provider *requirements* (source, version) live in each
  # module's versions.tf; Terraform allows one required_providers block per module.
  contents = <<-EOF
    provider "aws" {
      region = "${local.region}"
      default_tags {
        tags = {
          Project   = "${local.project}"
          Env       = "${local.env}"
          Unit      = "${local.unit_path}"
          ManagedBy = "terragrunt"
        }
      }
    }
  EOF
}

inputs = {
  project = local.project
  env     = local.env
}
