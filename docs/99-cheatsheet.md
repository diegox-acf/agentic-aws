# Cheat sheet

## ECC: which command when

| I want to… | Use |
|---|---|
| Find the right ECC tool | `/ecc:ecc-guide` |
| Plan a feature (waits for my OK) | `/ecc:plan "<feature>"` |
| Turn a vague idea into a spec | `/ecc:plan-prd "<idea>"` |
| Build a whole feature with gates | `/ecc:orch-add-feature "<feature>"` |
| Change existing behavior | `/ecc:orch-change-feature "<change>"` |
| Fix a bug test-first | `/ecc:orch-fix-defect "<bug>"` |
| Refactor safely (code **or** IaC: prove with empty plan) | `/ecc:orch-refine-code "<area>"` |
| TDD in Go / React / Spring | `/ecc:go-test`, `/ecc:react-test`, `ecc:springboot-tdd` |
| Fix a broken build | `/ecc:build-fix` |
| Review my diff | `/ecc:code-review` or `/ecc:go-review` / `/ecc:react-review` |
| Review a PR with several agents | `/ecc:review-pr` |
| Security review of code/IaC | `ecc:security-reviewer` agent |
| Security audit of Claude config | `/ecc:security-scan` |
| Two reviewers must agree | `/ecc:santa-loop` |
| Find swallowed errors | `ecc:silent-failure-hunter` agent |
| Pre-commit gate | `ecc:verification-loop` |
| Side question mid-task | `/ecc:aside "<question>"` |
| Stop for the day / continue | `/ecc:save-session` / `/ecc:resume-session` |
| Save what I learned | `/ecc:learn-eval` |
| See / evolve learned instincts | `/ecc:instinct-status`, `/ecc:evolve`, `/ecc:promote` |
| Make a skill from git history | `/ecc:skill-create` |
| Enforce a rule with a hook | `/ecc:hookify "<behavior>"`, `/ecc:hookify-list`, `/ecc:hookify-configure` |
| Record a design decision | `ecc:architecture-decision-records` |
| Check context / spend | `ecc:context-budget`, `/ecc:cost-report` |
| Score the repo's agent setup | `/ecc:harness-audit` |
| Reconfigure ECC | `/ecc:configure-ecc` |

### ECC env vars (Windows user scope via `setx`; open a new terminal and restart Claude after)

```bash
setx ECC_HOOK_PROFILE standard                  # standard|strict|permissive
setx ECC_DISABLED_HOOKS stop:desktop-notify
setx GATEGUARD_EXEMPT_GLOBS 'docs/**'
setx ECC_SESSION_RETENTION_DAYS 14
setx ECC_MAX_INJECTED_INSTINCTS 6
setx ECC_INSTINCT_CONFIDENCE_THRESHOLD 0.7
setx AWS_PROFILE learn-admin
```

## Terragrunt

```bash
terragrunt backend bootstrap        # create state bucket (once)
terragrunt plan | apply | destroy   # one unit (cwd)
terragrunt run --all plan           # every unit below cwd, dependency order
terragrunt run --all destroy        # reverse dependency order
terragrunt output -raw <name>
terragrunt hclfmt                   # format .hcl
terragrunt --help                   # command names changed in the CLI redesign; check here first
```

Clear caches when things get weird: delete `.terragrunt-cache` folders.

## AWS CLI

```bash
aws sso login --profile learn-admin
aws sts get-caller-identity
MSYS_NO_PATHCONV=1 aws logs tail /aws/lambda/<fn> --follow   # leading "/" needs MSYS_NO_PATHCONV in Git Bash
aws dynamodb scan --table-name <t> --max-items 5 | jq '.Items'
aws sqs get-queue-attributes --queue-url <url> --attribute-names All | jq '.Attributes'
aws ce get-cost-and-usage --time-period Start=2026-10-01,End=2026-10-31 \
  --granularity MONTHLY --metrics UnblendedCost --group-by Type=TAG,Key=Project | jq
```

Tip: put `export MSYS_NO_PATHCONV=1` in `~/.zshrc` if you rarely pass Windows paths to tools.

## Cost traps (check before every apply)

| Trap | Cost | Avoid by |
|---|---|---|
| NAT Gateway | ~$33/month per AZ + $0.045/GB | Lab mode, single AZ, destroy same day; or endpoints / NAT instance |
| Interface VPC endpoints | ~$7/month per endpoint per AZ | Only in labs; S3/DynamoDB **gateway** endpoints are free |
| ALB / NLB | ~$16/month + LCUs | Destroy after lab |
| Public IPv4 addresses | $0.005/h each (~$3.60/month), incl. idle Elastic IPs | Release EIPs; check VPC → Elastic IPs |
| RDS left running | ~$12+/month for the smallest | Destroy after lab; don't rely on "stop" (auto-restarts after 7 days) |
| EKS control plane | $0.10/h (~$73/month) | One-day labs only |
| CloudWatch Logs without retention | Storage grows forever | `retention_in_days = 7` in every module |
| KMS customer-managed keys | $1/month each | Use AWS-managed keys unless you need a CMK |
| Secrets Manager | $0.40/secret/month | Fine, but delete lab secrets (they have a recovery window) |
| Route 53 hosted zone | $0.50/month | Only if you buy a domain |
| Orphaned EBS volumes / snapshots | $0.08/GB-month (gp3) | Check EC2 → Volumes/Snapshots after labs |

## Teardown checklist (after a lab)

1. `terragrunt run --all destroy` in the lab project folder.
2. Console sweep in us-east-1: EC2 (instances, volumes, EIPs, load balancers), VPC (NAT gateways, endpoints), RDS, EKS, ECS.
3. Cost Explorer next day, grouped by `Unit` tag. Anything non-zero you don't recognize?
4. Disable the lab hookify reminder (`/ecc:hookify-configure`).

## Progress tracker

| Module | Done | Notes / what the reviewers caught |
|---|---|---|
| 0 ECC primer | ☐ | |
| 1 Foundations | ☐ | |
| 2 P1 Serverless API | ☐ | |
| 3 P2 Static frontend | ☐ | |
| 4 P3 Event pipeline | ☐ | |
| 5 P4 Auth + CI/CD | ☐ | |
| 6 P5 Three-tier VPC | ☐ | |
| 7 P6 Containers | ☐ | |
