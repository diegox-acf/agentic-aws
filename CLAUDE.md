# learn-aws

Learning repo: small AWS apps provisioned with Terraform + Terragrunt.
Tutorial lives in docs/. Current module: see docs/README.md.

## Ground rules
- I am learning. When I ask "why", explain the AWS concept before writing code.
- Region us-east-1, single env `dev`, AWS profile `learn-admin` (SSO).
- Cost: free tier + a few dollars. Flag anything that bills hourly (NAT gateway,
  ALB, RDS, EKS, interface VPC endpoints, public IPv4) before proposing it.
- Never run `terragrunt apply`, `terragrunt destroy`, `terraform apply/destroy`, or
  `aws ... delete-*`. Run `terragrunt plan` and show me the summary; I apply.

## Layout
- apps/<project>/   application code (Go, TS, Java)
- infra/modules/    reusable Terraform modules (no provider blocks)
- infra/live/       Terragrunt units; root config is infra/root.hcl
- docs/             tutorial

## Conventions
- Use the aws-terraform skill for anything under infra/.
- Every project ends with a teardown section that actually works.
- Node/TypeScript projects use pnpm (never npm/npx).
- Shell: bash (Git Bash on Windows). Use the Bash tool, not PowerShell. Scripts are `*.sh`.
  Prefix AWS commands with `/`-leading arguments with `MSYS_NO_PATHCONV=1`.
