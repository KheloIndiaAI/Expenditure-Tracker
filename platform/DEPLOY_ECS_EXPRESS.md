# EFIP — Deployment on Amazon ECS Express Mode + RDS (dev & prod accounts)

> **Why not App Runner?** As of **30 April 2026, AWS App Runner stopped accepting
> new customers**. AWS's recommended replacement is **Amazon ECS Express Mode** —
> a managed, Fargate-backed way to run a container that auto-provisions the
> service, an Application Load Balancer with SSL/TLS, a public HTTPS URL, auto
> scaling, and monitoring from just a container image + two IAM roles. It runs
> Fargate **inside your VPC**, so reaching a private RDS is native (security
> groups), and everything it creates stays visible/editable in your account.

The container work is identical to any container host — **the image, RDS,
secrets, and seed steps below are unchanged**; only the compute layer is ECS
Express instead of App Runner.

Run the **same steps in each account** (dev, then prod). Everything is
per-account and isolated — no cross-account sharing of DB or bucket. Only `<...>`
values differ.

> Sizing for ~100 concurrent users: one Express service (Fargate 0.5–1 vCPU / 1–2
> GB, autoscale 1→3) → RDS `db.t4g.micro` (single-AZ dev, Multi-AZ prod) →
> dashboard reads live from Google Sheets. No EKS, no cache tier.

---

## 0. Per account: region & names

```bash
export AWS_REGION=ap-south-1
export ENV=dev                 # or: prod
export APP=efip-$ENV
aws sts get-caller-identity     # confirm you're in the right account
```

## 1. RDS PostgreSQL (private)

```bash
# SG for RDS; ingress added in step 5 once the service's task SG exists.
aws ec2 create-security-group --group-name $APP-rds --description "EFIP RDS" \
  --vpc-id <default-vpc-id> --query GroupId --output text          # -> RDS_SG

aws rds create-db-instance \
  --db-instance-identifier $APP-db \
  --engine postgres --engine-version 16 \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 --storage-type gp3 \
  --master-username efip_admin --master-user-password '<STRONG_DB_PASSWORD>' \
  --db-name efip --vpc-security-group-ids <RDS_SG> \
  --no-publicly-accessible --backup-retention-period 7 \
  $( [ "$ENV" = prod ] && echo --multi-az )

aws rds describe-db-instances --db-instance-identifier $APP-db \
  --query 'DBInstances[0].Endpoint.Address' --output text          # -> DB_HOST
```

## 2. Secrets

```bash
JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
aws secretsmanager create-secret --name $APP/JWT_SECRET   --secret-string "$JWT"
aws secretsmanager create-secret --name $APP/DATABASE_URL \
  --secret-string "postgres://efip_admin:<STRONG_DB_PASSWORD>@<DB_HOST>:5432/efip"
```

## 3. Build & push the image to ECR

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$APP
aws ecr create-repository --repository-name $APP >/dev/null
aws ecr get-login-password | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com

