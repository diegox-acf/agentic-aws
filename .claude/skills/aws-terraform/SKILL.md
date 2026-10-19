---
name: aws-terraform
description: "Use when creating, editing, or reviewing Terraform modules or Terragrunt units under infra/, choosing AWS resource settings, writing IAM policies, or estimating AWS cost for this repo."
---

# AWS + Terraform conventions for agentic-aws

## Layout
- Modules: infra/modules/<name>/{main.tf,variables.tf,outputs.tf,versions.tf}
- Units:   infra/live/<env>/<project>/<unit>/terragrunt.hcl
  Account-wide units (budget, GitHub OIDC) skip the project level:
  infra/live/global/<unit>/terragrunt.hcl
- Root:    infra/root.hcl generates backend.tf and provider.tf. Modules never declare
  `provider` or `backend` blocks; versions.tf only has required_providers.

## Unit template
    include "root" { path = find_in_parent_folders("root.hcl") }
    terraform { source = "${get_repo_root()}/infra/modules/<module>" }
    dependency "x" {
      config_path  = "../x"
      mock_outputs = { ... }   # so `plan` works before x exists
    }
    inputs = { ... }

## Module rules
- Every variable has a type and description; validate enums with `validation` blocks.
- Output names AND ARNs for everything another unit might reference.
- Names: "${var.project}-${var.env}-<thing>". Tags come from provider default_tags.
- CloudWatch log groups are created explicitly with retention_in_days = 7.
- S3 buckets: block public access, SSE enabled, `force_destroy = true` (learning repo).
- DynamoDB: PAY_PER_REQUEST, point-in-time recovery off unless asked.

## IAM
- No `"Action": "*"` or `"Resource": "*"` except where AWS requires `*` (e.g. some
  `logs:` and `xray:` actions). Scope to ARNs from module inputs.
- Prefer `aws_iam_policy_document` data sources over JSON strings.
- One role per workload; trust policy limited to the one service principal.
- Lambda logging: grant only `logs:CreateLogStream` + `logs:PutLogEvents` on the module's
  log group ARN and `"${arn}:*"` (streams live under the group). Never `logs:CreateLogGroup`
  and never the managed `AWSLambdaBasicExecutionRole` (it grants CreateLogGroup on `*`): a
  typo'd function name would create an unmanaged log group that never expires.
- Who-may-invoke is a resource policy, not a role: `aws_lambda_permission` with the caller's
  service principal and `source_arn` scoped to that caller (e.g. `${execution_arn}/*/*`).
- Reject `"*"` in policy-statement inputs with a `validation` block, not just by review.

## Lambda (P1 lessons)
- `archive_file` zips built on Windows lose the executable bit: set `output_file_mode = "0755"`
  or every invoke fails with `Runtime.InvalidEntrypoint`. Build the binary before `plan`
  (archive_file reads the folder during plan).
- Always set `source_code_hash = data.archive_file.<x>.output_base64sha256`; `filename`
  never changes, so without it a rebuilt binary is never deployed.
- `depends_on` the log group and role policy so the first invoke can log.
- This account's Lambda concurrency limit is 10, so `reserved_concurrent_executions` is
  unavailable (AWS keeps 10 unreserved). Cap abuse at the API instead; check with
  `aws lambda get-account-settings` before proposing it.

## HTTP API (P1 lessons)
- Explicit routes, no `$default` route: unknown paths 404 at API Gateway, never billed in Lambda.
- Throttle on the `$default` stage (`default_route_settings`). It is per stage, not per client:
  per-client limits need WAF (billed) or auth.
- Enable JSON access logs to an explicit 7-day log group: throttled 429s and unrouted 404s
  never reach Lambda logs.

## Cost guardrails (flag before proposing)
- Hourly billing: NAT gateway, ALB/NLB, RDS, EKS control plane, interface VPC endpoints,
  public IPv4 addresses, Secrets Manager secrets, KMS customer keys.
- Prefer: Lambda, DynamoDB on-demand, SQS, SNS, S3, CloudFront, HTTP APIs.

## Safety
- Never run apply/destroy. Run `terragrunt plan` and summarize: adds/changes/destroys,
  anything replaced (-/+), any IAM change.
