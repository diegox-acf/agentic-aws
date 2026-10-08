# Learn AWS with ECC

A hands-on path through AWS, built as a series of small but real apps. Every app is
provisioned with **Terraform + Terragrunt** and built with **Claude Code + ECC**
(Everything Claude Code, `ecc@ecc` plugin v2.2.3) as your engineering harness.

Two things are being learned at once:

1. **AWS** (primary) — serverless, data, networking, security, delivery, and later containers.
2. **ECC** (secondary) — planning, TDD, review, verification, hooks, skills, and session memory.

No certification target. The goal is a mental model you can apply at work.

## How to use this tutorial

Work through the modules in order. Each project module has the same shape:

| Section | What it gives you |
|---|---|
| What you'll learn | The AWS concepts the project exists to teach |
| Architecture | ASCII diagram of the resources |
| Cost | What it costs and how to keep it near $0 |
| Build steps | Milestones, each with the ECC command or prompt to drive it |
| Check yourself | Questions to answer *without* Claude before moving on |
| Stretch goals | Optional extensions |
| Teardown | How to destroy everything |

**Learning rule:** let ECC plan, test, and review, but write at least one Terraform module
and one handler per project yourself. Ask Claude to review your version instead of
generating it. You learn AWS by making the mistakes, not by reading generated code.

## Modules

| # | Module | AWS focus | Language | ECC focus |
|---|---|---|---|---|
| 0 | [ECC primer](00-ecc-primer.md) | — | — | Concepts, commands, hooks, rules, skills, sessions |
| 1 | [Foundations](01-foundations.md) | IAM Identity Center, Budgets, S3 state, tagging | HCL | Project CLAUDE.md, rule packs, a custom `aws-terraform` skill, hookify |
| 2 | [P1 · Serverless URL shortener](02-p1-serverless-api.md) | Lambda, API Gateway HTTP API, DynamoDB, CloudWatch | Go | `/ecc:plan`, `/ecc:go-test`, `/ecc:go-review`, security-reviewer |
| 3 | [P2 · Static frontend on the edge](03-p2-static-frontend.md) | S3, CloudFront + OAC, CORS, caching | Next.js / TS | `/ecc:react-test`, `/ecc:react-review`, frontend-design |
| 4 | [P3 · Event-driven import pipeline](04-p3-event-pipeline.md) | S3 events, EventBridge, SQS + DLQ, SNS, Step Functions | TypeScript | `/ecc:orch-add-feature`, silent-failure-hunter, `/ecc:orch-fix-defect` |
| 5 | [P4 · Auth and CI/CD](05-p4-auth-and-cicd.md) | Cognito, JWT authorizers, GitHub OIDC, IAM trust policies | Go + TS | `/ecc:orch-change-feature`, `/ecc:pr`, `/ecc:code-review` |
| 6 | [P5 · Classic three-tier in a VPC](06-p5-vpc-three-tier.md) | VPC, subnets, SGs, ALB, ASG, RDS, Secrets Manager, SSM | Java / Spring Boot | architect agent, ADRs, java-reviewer, database-reviewer |
| 7 | [P6 · Containers (later)](07-p6-containers.md) | ECR, ECS Fargate, autoscaling, then EKS | Java or Go | docker-patterns, kubernetes-patterns, `/ecc:build-fix` |
| — | [Cheat sheet](99-cheatsheet.md) | Cost traps, teardown, commands | — | Command matrix |

## Your machine (checked 2026-10-08, after Module 1)

| Tool | Version | Note |
|---|---|---|
| Claude Code + ECC | `ecc@ecc` 2.2.3, user scope, hook profile `standard` | Rule packs `common` + `golang` copied into `.claude/rules/ecc/` (plugins can't ship rules) |
| AWS CLI | 2.34.49 | SSO profile `learn-admin` (IAM Identity Center, `LearnAdmin` permission set), region `us-east-1` |
| Terraform | 1.16.5 | ≥ 1.10 needed for S3 native locking |
| Terragrunt | 1.1.1 | New CLI: `run --all`, `backend bootstrap`, `root.hcl` |
| Go | 1.26.2 | P1, P6 |
| Node | 24.13.0 | P2, P3 |
| Java | Temurin 21 | P5, P6 |
| Docker | 29.6.2 | P6 |

## Shell

All commands are **bash**, written for Git Bash or MSYS2 zsh on Windows (and they work as-is on
Linux/macOS/WSL). Two Windows-specific habits:

- **Persistent env vars:** `setx NAME value` writes a Windows user variable that every shell,
  Claude Code tool, and IDE sees. It only affects *new* terminals. `export NAME=value` is for the
  current shell only.
- **MSYS path conversion:** Git Bash rewrites arguments that start with `/` into Windows paths,
  so `aws logs tail /aws/lambda/fn` becomes `C:/Program Files/Git/aws/lambda/fn`. Prefix such
  commands with `MSYS_NO_PATHCONV=1` (the snippets in this tutorial already do).

## Target repo layout

You build this up gradually. After Module 1 you have `CLAUDE.md`, `.claude/`, `infra/root.hcl`,
and the `global/budget` unit; `apps/` and the `dev/` project units arrive with each project.

```
agentic-aws/
├── CLAUDE.md                     # project instructions for Claude (Module 1)
├── .claude/
│   ├── rules/ecc/                # ECC rule packs copied in (Module 1)
│   └── skills/aws-terraform/     # your custom skill (Module 1)
├── apps/                         # application code, one folder per project
│   ├── p1-shortener/             # Go
│   ├── p2-web/                   # Next.js
│   ├── p3-importer/              # TypeScript
│   └── p5-notes-api/             # Spring Boot
├── infra/
│   ├── root.hcl                  # shared Terragrunt config (state, provider, tags)
│   ├── modules/                  # your own reusable Terraform modules
│   └── live/
│       ├── global/               # budget, GitHub OIDC
│       └── dev/
│           ├── env.hcl
│           ├── p1-shortener/
│           ├── p2-web/
│           └── ...
└── docs/                         # this tutorial
```
