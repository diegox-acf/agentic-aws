# Module 1 · Foundations

Before building anything, make the account safe to experiment in and set up the repo
so that ECC knows how you want AWS + Terraform work done.

**Time:** 2–3 hours · **Cost:** $0

## What you'll learn

| AWS | ECC |
|---|---|
| Why long-lived IAM user keys are a liability, and how IAM Identity Center (SSO) replaces them | Project `CLAUDE.md` vs rules vs skills: which knowledge goes where |
| AWS Budgets and cost allocation tags | Copying ECC rule packs into a project |
| Remote Terraform state in S3 with native locking (no DynamoDB table needed since Terraform 1.10) | Writing your own skill (ECC has none for Terraform/AWS) |
| Terragrunt `root.hcl` + units, `default_tags`, the state-bucket chicken-and-egg | `/ecc:hookify` to block Claude from running `apply`/`destroy` |
| | `/ecc:security-scan` (AgentShield) and `/ecc:harness-audit` |

---

## Step 1 · Lock down the account

### 1a. Root user

- Root has MFA, root has **no access keys**. Check: IAM console → Security recommendations.
- Never use root for daily work.

### 1b. Replace the IAM user keys with IAM Identity Center

Today your CLI runs as an admin IAM user with long-lived access keys in
`~/.aws/credentials`. Claude Code (and every ECC agent) runs shell commands with those
same keys. Short-lived SSO credentials expire in hours, which limits the blast radius of
anything that goes wrong.

