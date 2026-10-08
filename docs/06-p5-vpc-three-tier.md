# Module 6 · P5 · Classic three-tier in a VPC (Spring Boot)

Serverless hid the network from you. Here you build it: a VPC across two AZs, a public
load balancer, an Auto Scaling group of EC2 instances in private subnets, and PostgreSQL
on RDS. It's the architecture most companies still run, and the one most AWS design
questions are about.

**Time:** 2–3 weekends, in **lab sessions** · **Cost:** ≈ $0.15/hour while deployed.
**Deploy, learn, destroy the same day.** Left running for a month it's ≈ $100.

## What you'll learn

| AWS | ECC |
|---|---|
| VPC, CIDR planning, public vs private subnets, route tables, IGW | `ecc:architect` agent for design, `ecc:architecture-decision-records` for the egress decision |
| Egress options: NAT Gateway vs NAT instance vs VPC endpoints, and their costs | `ecc:springboot-tdd` with Testcontainers (your Docker) |
| Security groups referencing security groups; NACLs | `ecc:springboot-patterns`, `ecc:jpa-patterns`, `ecc:database-migrations` |
| ALB, listeners, target groups, health checks | `ecc:java-reviewer` and `ecc:database-reviewer` agents |
| Launch templates, IMDSv2, instance profiles, Auto Scaling target tracking | `/ecc:build-fix` (delegates to `java-build-resolver`) |
| RDS PostgreSQL, subnet groups, parameter groups, backups, Multi-AZ vs read replicas | `/ecc:hookify` to warn when a lab stack is still deployed at session end |
| Secrets Manager (RDS-managed master password), SSM Session Manager instead of SSH | |

## Architecture

```
                         VPC 10.20.0.0/16  (us-east-1a, us-east-1b)
 ┌────────────────────────────────────────────────────────────────────────────────┐
 │  public  10.20.0.0/24  (a)              public  10.20.1.0/24  (b)              │
 │    ALB node ◄──────── internet (80/443) ────────► ALB node                     │
 │    NAT Gateway (lab: one AZ only)                                              │
 │          │ sg-alb → sg-app:8080                                                │
 │  private-app 10.20.10.0/24 (a)          private-app 10.20.11.0/24 (b)          │
 │    EC2 t4g.small (ASG)                    EC2 t4g.small (ASG)                  │
 │    Spring Boot :8080, IMDSv2, SSM agent   ...                                  │
 │          │ sg-app → sg-db:5432                                                 │
 │  private-db 10.20.20.0/24 (a)           private-db 10.20.21.0/24 (b)           │
 │    RDS PostgreSQL db.t4g.micro (single-AZ in lab)                              │
 │                                                                                │
 │  S3 gateway endpoint (free) ── artifact bucket (app jar)                       │
 └────────────────────────────────────────────────────────────────────────────────┘
 Secrets Manager: RDS-managed master secret    SSM Session Manager: shell access, no port 22
```

## Cost (lab mode, us-east-1, approximate)

| Resource | Hourly | Notes |
|---|---|---|
| ALB | ~$0.023 + LCUs | Plus 2 public IPv4 addresses |
| NAT Gateway (1 AZ) | ~$0.045 + $0.045/GB | The classic surprise bill. One AZ only in lab |
| 2 × EC2 t4g.small | ~$0.034 | |
| RDS db.t4g.micro, 20 GB gp3 | ~$0.016 | Single-AZ, no final snapshot |
| Public IPv4 (ALB ×2, NAT EIP) | ~$0.015 | $0.005/h each |
| Secrets Manager secret | ~$0.0006 | $0.40/month |
| **Total** | **≈ $0.13–0.15/h** | 4-hour lab ≈ $0.60 |

## Repo layout

```
apps/p5-notes-api/                 # Spring Boot 3, Java 21, Gradle
infra/modules/{network,alb-asg-app,rds-postgres,artifact-bucket}
infra/live/dev/p5-three-tier/
├── network/       # VPC, subnets, routes, NAT, S3 gateway endpoint
├── artifacts/     # S3 bucket for the jar
├── database/      # depends on network
└── app/           # depends on network, database, artifacts
```

---

## M1 · Design before any HCL

```bash
cp -R ~/.claude/plugins/cache/ecc/ecc/2.2.3/rules/java .claude/rules/ecc/
```

