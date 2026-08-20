# EFIP — Dev Deployment (As-Built Record)

**Status:** LIVE · **Account:** `114171679953` (kheloindiaai) · **Region:** `ap-south-1` (Mumbai)
**URL:** https://ef-c7fd4baf50a14236b19a2eaf7f3c2d2c.ecs.ap-south-1.on.aws
**Stack:** Amazon ECS Express Mode (Fargate + ALB + ACM TLS) → Amazon RDS PostgreSQL → gated dashboard, username login.

This is the concrete record of what was actually built for the **dev** environment.
For the generic step-by-step template (used to replicate to **prod**), see
[`DEPLOY_ECS_EXPRESS.md`](./DEPLOY_ECS_EXPRESS.md). Local development still runs on
SQLite — see [`DEPLOY.md`](./DEPLOY.md).

---

## 1. Architecture

```
Browser ── HTTPS ──▶ ECS Express ALB (ACM cert)
                        │
                        ▼
                 Fargate task (Node 22, Fastify)
                   • /login       → React login SPA
                   • /            → dashboard.html (only if session cookie present)
                   • /api/auth/*  → login / me / logout (username + password)
                        │
          ┌─────────────┴───────────────┐
          ▼                             ▼
   RDS PostgreSQL                 Google Sheet (gviz)
   (app_user table only)         read live by the dashboard, client-side
```

- **No financial data on our servers.** The dashboard (`dashboard.html`) is a
  self-contained HTML file that reads its data live from the Google Sheet in the
  browser. RDS holds only the `app_user` login table.
- **Login is by username** (e.g. `RC_Kolkata`), not email.
- Everything is tagged `Project=SAI-Expense-Tracker` and rolls up under the
  **SAI-Expense-Tracker** resource group.

## 2. Resource inventory (dev)

| Thing | Identifier |
|---|---|
| AWS account | `114171679953` (kheloindiaai) |
| Region | `ap-south-1` |
| Resource group | `SAI-Expense-Tracker` (tag-based: `Project=SAI-Expense-Tracker`) |
| Deployer IAM user | `sai-efip-deployer` (access key `AKIARVFJJSTIQDNQYN7R`) |
| VPC | `vpc-03adfdfeded4e38c3` (default), CIDR `172.31.0.0/16` |
| RDS instance | `efip-dev-db` · Postgres 16 · `db.t4g.micro` · db `efip` · user `efip_admin` |
| RDS endpoint | `efip-dev-db.cjgaqaow43f6.ap-south-1.rds.amazonaws.com:5432` |
| RDS security group | `sg-036013a640ef0cce2` |
| Secret — JWT | `efip-dev/JWT_SECRET` (`...secret:efip-dev/JWT_SECRET-hQVgVX`) |
| Secret — DB URL | `efip-dev/DATABASE_URL` (`...secret:efip-dev/DATABASE_URL-Wt6ser`) |
| ECR repo | `114171679953.dkr.ecr.ap-south-1.amazonaws.com/efip-dev` |
| Current image tag | `v2` (bump to `v3`, `v4`, … per deploy) |
| Task execution role | `efip-dev-task-exec` |
| Infrastructure role | `efip-dev-infra` |
| ECS cluster / service | `default` / `arn:aws:ecs:ap-south-1:114171679953:service/default/efip-dev` |
| ALB | `ecs-express-gateway-alb-c74bc86d` |
| ALB security group | `sg-0bbfe5b8163b1f666` |
| Task (service) security group | `sg-00c60f99b1f7c4de8` |
| Public URL | `https://ef-c7fd4baf50a14236b19a2eaf7f3c2d2c.ecs.ap-south-1.on.aws` |

**Logins seeded:** `admin` (role `admin`) + 12 Regional-Centre users
(`RC_Lucknow, RC_Imphal, RC_Mumbai, RC_Bhopal, RC_Kolkata, RC_Trivandrum,
RC_Sonepat, RC_Gandhinagar, RC_Guwahati, RC_Zirakpur, RC_Patiala, RC_Bangalore`),
all role `analyst` (view-only). Passwords live only in the gitignored
`platform/seed/rc_users.csv` and in the hashed `app_user` rows — never in git or the image.

> **Secrets never in this doc / git / image:** the JWT secret, DB password, and the
> deployer's secret access key live only in AWS Secrets Manager and your password
> manager.

## 3. How it was built (the sequence that worked)

Run everything as the deployer profile in the right account:

```bash
export AWS_PROFILE=sai-efip AWS_REGION=ap-south-1
[ "$(aws sts get-caller-identity --query Account --output text)" = "114171679953" ] || echo "WRONG ACCOUNT"
```

1. **IAM deployer user** (`sai-efip-deployer`) — `PowerUserAccess` + an inline
   policy allowing `iam:CreateRole/AttachRolePolicy/PassRole/…` scoped to
   `role/efip-*` (so it can create/pass the two ECS roles).
2. **Resource group** `SAI-Expense-Tracker` — tag-based query on
   `Project=SAI-Expense-Tracker`.
