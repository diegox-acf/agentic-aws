# Module 5 · P4 · Auth and CI/CD

Two production concerns that most tutorials skip: **who is calling** (Cognito + JWT
authorizers) and **who is deploying** (GitHub Actions assuming an AWS role via OIDC, with
no stored keys). Both are really IAM and trust-policy lessons.

**Time:** 2 weekends · **Cost:** ≈ $0 (Cognito Essentials includes 10,000 MAU free; GitHub Actions free minutes on private repos)

## What you'll learn

| AWS | ECC |
|---|---|
| Cognito user pools, app clients, managed login, OAuth 2.0 authorization code + PKCE | `/ecc:orch-change-feature`: changing working behavior (anonymous → owned links) |
| ID token vs access token, scopes, JWT validation | `ecc:security-reviewer` + `/ecc:santa-loop` on trust policies |
| HTTP API **JWT authorizers** (issuer, audience) | `/ecc:pr`, `/ecc:review-pr`, `/ecc:code-review` on a GitHub PR |
| IAM OIDC identity providers, `AssumeRoleWithWebIdentity` | `/ecc:security-scan` after adding CI secrets/config |
| Trust policy conditions on `sub` (repo, branch, environment) | |
| Separating plan (read-only) and apply (write) roles | |

## Part A · Cognito + JWT authorizer

### Architecture

```
 browser (P2) ──► Cognito managed login (authorization code + PKCE)
      │                  │ tokens (id, access, refresh)
      │◄─────────────────┘
      │ Authorization: Bearer <access token>
      ▼
 HTTP API ── JWT authorizer (issuer = user pool, audience = app client id)
      │  claims.sub available to Lambda as event.requestContext.authorizer.jwt.claims
      ▼
 Lambda (P1) ── links now have owner = sub; GET /links lists only mine (GSI owner)
```

### Steps

1. **Plan the change** (this alters behavior of a working feature, so use the change pipeline):

   ```
   /ecc:orch-change-feature P1 links get an owner. POST /links and GET /links (list mine)
   require a valid Cognito access token via an HTTP API JWT authorizer; GET /{code} stays public.
   Owner = token sub. Add a GSI owner-createdAt to the links table. Existing anonymous links keep
   working for redirects but are not listed. P2 gets sign-in via Cognito managed login with
   authorization code + PKCE (no client secret), tokens kept in memory, not localStorage.
   ```

   At Gate 1, ask: "Why access token and not ID token for the API? Why PKCE and not the
   implicit flow?" Make sure you agree with the answers before approving.

2. **Write the authorizer yourself** in the `http-api` module:

   ```hcl
   resource "aws_apigatewayv2_authorizer" "jwt" {
     count            = var.jwt == null ? 0 : 1
     api_id           = aws_apigatewayv2_api.this.id
     authorizer_type  = "JWT"
     identity_sources = ["$request.header.Authorization"]
     name             = "cognito"
     jwt_configuration {
       issuer   = var.jwt.issuer   # https://cognito-idp.us-east-1.amazonaws.com/<pool id>
       audience = var.jwt.audience # [app client id]
     }
   }
   ```

   Routes then need `authorization_type = "JWT"` and `authorizer_id`, per route. Model
   that as a per-route flag rather than all-or-nothing.

3. **Cognito module:** user pool (email sign-in, MFA optional TOTP, password policy),
   a public app client (`generate_secret = false`,
   `allowed_oauth_flows = ["code"]`, callback URLs = CloudFront + localhost), a managed
   login domain prefix. Create a test user with
   `aws cognito-idp admin-create-user`.

4. **Prove it in the browser** with the chrome-devtools MCP: sign in, create a link, inspect
   the `Authorization` header, decode the token at a JWT decoder, and find `sub`, `iss`,
   `client_id`, `token_use`, `exp`.

5. **Security review** of the whole flow:

   ```
   > Use ecc:security-reviewer on the Cognito, http-api changes and apps/p2-web auth code.
   > Check: token storage, redirect URI allow-list, audience validation, CORS with credentials,
   > IDOR on GET /links/{code} (can I read stats for someone else's link?).
   ```

## Part B · CI/CD with GitHub OIDC

### Architecture