```
> Use the ecc:architect agent. Design the network for P5: ALB + EC2 ASG (Spring Boot) + RDS
> Postgres, 2 AZs, app and DB in private subnets, budget-constrained lab (deployed a few hours
> at a time). Give a CIDR plan, route tables, security group rules, and compare 4 egress
> options for the private app subnets: NAT Gateway (1 vs 2 AZs), NAT instance (e.g. fck-nat),
> interface VPC endpoints only (ssm, ssmmessages, ec2messages, secretsmanager, logs), and
> public subnets with no public IP exposure via SGs. Include hourly cost for each.
```

Then record your choice:

```
> Use ecc:architecture-decision-records to write docs/adr/0003-p5-egress.md with the option
> I picked and why.
```

The egress question is the most important lesson in this module. Private instances have no
route to the internet, but they still need to reach SSM, Secrets Manager, CloudWatch, and a
package repo. Every way of allowing that costs something.

## M2 · Network (you write it)

Write `infra/modules/network` yourself. Hints, not code:

- `aws_vpc` with DNS support + hostnames (needed for endpoints and RDS DNS names).
- `for_each` over a map of AZ → CIDRs per tier, not `count`, so adding an AZ doesn't
  renumber everything.
- One public route table → IGW. Private-app route table(s) → NAT. Private-db route table with
  **no** default route at all.
- `aws_vpc_endpoint` type `Gateway` for S3, attached to the private route tables. Free.
- Variable `nat_mode = "single" | "per_az" | "none"` with a `validation` block.

Review:

```
> Use ecc:code-reviewer on infra/modules/network. Then explain, for a packet from an app
> instance to the S3 artifact bucket, which route table entry matches and why.
```

Apply only the network unit, then explore in the console: VPC → Resource map. It draws
your subnets, route tables, and gateways. Compare it with the diagram above.

## M3 · The app, test-first

```
/ecc:plan apps/p5-notes-api: Spring Boot 3, Java 21, Gradle. CRUD for notes {id, title, body,
createdAt, updatedAt} at /api/notes, Flyway migrations, Spring Data JPA, Actuator health at
/actuator/health with DB check. DB credentials from Secrets Manager via spring.config.import
(spring-cloud-aws). Tests: Testcontainers Postgres. Use ecc:springboot-tdd and ecc:jpa-patterns.
```

Implement with the `ecc:springboot-tdd` skill. When the Gradle build breaks: `/ecc:build-fix`.
Then:

```
> Use ecc:java-reviewer on apps/p5-notes-api, then ecc:database-reviewer on the Flyway
> migrations and JPA mappings (indexes, N+1, transaction boundaries).
```

## M4 · Database + app infrastructure

**`rds-postgres` module.** Key settings and why:

```hcl
resource "aws_db_instance" "this" {
  identifier                  = "${var.project}-${var.env}-${var.name}"
  engine                      = "postgres"
  engine_version              = var.engine_version   # pick a current major, e.g. "17"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  storage_type                = "gp3"
  db_name                     = "notes"
  username                    = "notes_admin"
  manage_master_user_password = true                 # RDS creates + rotates a Secrets Manager secret
  db_subnet_group_name        = aws_db_subnet_group.this.name
  vpc_security_group_ids      = [aws_security_group.db.id]
  multi_az                    = false                # lab; true doubles the cost
  publicly_accessible         = false
  storage_encrypted           = true
  backup_retention_period     = 1
  skip_final_snapshot         = true                 # lab only
  deletion_protection         = false                # lab only
  apply_immediately           = true
}
```

**`alb-asg-app` module.**

- Launch template: AMI from SSM parameter
  `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64`,
  `t4g.small`, `metadata_options { http_tokens = "required" }` (IMDSv2),
  instance profile with `AmazonSSMManagedInstanceCore` + `s3:GetObject` on the jar +
  `secretsmanager:GetSecretValue` on the RDS secret ARN only.
- User data: `dnf install -y java-21-amazon-corretto-headless`, `aws s3 cp` the jar,
  write a systemd unit, start it. Pass the secret ARN as an env var.
- ALB in public subnets, target group on 8080 with health check `/actuator/health`,
  `deregistration_delay = 30`.
- ASG: min 2 / max 4 / desired 2 across both private-app subnets,
  `health_check_type = "ELB"`, target tracking on `ALBRequestCountPerTarget`.
- Security groups: `alb` allows 80 from `0.0.0.0/0`; `app` allows 8080 **from sg-alb only**;
  `db` allows 5432 **from sg-app only**. No port 22 anywhere.