3. **RDS** `efip-dev-db` — Postgres 16, `db.t4g.micro`, `--no-publicly-accessible`,
   SG `sg-036013a640ef0cce2`, tagged.
4. **Secrets** — `efip-dev/JWT_SECRET` and
   `efip-dev/DATABASE_URL` = `postgres://efip_admin:<pw>@<endpoint>:5432/efip`.
5. **ECR image** — `docker build --platform linux/amd64 --provenance=false
   -f platform/Dockerfile -t <repo>:v2 .` then push (build context = repo root).
6. **IAM roles** — `efip-dev-task-exec` (trust `ecs-tasks.amazonaws.com`,
   `AmazonECSTaskExecutionRolePolicy` + inline `secretsmanager:GetSecretValue` on
   `efip-dev/*`) and `efip-dev-infra` (trust `ecs.amazonaws.com`,
   `AmazonECSInfrastructureRoleforExpressGatewayServices`).
7. **RDS ingress** — allow 5432 from the VPC CIDR `172.31.0.0/16` so Fargate tasks
   can reach the DB.
8. **ECS Express service** — `aws ecs create-express-gateway-service` with the
   image, `containerPort 8080`, env (`NODE_ENV`, `PORT`, `PGSSL_STRICT=false`),
   the two secrets via `valueFrom`, `--health-check-path /api/health`,
   `--scaling-target '{"minTaskCount":1,"maxTaskCount":3}'`. (Do **not** pass
   `--cpu/--memory`; the default 1 vCPU / 2 GB is correct.)
9. **Seed users** — briefly opened RDS to the Mac IP and ran the seed via the
   Docker image (§4.3), then locked RDS back to private.

## 4. Day-2 operations

### 4.1 Deploy a new version (what we do on every change)

From the repo root, with `AWS_PROFILE=sai-efip`:

```bash
TAG=v3     # bump each deploy (or use the git short SHA)
IMG=114171679953.dkr.ecr.ap-south-1.amazonaws.com/efip-dev:$TAG

docker build --platform linux/amd64 --provenance=false -f platform/Dockerfile -t "$IMG" .
docker push "$IMG"

aws ecs update-express-gateway-service \
  --service-arn arn:aws:ecs:ap-south-1:114171679953:service/default/efip-dev \
  --primary-container '{"image":"'"$IMG"'","containerPort":8080,"environment":[{"name":"NODE_ENV","value":"production"},{"name":"PORT","value":"8080"},{"name":"PGSSL_STRICT","value":"false"}],"secrets":[{"name":"JWT_SECRET","valueFrom":"arn:aws:secretsmanager:ap-south-1:114171679953:secret:efip-dev/JWT_SECRET-hQVgVX"},{"name":"DATABASE_URL","valueFrom":"arn:aws:secretsmanager:ap-south-1:114171679953:secret:efip-dev/DATABASE_URL-Wt6ser"}]}' \
  --monitor-resources
```

It's a **blue/green canary** with a bake window, so a deploy takes ~5–10 min and
serves the old version with zero downtime until it flips. Watch it finish:

```bash
aws ecs describe-services --cluster default --services efip-dev \
  --query 'services[0].{running:runningCount,desired:desiredCount,rollout:deployments[].rolloutState}' --output json
# done when running==desired and rollout == ["COMPLETED"]
```

Then hard-refresh the browser (Cmd+Shift+R).

### 4.2 The dashboard changed (teammate pushed new HTML)

The served dashboard is bundled from `SAI_Financial_Intelligence.html` at build
time (`sync:dashboard`). So after a `git pull` that changes the dashboard, just
**rebuild + redeploy** (§4.1) — no code change needed **unless** the new dashboard
references a new external host, in which case add it to the CSP in
`packages/server/src/main.ts` first (see §5, CSP).

### 4.3 Add or update login users

Edit `platform/seed/rc_users.csv` (gitignored). Seeding needs the Mac to reach the
private RDS, so open it briefly, seed via the Docker image, then close it:

```bash
# a) open RDS to your IP
DB_HOST=$(aws rds describe-db-instances --db-instance-identifier efip-dev-db --query 'DBInstances[0].Endpoint.Address' --output text)
aws rds modify-db-instance --db-instance-identifier efip-dev-db --publicly-accessible --apply-immediately
aws rds wait db-instance-available --db-instance-identifier efip-dev-db
MYIP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id sg-036013a640ef0cce2 --protocol tcp --port 5432 --cidr ${MYIP}/32

# b) seed (JWT_SECRET is required by the app's prod guard but unused by seeding)
docker run --rm --platform linux/amd64 \
  -e DATABASE_URL="postgres://efip_admin:<DB_PW>@$DB_HOST:5432/efip" \
  -e JWT_SECRET="seed-only-not-used" \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='<admin-pw>' \
  -e SEED_USERS_CSV=/seed/rc_users.csv \
  -v "$PWD/platform/seed:/seed:ro" \
  114171679953.dkr.ecr.ap-south-1.amazonaws.com/efip-dev:v2 \
  sh -lc "node --experimental-strip-types --no-warnings packages/server/src/scripts/seed.ts && node --experimental-strip-types --no-warnings packages/server/src/scripts/seed-users.ts"

# c) LOCK RDS BACK DOWN
aws rds modify-db-instance --db-instance-identifier efip-dev-db --no-publicly-accessible --apply-immediately
aws ec2 revoke-security-group-ingress --group-id sg-036013a640ef0cce2 --protocol tcp --port 5432 --cidr ${MYIP}/32
```