```
 GitHub Actions job ── requests OIDC token (aud: sts.amazonaws.com,
       │                sub: repo:<you>/learn-aws:pull_request  or
       │                     repo:<you>/learn-aws:environment:dev)
       ▼
 AWS STS AssumeRoleWithWebIdentity
       │ trust policy checks iss, aud, sub
       ├─► role "gha-plan"  (ReadOnlyAccess + state bucket read + lock write)  ← PRs
       └─► role "gha-apply" (deploy permissions)                               ← main, env "dev" with required reviewer
```

### Steps

1. Create a **private** GitHub repo and push. Check nothing secret is committed first:

   ```
   > Use the ecc:security-reviewer agent to scan the repo for secrets, account IDs in
   > places that will be public, and tfstate files before I push.
   ```

2. Unit `infra/live/global/github-oidc`: write this one yourself.

   ```hcl
   resource "aws_iam_openid_connect_provider" "github" {
     url            = "https://token.actions.githubusercontent.com"
     client_id_list = ["sts.amazonaws.com"]
   }

   data "aws_iam_policy_document" "plan_trust" {
     statement {
       actions = ["sts:AssumeRoleWithWebIdentity"]
       principals {
         type        = "Federated"
         identifiers = [aws_iam_openid_connect_provider.github.arn]
       }
       condition {
         test     = "StringEquals"
         variable = "token.actions.githubusercontent.com:aud"
         values   = ["sts.amazonaws.com"]
       }
       condition {
         test     = "StringLike"
         variable = "token.actions.githubusercontent.com:sub"
         values   = ["repo:${var.github_repo}:pull_request"]
       }
     }
   }
   ```

   The apply role's trust uses
   `repo:${var.github_repo}:environment:dev` (StringEquals), so only jobs bound to the
   protected `dev` environment can assume it.

3. **Get a second opinion on the trust policies.** A wrong `sub` condition (e.g. `repo:*`)
   lets any GitHub repo in the world assume your role:

   ```
   /ecc:santa-loop review infra/modules/github-oidc trust and permission policies
   ```

   Two independent reviewers must both approve.

4. Workflows (`.github/workflows/`):
   - `plan.yml` on `pull_request`: `permissions: id-token: write, contents: read`,
     `aws-actions/configure-aws-credentials` with the plan role, install
     Terraform + Terragrunt, build artifacts, `terragrunt run --all plan` for changed projects,
     post the summary as a PR comment.
   - `deploy.yml` on push to `main`: `environment: dev` (add yourself as a required reviewer
     in GitHub settings), apply role, build, `terragrunt run --all apply`, then
     P2's S3 sync + invalidation.

   Ask Claude to write them using `ecc:deployment-patterns`, then review them yourself line by
   line. You should be able to explain every permission.

5. Use the PR flow for the rest of the tutorial:

   ```
   git switch -c feat/p4-auth
   /ecc:prp-commit commit the auth changes
   /ecc:pr
   /ecc:review-pr            # multi-agent review of the PR
   ```

   Merge only when the plan comment and the review look right.

6. Since `.github/` and CI config are agent-adjacent surfaces too, run `/ecc:security-scan`.

---

## Check yourself (no Claude)

1. In the OIDC trust policy, what do `aud` and `sub` each protect against?
2. Why is `ReadOnlyAccess` not quite enough for `terraform plan` with an S3 backend using native locking?
3. Access token vs ID token: which goes to your API, and why?
4. Where does the HTTP API JWT authorizer get the keys to verify signatures?
5. What's an IDOR, and where could one exist in P1 now that links have owners?
6. Why keep tokens in memory instead of `localStorage` in the SPA, and what does that cost you on page reload?

## Stretch goals

- Add a Cognito **pre-token-generation** Lambda that adds a `plan: free|pro` claim; enforce a links-per-user quota.
- Restrict the apply role to a permissions boundary so CI can create roles only within that boundary.
- Add `terragrunt hclfmt --check` and `tflint` to `plan.yml`. Fix what they find with `/ecc:build-fix`.
- Add Checkov or Trivy IaC scanning and triage findings with `ecc:security-reviewer`.

## Teardown

Cognito and IAM cost nothing idle. Keep them; P5/P6 deploy through the same pipeline.
