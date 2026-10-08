# Module 7 · P6 · Containers: ECS Fargate, then EKS (later)

You already know Docker and Kubernetes, so this module focuses on what AWS adds: the
registry, the IAM model for tasks and pods, load balancer integration, and the cost
shape of each option. Do it after P5. It reuses P5's VPC and Spring Boot app.

**Time:** 2 weekends (ECS) + 1 lab day (EKS) · **Cost:** ECS lab ≈ $0.10/h; EKS lab ≈ $0.25/h. Destroy the same day.

## What you'll learn

| AWS | ECC |
|---|---|
| ECR: repositories, image scanning, lifecycle policies, immutable tags | `ecc:docker-patterns`: multi-stage builds, non-root, small images |
| ECS concepts: cluster, task definition, service, Fargate vs EC2 capacity | `ecc:deployment-patterns`: rolling vs blue/green, health checks |
| **Task role vs task execution role** (the #1 ECS confusion) | `/ecc:build-fix` for Dockerfile / Gradle issues |
| `awsvpc` networking: a task gets its own ENI and security group | `ecc:kubernetes-patterns` for the EKS part |
| ALB target type `ip`, service auto scaling, Fargate Spot | `/ecc:orch-change-feature` to move P5 from EC2 to ECS |
| ECS deployment circuit breaker and rollback | `/ecc:model-route` to keep long infra sessions cheap |
| EKS: control plane cost, Auto Mode, Pod Identity, AWS Load Balancer Controller | `/ecc:learn-eval` → `/ecc:evolve` your instincts into a skill |

## Part A · ECS Fargate

### Architecture

```
 developer ──docker build/push──► ECR repo (scan on push, keep last 10 images)
                                        │
 internet ─► ALB (P5 public subnets) ─► target group (type ip, :8080)
                                        │
            ECS service "notes" (Fargate, desired 2, private-app subnets, sg-task)
              task: notes-api container
                execution role → pull from ECR, write logs, read the DB secret for `secrets`
                task role      → whatever the app itself calls (nothing, or S3)
                                        │ sg-task → sg-db:5432
                                   RDS (P5)
```

### Steps

1. **Containerize** the P5 app:

   ```
   > Using ecc:docker-patterns, write apps/p5-notes-api/Dockerfile: multi-stage (Gradle build →
   > Corretto 21 or distroless Java 21 runtime), non-root user, arm64, layered Spring Boot jar,
   > HEALTHCHECK not needed (ALB checks), .dockerignore. Explain each choice.
   ```

   Build and run it locally against a Postgres container before touching AWS.

2. **Plan the move** from EC2 to ECS:

   ```
   /ecc:orch-change-feature move P5's app tier from the EC2 ASG to ECS Fargate. Reuse the
   network, database, and ALB. New modules: ecr-repo, ecs-cluster, ecs-service. The DB password
   is injected via the task definition `secrets` from the RDS-managed secret (execution role
   reads it). Use Fargate Spot with a Fargate base of 1. Enable the deployment circuit breaker
   with rollback. Service auto scaling on ALBRequestCountPerTarget.
   ```

3. **Write the two roles yourself.** The ECS lesson is in these two IAM roles:

   | Role | Assumed by | Used for |
   |---|---|---|
   | Task **execution** role | ECS agent (`ecs-tasks.amazonaws.com`) | Pull the image, ship logs, fetch `secrets` before the container starts |
   | Task role | Your application code | AWS SDK calls the app makes at runtime |

   If the app fails with `AccessDenied` at runtime, it's the task role. If the task never
   starts and the error mentions `ResourceInitializationError`, it's usually the
   execution role, or networking: private subnets need a path to ECR, either NAT or
   endpoints for `ecr.api`, `ecr.dkr`, `logs`, and the S3 gateway endpoint.

4. **Push and deploy:**

   ```bash
   acct=$(aws sts get-caller-identity --query Account --output text)
   registry="$acct.dkr.ecr.us-east-1.amazonaws.com"
   repo="$registry/learn-aws-dev-notes"
   aws ecr get-login-password | docker login --username AWS --password-stdin "$registry"
   docker buildx build --platform linux/arm64 -t "$repo:$(git rev-parse --short HEAD)" --push apps/p5-notes-api
   ```

   Deploy by changing the image tag input and running `terragrunt apply`. Use immutable
   tags (git SHA), never `latest`.

5. **Experiments:**
   - Deploy an image whose health check fails. Watch the circuit breaker roll back.
   - Stop a task in the console. The service replaces it.
   - Interrupt behavior: how does the service react when Fargate Spot capacity is reclaimed?
   - `aws ecs execute-command` into a running task (requires `enableExecuteCommand` + SSM permissions on the task role).

6. **Review:** `> Use ecc:security-reviewer on the ecs-service module and Dockerfile` (root user? secrets in env vs `secrets`? overly broad execution role?).

## Part B · EKS (one lab day, later)

You know Kubernetes. What's new is the AWS integration, and the cost: the EKS control
plane is $0.10/hour (~$73/month) before any node runs. That's why EKS here is a single,
planned lab day.

### Before the lab

- Do the Kubernetes side locally first (kind or k3d) with the same manifests.
- Plan with ECC so the lab day is pure execution:

  ```
  /ecc:plan one-day EKS lab reusing P5's VPC: EKS Auto Mode cluster via Terraform
  (terraform-aws-modules/eks/aws), Pod Identity for the notes-api service account, the
  notes-api Deployment + Service + Ingress (ALB via Auto Mode's load balancing), HPA.
  Include an explicit teardown order (Ingress/ALB first, then cluster) and a cost estimate per hour.
  ```

- Use `ecc:kubernetes-patterns` for the manifests and review them before the lab.

### Lab day checklist

1. Apply the cluster unit (≈ 15 min). `aws eks update-kubeconfig --name <cluster>`.
2. Deploy manifests. Find the ALB the Ingress created in the EC2 console. Note it's **not** in Terraform state.
3. Pod Identity: give the pod S3 read on the artifact bucket and prove it from inside the pod.
4. Scale: HPA + Auto Mode adds nodes. Watch `kubectl get nodes -w`.
5. **Teardown in order:** delete the Ingress and Services of type LoadBalancer first (so the
   controller deletes the ALB/NLB), then `terragrunt destroy` the cluster. Otherwise
   Terraform can hang on the VPC because orphaned load balancers and ENIs still sit in it.

## Wrap-up: turn the tutorial into reusable knowledge

You've used ECC for six projects. Now let it consolidate:

```
/ecc:instinct-status          # what has it learned about how you work?
/ecc:evolve                   # proposes skills/agents from clustered instincts
/ecc:skill-create             # derive a learn-aws-patterns skill from your git history
/ecc:harness-audit            # final score vs Module 0
```

Compare what `/ecc:skill-create` produced with the `aws-terraform` skill you wrote by hand.
Merge the good parts. That skill is now the most valuable artifact of this tutorial:
reusable AWS + Terraform knowledge you can copy to `~/.claude/skills/` for work
projects (or promote instincts with `/ecc:promote`).

---

## Check yourself (no Claude)

1. Task role vs execution role: which one needs `secretsmanager:GetSecretValue` for task-definition `secrets`?
2. Why must the target group use `target_type = "ip"` for Fargate?
3. A Fargate task in a private subnet with no NAT and no endpoints fails to start. Exact reason?
4. ECS rolling update with `minimumHealthyPercent = 100`, `maximumPercent = 200`: what happens step by step?
5. ECS vs EKS for a 3-service app on a small team: which do you pick, and what would change your mind?
6. Why did the EKS-created ALB not appear in Terraform state, and what's the teardown risk?

## Stretch goals

- ECS blue/green deployments with test traffic on a second listener.
- Add the OpenTelemetry collector as a sidecar and send traces to X-Ray.
- Build the image in GitHub Actions with the P4 OIDC role and deploy on merge.
- Run Karpenter instead of Auto Mode on EKS and compare node provisioning.

## Teardown

```bash
cd infra/live/dev/p5-three-tier && terragrunt run --all destroy
```

For EKS: delete Kubernetes load balancers first, then the cluster. Check the console for
leftover load balancers, ENIs, and EBS volumes.