Seeding is idempotent (upsert on username), so re-running updates
names/roles/passwords without duplicates. Both scripts also auto-create the
`app_user` table on first connect.

### 4.4 Status, logs, health

```bash
# service status
aws ecs describe-services --cluster default --services efip-dev --query 'services[0].status'
# health endpoint
curl -s https://ef-c7fd4baf50a14236b19a2eaf7f3c2d2c.ecs.ap-south-1.on.aws/api/health   # {"ok":true}
# app logs (find the Express-created log group, then tail)
aws logs describe-log-groups --query "logGroups[?contains(logGroupName,'efip')].logGroupName" --output text
aws logs tail <that-log-group> --follow
```

### 4.5 Rollback

Redeploy the previous image tag (e.g. point the service back at `:v1`/`:v2` via
§4.1). ECS Express also auto-rolls-back a bad deploy if its 5XX RollbackAlarm fires
during the bake window.

## 5. Gotchas we hit (and the fix)

| Symptom | Cause | Fix |
|---|---|---|
| EC2 launch "more vCPU than your limit of 8" | Standard on-demand vCPU quota | Requested a quota increase; pivoted off EC2 entirely |
| App Runner "not accepting new customers" | App Runner closed to new customers 30 Apr 2026 | Used **ECS Express Mode** (AWS's recommended replacement) |
| `DB_PW` came out empty | `node -e` not resolving in that shell | Generate with `python3 -c "import secrets;print(secrets.token_urlsafe(18))"`; verify `${#DB_PW}` |
| `create-secret` stuck at `quote>` | Unclosed quote in a pasted JSON `--tags` | `Ctrl+C`; use shorthand `--tags Key=..,Value=..` |
| Push failed: repo `efip-devatest` not found | `$REPO:latest` mangled the tag | Build/push with a **literal** image ref |
| `create-express-gateway-service`: Invalid CPU/Memory | `--cpu 1 --memory 2` rejected | **Omit** `--cpu/--memory` → default 1 vCPU / 2 GB |
| Seed: "JWT_SECRET must be set in production" | Image has `NODE_ENV=production`; app guards startup | Pass any non-default `-e JWT_SECRET=...` to the seed container |
| Dashboard console: `script-src`/`script-src-attr` CSP blocks | Dashboard loads Google Sheet via injected `<script>` and uses inline `onclick` handlers | CSP in `main.ts`: add `docs.google.com`+`*.googleusercontent.com` to `script-src`, set `scriptSrcAttr: ['unsafe-inline']` |
| `describe-*` "AccountIDs mismatch" | New terminal tab without `AWS_PROFILE` → wrong account | `export AWS_PROFILE=sai-efip` in every new tab |
| Deploy "IN_PROGRESS" for ~5+ min | Normal blue/green canary bake, not a hang | Wait; old version serves meanwhile |

## 6. Security posture

- Server hardening (from the earlier pass): `@fastify/helmet` (CSP, HSTS, nosniff,
  frame-ancestors none), `@fastify/rate-limit` on `/api/auth/login` (8/min/IP),
  scrypt password hashing, httpOnly+Secure+SameSite=Lax cookie, login audit logs,
  timing-equalised login, no user-count leak on `/api/health`.
- **RDS is private** (`--no-publicly-accessible`); reachable only from inside the
  VPC (the `172.31.0.0/16` rule). Public access is enabled only *temporarily* for
  seeding, scoped to one IP, and reverted (§4.3).
- **Secrets** are in Secrets Manager and injected at runtime via the task execution
  role — not baked into the image or env files.
- **CSP trade-off:** the dashboard's inline handlers + gviz JSONP require
  `'unsafe-inline'` and the Google hosts in `script-src`. Acceptable because the
  page is served only to authenticated users and renders the org's own sheet.

## 7. Replicating to prod (what differs)

Run the same sequence in the prod account (see `DEPLOY_ECS_EXPRESS.md`), changing:

- **Account** — new deployer user, resource group, roles, everything in the prod account.
- **Names** — `efip-prod-*`, secrets `efip-prod/*`, `ENV=prod`, `APP=efip-prod`.
- **RDS** — add `--multi-az` for prod resilience.
- **Scaling** — `maxTaskCount` a bit higher if desired (1→3 is fine for 100 users).
- **Domain** — attach a real domain + ACM cert to the prod service.
- Seed the **same 12 RC users** + a prod admin.

## 8. Local development (unchanged)

Leave `DATABASE_URL` unset → the server uses the SQLite file DB. `npm run dev`,
`npm run seed`, `npm run seed:users` all work locally exactly as before. The Docker
image and RDS are production-only.