# Build context = REPO ROOT (see platform/Dockerfile). Image listens on :8080, health /api/health.
docker build -f platform/Dockerfile -t $REPO:latest .
docker push $REPO:latest
```

## 4. IAM roles Express needs

Express Mode requires two roles (the console can auto-create both on first use;
CLI/CloudFormation for repeatability):

- **Task execution role** — pulls the ECR image, reads the Secrets Manager
  secrets, writes CloudWatch logs. Attach `AmazonECSTaskExecutionRolePolicy` plus
  `secretsmanager:GetSecretValue` on `$APP/*`.
- **Infrastructure role** — lets ECS create/manage the ALB, target groups, and
  networking on your behalf (this is the Express-specific one).

## 5. Create the Express Mode service

**Console (simplest for the first one):** ECS → **Create** → **Express Mode
service** → provide the three inputs:

1. **Container image** = `…/$APP:latest` (from step 3), **port `8080`**.
2. **Task execution role** and **Infrastructure role** (from step 4, or let the
   console create them).
3. **Networking:** your VPC + subnets, and a task **security group** — note its id
   (`TASK_SG`). Choose **Public** endpoint. Set **health check path** `/api/health`.

Add **environment / secrets** on the container:

- `NODE_ENV=production`, `PORT=8080`, `PGSSL_STRICT=false`
- `JWT_SECRET` → secret `$APP/JWT_SECRET`
- `DATABASE_URL` → secret `$APP/DATABASE_URL`

Set **auto scaling** min 1 / max 3. Express provisions the ALB + TLS and returns a
public **HTTPS URL** (`https://<name>.<region>.elb.amazonaws.com` / an
auto-generated domain).

> Also creatable via **CLI, SDK, CloudFormation, Terraform, or the AWS Labs ECS
> MCP server** — the console flow above maps 1:1 to those.

Finally, **let the Fargate task reach RDS**:

```bash
aws ec2 authorize-security-group-ingress --group-id <RDS_SG> \
  --protocol tcp --port 5432 --source-group <TASK_SG>
```

## 6. Seed users (admin + the 12 RC logins)

Run once against RDS — from CloudShell/a bastion in the same VPC, or temporarily
allow your IP into `<RDS_SG>`:

```bash
cd platform
export DATABASE_URL="postgres://efip_admin:<PW>@<DB_HOST>:5432/efip"
export ADMIN_USERNAME=admin ADMIN_PASSWORD='<STRONG_ADMIN_PW>'
export SEED_USERS_CSV=./seed/rc_users.csv     # gitignored file with the real RC passwords
npm ci
npm run seed          # admin
npm run seed:users    # the 12 RC_* logins (idempotent)
```

Alternatively run the seed as a one-off Fargate task using the same image with the
command overridden to
`node --experimental-strip-types packages/server/src/scripts/seed-users.ts`.

## 7. Dashboard & end-user experience (unchanged)

The service serves the gated dashboard at `/` after login, so users get the **same
login → dashboard flow** — the only change is they sign in with a **username**
(e.g. `RC_Kolkata`) instead of an email. Retire the temporary public S3 bucket
(back to *Block public access*) once the Express service is live.

## 8. Custom domain + HTTPS

Point `efip.<yourdomain>` (or a dev subdomain) at the service's ALB: request an
**ACM certificate**, attach it to the Express service's HTTPS listener, and add a
**Route 53 / DNS** record (CNAME to the ALB, or an alias if the zone is in Route
53). This is also where the `cckin.in` nameserver delegation must be live first.

## 9. CI/CD (GitHub Actions + OIDC)

The pipeline lives at `.github/workflows/ci-cd.yml`. On push to the environment's
branch it runs CI (build · typecheck · `npm audit`), then builds the image
(tagged with the git SHA), pushes to ECR, and calls
`aws ecs update-express-gateway-service`. It authenticates to AWS with **GitHub
OIDC** — no static keys in GitHub. One-time setup **per account**:

```bash
# Run as ADMIN/ROOT (the deployer user cannot manage OIDC providers).
ACCOUNT=<account-id>

# a) GitHub OIDC provider (once per account)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 1c58a3a8518e8759bf075b76b750d4f2df264fcd

# b) Deploy role trusting the repo (see the SUB gotcha below for the exact value)
aws iam create-role --role-name efip-<env>-gha-deploy \
  --assume-role-policy-document file:///tmp/trust.json \
  --tags Key=Project,Value=SAI-Expense-Tracker Key=Environment,Value=<env>

# c) Permissions: ECR push + ecs:* + PassRole on the two ECS roles
aws iam put-role-policy --role-name efip-<env>-gha-deploy \
  --policy-name efip-<env>-deploy --policy-document file:///tmp/perms.json
```

Then set the repo variable `AWS_DEPLOY_ROLE_ARN` (repo → Settings → Secrets and
variables → Actions → Variables) and create the GitHub `Environment` the deploy
job references.

> **⚠ OIDC `sub` gotcha (bit us on dev).** If the GitHub org has **immutable-ID
> subjects** enabled, the token `sub` is NOT
> `repo:ORG/REPO:...` but
> `repo:ORG@<org-id>/REPO@<repo-id>:environment:<env>` (with numeric IDs). A
> plain `repo:ORG/REPO:*` trust condition will fail with *"Not authorized to
> perform sts:AssumeRoleWithWebIdentity"*. **Print the real `sub` first**, then
> set the trust to match it. Debug step to drop into the deploy job temporarily:
>
> ```yaml
> - name: Show OIDC subject (debug)
>   run: |
>     TOKEN=$(curl -sH "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
>       "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" | jq -r .value)
>     echo "$TOKEN" | cut -d. -f2 | tr '_-' '/+' | { P=$(cat); L=$(( (4 - ${#P} % 4) % 4 )); printf '%s' "$P"; printf '=%.0s' $(seq 1 $L); } | base64 -d | jq '{sub,aud,repository_owner}'
> ```
>
> Take the printed `sub`, keep everything up to the last `:` and replace the tail
> with `*`, and use that in the trust `StringLike`. Example (dev):
> `repo:KheloIndiaAI@318880338/Expenditure-Tracker@1340286019:*`

Trust and permission policy templates (`/tmp/trust.json`, `/tmp/perms.json`) are
in `DEPLOYMENT_AS_BUILT.md` §5. Use **per-account** providers/roles so dev and prod
deploy only into their own accounts.

---

## Per-environment summary

| Item | dev account | prod account |
|---|---|---|
| ECS Express | Fargate 0.5 vCPU, min 1 / max 2 | Fargate 1 vCPU, min 1 / max 3 |
| RDS | `db.t4g.micro`, single-AZ | `db.t4g.micro`+, Multi-AZ |
| Secrets | `efip-dev/*` | `efip-prod/*` |
| Domain | `dev.<domain>` | `efip.<domain>` |
| Seed | admin + 12 RC users | admin + 12 RC users |

## Notes / guardrails

- **Same behaviour for users** — username + password → gated dashboard.
- **Local dev unchanged** — leave `DATABASE_URL` unset to use the SQLite file DB
  (`npm run dev`, `npm run seed`, `npm run seed:users`).
- **RDS stays private** (`--no-publicly-accessible`); reachable only from the task
  SG or a bastion — never open 5432 to the internet.
- **Cost note:** Express shares one ALB across services in the same networking
  config, so a second service (e.g. dev + a future service) doesn't pay for a
  second load balancer.

---

Sources: [Announcing Amazon ECS Express Mode](https://aws.amazon.com/fr/about-aws/whats-new/2025/11/announcing-amazon-ecs-express-mode/) · [Amazon ECS Express Mode (Developer Guide)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html) · [Automated deployments with GitHub Actions for ECS Express Mode](https://aws.amazon.com/blogs/containers/automated-deployments-with-github-actions-for-amazon-ecs-express-mode/)