1. Console → **IAM Identity Center** → Enable. (This creates an AWS Organization with your
   account as the management account. That's normal for a single learning account.)
2. Identity source: keep the default Identity Center directory. **Users** → create
   `diego` with your email, accept the invite, set a password + MFA.
3. **Permission sets** → create `LearnAdmin` from the predefined `AdministratorAccess`
   policy, session duration 4 hours. (Admin is acceptable for a sandbox. In P4 you'll build
   a narrower role for CI.)
4. **AWS accounts** → select your account → Assign users → `diego` → `LearnAdmin`.
5. Configure the CLI:

   ```bash
   aws configure sso --profile learn-admin
   #   SSO session name: learn
   #   SSO start URL:    (from Identity Center dashboard, "AWS access portal URL")
   #   SSO region:       us-east-1
   #   Scopes:           sso:account:access   (default)
   #   Pick the account + LearnAdmin role, region us-east-1, output json

   aws sso login --profile learn-admin
   aws sts get-caller-identity --profile learn-admin   # Arn should contain AWSReservedSSO_LearnAdmin
   ```

6. Make it the default everywhere. Set it as a **Windows user environment variable**, not
   only in a shell rc file. Then zsh, Claude Code's Bash and PowerShell tools, and IntelliJ/VS
   Code all see it:

   ```bash
   setx AWS_PROFILE learn-admin   # works from zsh, bash, cmd or PowerShell
   ```

   Open a **new** terminal (`setx` doesn't change the current one) and check with
   `echo $AWS_PROFILE` and `aws sts get-caller-identity`. Restart Claude Code too.

   Avoid `export AWS_PROFILE=...` in `~/.zshrc` alone: Claude Code's Bash tool runs bash and
   doesn't read `.zshrc`, so Claude would silently use a different identity than your terminal.
   If your zsh runs inside **WSL**, it has its own `~/.aws` and doesn't inherit Windows env vars,
   so configure SSO there separately.

7. Once SSO works, **deactivate** (don't delete yet) the old IAM user's access keys in the IAM
   console. Delete them after a week of not needing them.

> You already have profiles `default` and `learn` in `~/.aws/config`. Check what `learn`
> points to with `aws configure list --profile learn` and remove it if it's stale.

### 1c. Turn on cost visibility

- Billing → **Cost allocation tags**: after Step 5's first apply, activate the `Project`,
  `Env`, and `Unit` tags. Tags only show up in Cost Explorer after activation, and only
  from that day forward.
- Billing → **Cost Anomaly Detection**: create a default monitor (free).
- The budget itself is created in Terraform in Step 5.

### Free tier reality check (2026)

Accounts created **after 15 July 2025** don't get the old 12-month free tier (750 h of
EC2/RDS, 1M API Gateway calls, …). They get $100–$200 in credits on a Free plan that
closes after 6 months or when credits run out, unless you upgrade to the Paid plan.
**Always-free** limits still apply to everyone: Lambda (1M requests + 400k GB-s/month),
DynamoDB (25 GB + 25 RCU/WCU provisioned), SNS, SQS (1M requests), CloudFront (1 TB out,
10M requests), CloudWatch basics. Check Billing → Free tier to see which model your
account is on.

---

## Step 2 · Upgrade Terragrunt

Your 0.63.6 predates the CLI redesign. This tutorial uses:

- `root.hcl` as the shared config file (a root `terragrunt.hcl` is now deprecated)
- `terragrunt run --all <cmd>` (replaces `run-all`)
- `terragrunt backend bootstrap` (explicit state-bucket creation)

```bash
which -a terragrunt terraform   # more than one path each = duplicate installs; the first wins
winget upgrade --id Gruntwork.Terragrunt
winget upgrade --id Hashicorp.Terraform
winget install --id jqlang.jq   # JSON on the command line; used throughout the tutorial
```

**Gotcha:** the Chocolatey `terragrunt` package stopped at 0.63.6, so `choco upgrade` reports
"latest version available" and does nothing. Keep one source (winget) and remove the Chocolatey
copies. `choco uninstall` needs an elevated shell: open Git Bash or PowerShell with
"Run as administrator", then run `choco uninstall terragrunt terraform -y`.

Open a new terminal and check:

```bash
which -a terragrunt terraform   # one path each, under .../WinGet/...
terragrunt --version            # 1.x
terraform version               # >= 1.10
jq --version
```

If winget doesn't manage it, download `terragrunt_windows_amd64.exe` from
<https://github.com/gruntwork-io/terragrunt/releases>, rename to `terragrunt.exe`, and put it
on your PATH.

---

## Step 3 · Repo + ECC setup

### 3a. git

```bash
cd ~/dev/aws/agentic-aws
git init -b main
```

`.gitignore`:

```gitignore
# Terraform / Terragrunt
.terraform/
.terragrunt-cache/
*.tfstate
*.tfstate.*
crash.log
*.tfplan
.terraform.lock.hcl.bak

# Build output
dist/
build/
bin/
*.zip
node_modules/
target/
.gradle/
.next/
out/

# Secrets
.env
.env.*
!.env.example
```

Commit the generated `.terraform.lock.hcl` files (provider pinning), not the caches.

### 3b. Copy ECC rule packs into the project

The plugin can't ship rules, so copy them from your installed plugin. Start small: rules
are loaded on every prompt, so only add a language pack when you reach that project.

```bash
ecc=~/.claude/plugins/cache/ecc/ecc/2.2.3/rules
mkdir -p .claude/rules/ecc
cp -R "$ecc/common" "$ecc/golang" .claude/rules/ecc/   # golang is for P1
# later: typescript (P2/P3), java (P5)
```

Read `common/security.md` and `common/testing.md` once. They define the bar the
reviewers will hold you to (e.g. 80% coverage, no hardcoded secrets). Edit them if you
disagree; they are your rules now. Re-copy after major ECC upgrades.

### 3c. Project `CLAUDE.md`

Create `CLAUDE.md` at the repo root. Keep it short; it's loaded every session.

```markdown
# agentic-aws

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
```

### 3d. Write your first skill: `aws-terraform`

ECC has ~290 skills and none of them cover Terraform or AWS. Confirm that yourself
first. That's what ECC's `skill-scout` skill is for:

```
/ecc:skill-scout   find an existing skill for Terraform + Terragrunt on AWS
```

Then create `.claude/skills/aws-terraform/SKILL.md`. The `description` is what makes
Claude load it, so lead with "Use when …" (ECC's own convention).

```markdown
---
name: aws-terraform
description: "Use when creating, editing, or reviewing Terraform modules or Terragrunt units under infra/, choosing AWS resource settings, writing IAM policies, or estimating AWS cost for this repo."
---

# AWS + Terraform conventions for agentic-aws

## Layout
- Modules: infra/modules/<name>/{main.tf,variables.tf,outputs.tf,versions.tf}
- Units:   infra/live/<env>/<project>/<unit>/terragrunt.hcl
- Root:    infra/root.hcl generates backend.tf and provider.tf. Modules never declare
  `provider` or `backend` blocks. versions.tf owns `required_version` and `required_providers`
  (with version constraints); root.hcl must never generate a `terraform {}` block.
- On Windows, path functions return backslashes. Normalize with
  `replace(path_relative_to_include(), "\\", "/")` before putting a path in a string or S3 key.

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

## Cost guardrails (flag before proposing)
- Hourly billing: NAT gateway, ALB/NLB, RDS, EKS control plane, interface VPC endpoints,
  public IPv4 addresses, Secrets Manager secrets, KMS customer keys.
- Prefer: Lambda, DynamoDB on-demand, SQS, SNS, S3, CloudFront, HTTP APIs.

## Safety
- Never run apply/destroy. Run `terragrunt plan` and summarize: adds/changes/destroys,
  anything replaced (-/+), any IAM change.
```

Test that it triggers: start a new session and ask "what are the rules for a new
DynamoDB module here?" Claude should cite the skill. You'll grow this file every project:
each time a reviewer catches a mistake, add the rule here so it isn't repeated.

### 3e. Make the "never apply" rule enforceable

`CLAUDE.md` asks; hooks and permissions enforce. Use two layers.

**Layer 1: ECC hookify.** Hookify rules are Markdown files with YAML frontmatter
(`.claude/hookify.<name>.local.md`) that match `bash`, `file`, `prompt`, or `stop` events
by regex and either `warn` or `block`:

```
/ecc:hookify block any bash command that runs terragrunt apply, terragrunt destroy,
terraform apply, terraform destroy, or "aws ... delete-" and tell me to run it myself
```

Check the result with `/ecc:hookify-list`, and open the generated file to read the regex.
It will look roughly like:

```markdown
---
name: block-iac-apply-destroy
enabled: true
event: bash
action: block
pattern: (terragrunt|terraform)\s+(run\s+--all\s+)?(apply|destroy)|aws\s+\S+\s+delete-
---
Don't run apply/destroy/delete. Show the plan summary and let me run it.
```

**Layer 2: Claude Code permissions.** Hookify's `bash` event matches the Bash tool. On
Windows Claude also has a PowerShell tool, which that rule may not cover. Add
deny rules for both tools to the project's `.claude/settings.json`. Ask Claude to do it,
using the built-in `update-config` skill:

```
> Add project permission deny rules so neither the Bash nor the PowerShell tool can run
> terragrunt apply/destroy, terraform apply/destroy, or aws commands containing "delete-".
```

Test both layers: ask Claude to run `terragrunt apply` in an empty folder, once via Bash
and once via PowerShell. Both should be refused. Add `.claude/*.local.md` to `.gitignore`
if you don't want hookify rules in git (or commit them: they're useful documentation).

### 3f. Audit

```
/ecc:security-scan     # AgentShield: checks .claude/ config, hooks, permissions, secrets
/ecc:harness-audit     # compare with the score from Module 0
```

Commit: `git add -A; git commit -m "chore: repo foundations, ECC rules, aws-terraform skill"`.

---

## Step 4 · Terragrunt root config

`infra/root.hcl`:

```hcl
locals {
  env_vars   = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  env        = local.env_vars.locals.env
  region     = "us-east-1"
  project    = "agentic-aws"
  account_id = get_aws_account_id()
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
    bucket       = "${local.project}-tfstate-${local.account_id}"
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
  contents  = <<-EOF
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
```

`infra/live/global/env.hcl` and `infra/live/dev/env.hcl`:

```hcl
locals {
  env = "global" # "dev" in live/dev/env.hcl
}
```

What to notice:

- `path_relative_to_include()` gives each unit its own state key, e.g.
  `live/global/budget/terraform.tfstate`.
- `inputs` in root are merged into every unit, so every module gets `project` and `env`.
  That means every module must declare those two variables.
- `get_repo_root()` (used in units) needs the git repo from Step 3a.

---

## Step 5 · First unit: a budget

Write this module **yourself** using the skill's conventions, then have Claude review it.
Reference solution:

`infra/modules/budget/variables.tf`

```hcl
variable "project" {
  type        = string
  description = "Project name, used in resource names."
}

variable "env" {
  type        = string
  description = "Environment name."
}

variable "limit_usd" {
  type        = string
  description = "Monthly budget in USD."
  default     = "5"
}

variable "actual_thresholds" {
  type        = list(number)
  description = "Percent of the limit that triggers an ACTUAL-spend email."
  default     = [50, 80, 100]
}

variable "email" {
  type        = string
  description = "Where budget alerts go."
}
```

`infra/modules/budget/main.tf`

```hcl
resource "aws_budgets_budget" "monthly" {
  name         = "${var.project}-${var.env}-monthly"
  budget_type  = "COST"
  limit_amount = var.limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = var.actual_thresholds
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.email]
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.email]
  }
}
```

`infra/modules/budget/outputs.tf`

```hcl
output "budget_name" {
  value = aws_budgets_budget.monthly.name
}
```

`infra/modules/budget/versions.tf`

```hcl
terraform {
  required_version = ">= 1.10" # S3 native state locking

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
```

`infra/live/global/budget/terragrunt.hcl`

```hcl
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
```

Review, then apply:

```
> Review infra/modules/budget and infra/live/global/budget against the aws-terraform skill.
> Use the ecc:code-reviewer agent. Don't change anything; list findings.
```

```bash
export BUDGET_EMAIL="you@example.com"
aws sso login --profile learn-admin
cd infra/live/global/budget
terragrunt backend bootstrap   # creates the state bucket (versioned, encrypted, private)
terragrunt plan
terragrunt apply
```

Then open the state bucket in the S3 console and find
`live/global/budget/terraform.tfstate`. Run `terragrunt plan` again in one terminal and
look quickly: you may catch the `.tflock` object that native locking writes while a run holds
the lock.

Budgets without actions are free, so this unit stays up permanently.

---

## Check yourself (no Claude)

1. Why is a 4-hour SSO session safer than an access key when an AI agent runs shell commands for you?
2. Terragrunt had to create the state bucket *outside* of Terraform. Why can't the state bucket live in the state it stores?
3. What does `use_lockfile = true` protect against, and what did people use before it?
4. Why do modules here never contain a `provider` block?
5. You added `default_tags`. Why might Cost Explorer still not show cost by `Project`?
6. Where should each of these go: CLAUDE.md, a rule, a skill, or a hook?
   (a) "Region is us-east-1" (b) "Never run terraform destroy" (c) "How to write a Terragrunt unit" (d) "Functions must be < 50 lines"

Then: `/ecc:aside grade my answers: ...`

## Stretch goals

- Add a `cost-anomaly` unit: `aws_ce_anomaly_monitor` + `aws_ce_anomaly_subscription` (email, threshold $3).
- Add a second permission set `LearnReadOnly` and use it while reviewing, so `plan` works but nothing can change.
- Read the Terragrunt "Stacks" docs (`terragrunt.stack.hcl`) and decide whether you'd use them here. Write the decision as an ADR with `ecc:architecture-decision-records`.

## Teardown

Nothing to tear down. Keep the budget and the state bucket for the rest of the tutorial.

## Sources

- Terragrunt: migrating from root `terragrunt.hcl`: <https://docs.terragrunt.com/migrate/migrating-from-root-terragrunt-hcl/>
- Terragrunt CLI redesign (`run --all`): <https://terragrunt.gruntwork.io/docs/migrate/cli-redesign>
- AWS free tier changes (July 2025): <https://infratally.com/articles/aws-free-tier-2026/>
- ECC README, rules section: <https://github.com/affaan-m/ECC#readme>
