# Module 0 · ECC primer

ECC ("Everything Claude Code", [github.com/affaan-m/ECC](https://github.com/affaan-m/ECC),
site [ecc.tools](https://ecc.tools)) is an open-source harness layer that sits on top of
Claude Code. It does not replace Claude; it gives Claude a repeatable engineering process
and a library of specialist knowledge.

Its core loop, in its own words:

```
plan -> test -> implement -> review -> verify -> remember -> improve
```

Every project in this tutorial runs that loop. This module teaches the parts so the
project modules can just say "run `/ecc:go-review`" without explaining it each time.

---

## 1. The six building blocks

| Block | What it is | Where it runs | How you use it |
|---|---|---|---|
| **Commands** | Slash entry points (94 in 2.2.3) | Your main session | Type `/ecc:plan "..."` |
| **Skills** | Reusable workflow + knowledge packs (~290) | Your main session, loaded on demand | Invoke by name (`/ecc:tdd-workflow`) or Claude loads one when its description matches the task |
| **Agents** | Subagents with a narrow role and restricted tools (~68) | A separate context window | "Use the `ecc:security-reviewer` agent on `infra/modules/lambda-api`" |
| **Hooks** | Scripts that fire on Claude Code events (PreToolUse, PostToolUse, Stop, SessionStart…) | Outside the model, deterministic | Automatic; you tune them with env vars |
| **Rules** | Always-loaded standards (coding style, testing, security, git) | Every prompt | Copied into `.claude/rules/` (not shipped by the plugin) |
| **Instincts / memory** | Patterns learned from your sessions, scored 0–1 | Injected at SessionStart | `/ecc:learn`, `/ecc:instinct-status`, `/ecc:evolve` |

The key distinction to internalize:

- **Skills and rules change what Claude knows.** They cost context tokens.
- **Agents change where work happens.** A review in a subagent gets a fresh context, so it is not biased by the code it just wrote.
- **Hooks change what is allowed to happen.** They are code, not prompts, so the model can't talk its way past them.

### Commands vs skills

ECC is migrating from commands to skills. Many commands are thin wrappers ("shims")
that just invoke a skill: `/ecc:orch-add-feature` launches the `orch-add-feature` skill.
Old short names like `/tdd`, `/eval`, `/verify` were retired; use the namespaced
`/ecc:...` forms or the skill names. Because ECC is installed as a plugin, everything is
namespaced with `ecc:`.

---

## 2. What is installed on your machine

| Item | State |
|---|---|
| Install method | Claude Code plugin `ecc@ecc` 2.2.3, user scope (`~/.claude/plugins/cache/ecc/ecc/2.2.3`) |
| Hooks | Enabled, profile `standard` (set in `~/.claude/settings.json` → `pluginConfigs.ecc@ecc.options`) |
| Rules | **None installed.** Claude Code plugins can't distribute rules. You add them in Module 1 |
| MCP servers | Only `chrome-devtools` from ECC. `context7` is **not** enabled, so the `ecc:docs-lookup` agent won't work until you add it |
| Other plugins | `frontend-design`, `gopls-lsp` enabled; `superpowers` disabled (good, it overlaps with ECC) |

**One install path only.** The README is explicit: don't also run `./install.sh` or
`pnpm dlx ecc-universal install --profile full` on top of the plugin. Duplicate hooks fire
twice and skills collide. To change scope or hook profile, use `/ecc:configure-ecc`.

Useful health commands (run in a normal terminal, not inside Claude):

```bash
pnpm dlx ecc-universal@2.2.3 list-installed
pnpm dlx ecc-universal@2.2.3 doctor
pnpm dlx ecc-universal@2.2.3 repair
```

---

## 3. Hooks you will actually meet

These are the hook IDs registered by your install. You will see some of them within
minutes of starting a session.

| Hook ID | When | What it does |
|---|---|---|
| `pre:edit-write:gateguard-fact-force` | First Edit/Write to each file | **GateGuard.** Blocks the first write and makes Claude state facts: who calls the file, that no duplicate exists, data shapes, your verbatim instruction. Then allows the retry |
| `pre:powershell:gateguard-fact-force` | First PowerShell command | Same idea for the shell: state the request and what the command does |
| `pre:config-protection` | Edits to config files | Guards linter/formatter/harness config from being "fixed" by weakening it |
| `pre:edit-write:suggest-compact` | During long edit runs | Suggests `/compact` at a logical boundary (see `ecc:strategic-compact`) |
| `pre:write:doc-file-warning` | Writing ad-hoc `.md` files | Warns about doc sprawl |
| `pre:mcp-health-check` / `post:mcp-health-check` | MCP calls | Detects dead MCP servers |
| `pre:observe`, `post:skill:track` | Tool and skill use | Feeds continuous learning and `/ecc:skill-health` |
| `stop:format-typecheck` | End of a turn | Runs formatter/type checks on edited files |
| `stop:check-console-log` | End of a turn | Flags leftover `console.log` |
| `stop:cost-tracker` | End of a turn | Records token cost → `/ecc:cost-report` |
| `stop:evaluate-session` | End of a turn | Scores the session for learnable patterns |
| `stop:desktop-notify` | End of a turn | Desktop notification when Claude finishes |
| `session-start-bootstrap` | Session start | Injects saved context and relevant instincts |

**GateGuard is the one that surprises people.** It feels like friction, but it is the
point: ECC's A/B tests show that forcing the model to *gather* facts (run Grep, read
callers) produces better edits than asking it "are you sure?". When you watch Claude
work in this repo you'll see it answer GateGuard before its first write to each file.
(This tutorial itself was written through GateGuard: every new file was denied once
until the facts were stated.)

### Tuning hooks (Windows)

`setx` stores a Windows user environment variable, so Claude Code sees it no matter which
shell launched it:

```bash
# Strictness: standard (default) | strict | permissive
setx ECC_HOOK_PROFILE standard

# Turn off specific hooks by ID (comma-separated)
setx ECC_DISABLED_HOOKS stop:desktop-notify

# Exempt paths from GateGuard's first-touch check (e.g. docs)
setx GATEGUARD_EXEMPT_GLOBS 'docs/**'

# Keep session temp files 14 days instead of 30
setx ECC_SESSION_RETENTION_DAYS 14
```

Open a new terminal and restart Claude Code after changing them. Don't exempt `infra/` from GateGuard;
that's where you want it most.

---

## 4. The commands that matter for this tutorial

You don't need 94 commands. These ~25 cover everything here.

### Plan

| Command | Use it when |
|---|---|
| `/ecc:plan "<feature>"` | Default. Restates requirements, lists risks, writes a step plan, **waits for your confirm** before touching code |
| `/ecc:plan-prd "<idea>"` | The idea is fuzzy. Produces a short problem-first PRD, then hands off to `/ecc:plan` |
| `/ecc:plan-canvas` | You want to annotate/approve a plan visually in the browser |
| `/ecc:feature-dev` | Guided feature work in an existing codebase |

Skip `/ecc:multi-plan` and the other `multi-*` commands; they need an external
runtime (`ccg-workflow`) that isn't part of the base install.

### Build with tests

| Command / skill | Use it when |
|---|---|
| `/ecc:go-test` | Go TDD: table-driven tests first, 80%+ coverage |
| `/ecc:react-test` | React TDD with Testing Library + Vitest/Jest |
| `ecc:tdd-workflow` (skill) | Language-agnostic red → green → refactor |
| `ecc:springboot-tdd` (skill) | Spring Boot TDD (JUnit 5, MockMvc, Testcontainers) |
| `/ecc:test-coverage` | Find gaps and generate missing tests |
| `/ecc:build-fix` | Build or type errors. Delegates to the right `*-build-resolver` agent with minimal diffs |

### Orchestrated pipelines (gated)

These run a whole Research → Plan → TDD → Review → Commit pipeline with **two approval
gates**: approve the plan (Gate 1), approve the commit (Gate 2).

| Command | Use it when |
|---|---|
| `/ecc:orch-add-feature "<what>"` | Brand-new capability |
| `/ecc:orch-change-feature "<what>"` | Changing behavior of something that works |
| `/ecc:orch-fix-defect "<bug>"` | Bug: reproduce as failing test → fix → review |
| `/ecc:orch-refine-code "<area>"` | Behavior-preserving refactor |
| `/ecc:orch-build-mvp <spec>` | Bootstrap an MVP from a spec doc |

### Review

| Command / agent | Use it when |
|---|---|
| `/ecc:code-review` | Step-by-step checklist review of uncommitted changes or a PR |
| `/ecc:go-review`, `/ecc:react-review`, … | Language-specific reviewer agents |
| `/ecc:review-pr` | Multi-agent PR review (code, comments, tests, silent failures, types) |
| `/ecc:orch-review` | Adversarially verified review, blocking vs advisory findings |
| `ecc:security-reviewer` (agent) | Anything touching IAM, auth, input handling, secrets |
| `ecc:silent-failure-hunter` (agent) | Swallowed errors, bad fallbacks. Gold for async pipelines |
| `/ecc:santa-loop` | Two independent reviewers must both approve. Use on IAM policies |

Note: Claude Code also has a built-in `/code-review` (no `ecc:` prefix) with effort
levels. Both are fine; the ECC one follows ECC's checklist and rules.

### Verify

| Command / skill | Use it when |
|---|---|
| `ecc:verification-loop` (skill) | Before a commit/PR: build, types, lint, tests+coverage, security grep, diff review → PASS/FAIL report |
| `/ecc:quality-gate <file>` | Formatter/quality gate on one file |
| `/ecc:checkpoint` | Create/verify named checkpoints during a long task |

### Remember and improve

| Command | Use it when |
|---|---|
| `/ecc:save-session` | Stopping mid-task. Writes state to `~/.claude/session-data/` |
| `/ecc:resume-session` | Starting the next day |
| `/ecc:aside "<question>"` | Side question ("SQS visibility timeout vs Lambda timeout?") without derailing the task |
| `/ecc:learn-eval` | End of a project. Extracts reusable patterns, self-evaluates them, asks where to save |
| `/ecc:instinct-status` | See what ECC has learned about you, with confidence scores |
| `/ecc:evolve` | Cluster instincts into proposed skills/agents |
| `/ecc:skill-create` | Generate a `SKILL.md` from this repo's git history |
| `/ecc:hookify "<behavior>"` | Turn a rule into an enforced hook ("warn me before any terragrunt apply") |

### Context and cost

| Command / skill | Use it when |
|---|---|
| `ecc:context-budget` (skill) | Find out what's eating your context window |
| `ecc:strategic-compact` (skill) | Learn when to `/compact` (between phases, not mid-task) |
| `/ecc:cost-report` | Spend summary from the cost-tracker hook |
| `/ecc:model-route` | Pick a model tier for a task |

### Navigation

| Command | Use it when |
|---|---|
| `/ecc:ecc-guide` | "Is there an ECC skill/agent/command for X?" Answers from the installed repo |
| `/ecc:harness-audit` | Scorecard of how well this repo is set up for agent work |
| `/ecc:security-scan` | AgentShield audit of **agent config**: hooks, MCP, permissions, secrets in `.claude/`. It does not review app code; use `ecc:security-reviewer` for that |

---

## 5. How a typical ECC session flows

```
/ecc:resume-session                     # (optional) pick up yesterday's state
/ecc:plan "add a GET /{code} redirect"  # read the plan critically; edit; confirm
  -> implement with /ecc:go-test        # failing test first, then code
  -> /ecc:go-review                     # fresh-context review in a subagent
  -> ecc:verification-loop              # PASS/FAIL report
  -> terragrunt plan  (you read it)     # infra diff, human-reviewed
  -> terragrunt apply (you run it)
/ecc:learn-eval                         # keep what was worth learning
/ecc:save-session                       # if you're stopping mid-way
```

For bigger features, replace the middle with one `/ecc:orch-add-feature` call and
honor its two gates.

---

## 6. Using ECC to *learn*, not just to ship

ECC is tuned to produce working code fast. When learning, slow it down on purpose.

| Instead of | Try |
|---|---|
| "Write the DynamoDB module" | "Don't write code. List what a DynamoDB table module needs as inputs/outputs and why. I'll write it, then you review it with `ecc:security-reviewer`." |
| Accepting the plan | Ask "what are two alternative AWS designs and why did you reject them?" Record the answer as an ADR (`ecc:architecture-decision-records`) |
| Asking Claude to fix an error | Read the error first, write your hypothesis, then `/ecc:aside "is my hypothesis right: ..."` |
| Moving to the next project | Answer the "Check yourself" questions without Claude, then ask Claude to grade your answers |
| Re-reading docs | "Quiz me with 5 questions on IAM trust vs permission policies, one at a time" |

---

## 7. Your first 20 minutes with ECC

Do these now, inside `learn-aws`:

1. `claude` → `/ecc:ecc-guide` → ask: "Which ECC skills and agents are relevant for AWS + Terraform work?" The answer will be mostly generic (backend, deployment, docker, security). ECC has **no Terraform/AWS-specific skill**. You'll write one in Module 1.
2. `/ecc:aside "explain the difference between an ECC skill, agent, hook, and rule in two lines each"`. Compare with the table above.
3. `/ecc:harness-audit` → read the scorecard for this (still empty) repo. Run it again after Module 1 to see the score move.
4. `/ecc:plan "create a hello-world Go CLI in apps/hello"` → read the plan, then **reject** it and ask for a smaller one. Get used to the plan/confirm gate.
5. Check `/ecc:cost-report` at the end of the day.

## 8. Pitfalls

- **Context weight.** ~290 skills means a big skill catalogue. Use `ecc:context-budget` if sessions feel sluggish, and keep enabled MCP servers under ~10.
- **Windows native caveats.** As of 2.2.3, ECC has open issues for the continuous-learning daemon and memory-vault writes on native Windows ([#2489](https://github.com/affaan-m/ECC/issues/2489), [#2626](https://github.com/affaan-m/ECC/issues/2626)). Manual `/ecc:learn` and `/ecc:save-session` work. If instincts never appear, that's why; WSL is the workaround.
- **Don't let hooks become noise.** If a hook fires constantly and you always dismiss it, disable that hook ID instead of learning to ignore all hooks.
- **Plans are drafts.** `/ecc:plan` is good at structure but will happily pick expensive AWS defaults (NAT gateways, multi-AZ RDS). Always check cost in the plan.
- **Agents inherit your AWS credentials.** Anything Claude runs in the shell runs as you. Module 1 sets up guardrails before any `apply`.

## Sources

- ECC repository and README: <https://github.com/affaan-m/ECC>
- Shortform guide: <https://github.com/affaan-m/ECC/blob/main/the-shortform-guide.md>
- Command quick reference: <https://github.com/affaan-m/ECC/blob/main/COMMANDS-QUICK-REF.md>
- Local install: `~/.claude/plugins/cache/ecc/ecc/2.2.3/` (README, `commands/`, `skills/`, `hooks/hooks.json`)