Security pass before the first apply:

```
> Use ecc:security-reviewer on infra/modules/{network,rds-postgres,alb-asg-app}: SG rules,
> IAM instance profile scope, IMDS, public exposure, secrets handling in user data.
```

## M5 · Lab session: deploy, poke, break, destroy

```bash
root=$(git rev-parse --show-toplevel)
(cd "$root/apps/p5-notes-api" && ./gradlew bootJar)
cd "$root/infra/live/dev/p5-three-tier"
terragrunt run --all apply                     # network → artifacts/database → app
# upload the jar to the artifact bucket, then refresh instances:
bucket=$(cd artifacts && terragrunt output -raw bucket_name)
asg=$(cd app && terragrunt output -raw asg_name)
aws s3 cp "$root"/apps/p5-notes-api/build/libs/*-SNAPSHOT.jar "s3://$bucket/notes-api.jar"
aws autoscaling start-instance-refresh --auto-scaling-group-name "$asg"
```

Experiments (write down what you expect before each one):

1. `curl http://<alb dns>/api/notes`. Create and list notes.
2. **Session Manager:** EC2 → instance → Connect → Session Manager. From the instance,
   `curl -s localhost:8080/actuator/health`. Try `curl https://example.com`. Works via NAT;
   would fail with `nat_mode = "none"`.
3. **Kill an instance.** Terminate one in the console; watch the target go unhealthy and
   the ASG replace it. How long did it take, and which settings controlled that?
4. **Scale out.** Load test from your machine (`oha` or `hey`) and watch the target tracking
   alarm → new instance → registered target.
5. **Break the SG.** Remove the app → db rule. What does the health check report, and how
   fast? Restore it.
6. **Secret rotation.** Rotate the RDS master secret in Secrets Manager. Does the app survive
   without a restart? (Usually not, and fixing that is a good stretch.)

Then, **same day**:

```bash
terragrunt run --all destroy                   # reverse dependency order
```

Make forgetting harder. Hookify `stop` rules can't inspect AWS; they fire on every stop
(pattern `.*`). So create one that's **disabled by default** and switch it on only for lab
days:

```
/ecc:hookify warn on stop: "If the P5 lab stack is deployed, destroy it before you leave
(~$0.15/hour). Run: cd infra/live/dev/p5-three-tier; terragrunt run --all destroy"
```

Then `/ecc:hookify-configure` → enable it at the start of a lab session, disable it after
the destroy. Your $5 budget alert from Module 1 is the backstop.

## M6 · Verify, learn

```
ecc:verification-loop
/ecc:learn-eval
```

Add rules to `aws-terraform`: SG-to-SG references, IMDSv2 required, no port 22, NAT cost
warning, `manage_master_user_password`.

---

## Check yourself (no Claude)

1. Your private-db route table has no `0.0.0.0/0` route. How does RDS still get patched and backed up?
2. Security groups are stateful and NACLs are stateless. Give a concrete rule you'd need in a NACL but not in an SG.
3. Why does an ALB require subnets in at least two AZs?
4. An instance passes EC2 status checks but the ASG replaces it anyway. Why? (`health_check_type`)
5. Multi-AZ RDS vs a read replica: which one helps availability, which one helps read scale, and can one be both?
6. What does IMDSv2 protect against, and which class of web vulnerability does it mitigate?
7. Monthly cost of NAT Gateway in 2 AZs with 50 GB processed vs 5 interface endpoints in 2 AZs.

## Stretch goals

- Swap the NAT Gateway for a NAT instance, then for interface endpoints only. Measure the bill difference in Cost Explorer by `Unit` tag.
- Add HTTPS: ACM cert + 443 listener + HTTP→HTTPS redirect (needs a domain).
- Turn on Multi-AZ for one session and trigger a failover (`aws rds reboot-db-instance --force-failover`). Time the outage the app sees.
- Bake an AMI with the app (EC2 Image Builder or Packer) instead of downloading at boot; compare scale-out time.
- Add an RDS Proxy and explain when it is worth its cost.

## Teardown

**Mandatory after every lab session:**

```bash
cd infra/live/dev/p5-three-tier && terragrunt run --all destroy
```

Verify in the console: no NAT Gateways, no load balancers, no RDS instances, no
unattached Elastic IPs (VPC → Elastic IPs).
