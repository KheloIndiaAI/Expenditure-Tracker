# EFIP — Dev Deployment (As-Built Record)

**Status:** LIVE · **Account:** `114171679953` (kheloindiaai) · **Region:** `ap-south-1` (Mumbai)
**URL:** https://ef-c7fd4baf50a14236b19a2eaf7f3c2d2c.ecs.ap-south-1.on.aws
**Repo:** `github.com/KheloIndiaAI/Expenditure-Tracker` (branch **`dev`**)
**Stack:** Amazon ECS Express Mode (Fargate + ALB + ACM TLS) → Amazon RDS PostgreSQL → gated dashboard, username login. **Deploys via GitHub Actions + OIDC on push to `dev`.**

Concrete record of the **dev** build. Generic template (for replicating **prod**):
[`DEPLOY_ECS_EXPRESS.md`](./DEPLOY_ECS_EXPRESS.md). Local dev runs on SQLite:
[`DEPLOY.md`](./DEPLOY.md).

---

## 1. Architecture

```
GitHub push (dev) ──▶ GitHub Actions ──(OIDC)──▶ build image → ECR → roll ECS Express
                                                                          │
Browser ── HTTPS ──▶ ECS Express ALB (ACM cert) ──────────────────────────┘
                        │
                        ▼
                 Fargate task (Node 22, Fastify)
                   • /login       → React login SPA  (packages/web, built by Vite)
                   • /            → platform/public/index.html  (only if session cookie present)
                   • /api/auth/*  → login / me / logout  (username + password)
                        │
          ┌─────────────┴───────────────┐
          ▼                             ▼
   RDS PostgreSQL                 Google Sheet (gviz)
   (app_user table only)         read live by the dashboard, client-side
```

- **The dashboard is a single static file, `platform/public/index.html`** — a
  self-contained HTML doc (inline CSS/JS) that reads its data **live from the
  Google Sheet in the browser**. It is **not** generated from monorepo code. It's
  baked into the Docker image at build time and served verbatim (cached in
  memory at boot), so a dashboard edit only goes live after a rebuild+redeploy.
- **No financial data is stored** anywhere on our servers. RDS holds only logins.
- **Login is by username** (e.g. `RC_Kolkata`), not email.
- Everything is tagged `Project=SAI-Expense-Tracker` → the **SAI-Expense-Tracker**
  resource group.

## 2. Resource inventory (dev)

| Thing | Identifier |
|---|---|
| AWS account | `114171679953` (kheloindiaai) |
| Region | `ap-south-1` |
| Resource group | `SAI-Expense-Tracker` (tag-based: `Project=SAI-Expense-Tracker`) |
| Deployer IAM user | `sai-efip-deployer` (for CLI ops; PowerUserAccess + `role/efip-*`) |
| GitHub OIDC provider | `arn:aws:iam::114171679953:oidc-provider/token.actions.githubusercontent.com` |
| CI/CD deploy role | `efip-dev-gha-deploy` (assumed by GitHub Actions via OIDC) |
| VPC | `vpc-03adfdfeded4e38c3` (default), CIDR `172.31.0.0/16` |
| RDS instance | `efip-dev-db` · Postgres 16 · `db.t4g.micro` · db `efip` · user `efip_admin` |
| RDS endpoint | `efip-dev-db.cjgaqaow43f6.ap-south-1.rds.amazonaws.com:5432` |
| RDS security group | `sg-036013a640ef0cce2` (ingress 5432 from `172.31.0.0/16`) |
| Secret — JWT | `efip-dev/JWT_SECRET` (`...secret:efip-dev/JWT_SECRET-hQVgVX`) |
| Secret — DB URL | `efip-dev/DATABASE_URL` (`...secret:efip-dev/DATABASE_URL-Wt6ser`) |
| ECR repo | `114171679953.dkr.ecr.ap-south-1.amazonaws.com/efip-dev` |
| Image tags | CI tags with the git SHA; manual deploys used `v1`…`v3` |
| Task execution role | `efip-dev-task-exec` |
| Infrastructure role | `efip-dev-infra` |
| ECS cluster / service | `default` / `arn:aws:ecs:ap-south-1:114171679953:service/default/efip-dev` |
| ALB | `ecs-express-gateway-alb-c74bc86d` |
| Public URL | `https://ef-c7fd4baf50a14236b19a2eaf7f3c2d2c.ecs.ap-south-1.on.aws` |
| GitHub repo variable | `AWS_DEPLOY_ROLE_ARN` = `arn:aws:iam::114171679953:role/efip-dev-gha-deploy` |
| GitHub environment | `dev` |

**Logins seeded:** `admin` (role `admin`) + 12 Regional-Centre users
(`RC_Lucknow, RC_Imphal, RC_Mumbai, RC_Bhopal, RC_Kolkata, RC_Trivandrum,
RC_Sonepat, RC_Gandhinagar, RC_Guwahati, RC_Zirakpur, RC_Patiala, RC_Bangalore`),
all role `analyst` (view-only). Passwords live only in the gitignored
`platform/seed/rc_users.csv` and as hashes in `app_user` — never in git or the image.

> **Secrets never in this doc / git / image:** the JWT secret, DB password, and the
> deployer's secret access key live only in Secrets Manager / your password manager.

## 3. CI/CD — the normal way to deploy

**Push to `dev` → it deploys itself.** `.github/workflows/ci-cd.yml`:

1. **CI** (every push/PR to `dev`): `npm ci` → build `@efip/shared` → `npm run
   typecheck` → `npm run build:deploy` → `npm audit --audit-level=high`.
2. **Deploy** (push to `dev`, after CI): assume `efip-dev-gha-deploy` via **OIDC**
   → ECR login → build image tagged `:${git-sha}` → push → roll the ECS Express
   service (`update-express-gateway-service --monitor-resources`).

So the day-to-day flow is just:

```bash
git checkout dev
# ...make changes (code, or the dashboard at platform/public/index.html)...
git commit -am "..." && git push origin dev
# watch the run under the repo's Actions tab
```

The blue/green canary bake means the deploy step legitimately takes ~5–10 min and
serves the old version until it flips (zero downtime).

## 4. Day-2 operations

### 4.1 Manual deploy (fallback if you're not going through CI)

```bash
export AWS_PROFILE=sai-efip AWS_REGION=ap-south-1
TAG=v4     # bump each time
IMG=114171679953.dkr.ecr.ap-south-1.amazonaws.com/efip-dev:$TAG
aws ecr get-login-password | docker login --username AWS --password-stdin 114171679953.dkr.ecr.ap-south-1.amazonaws.com
docker build --platform linux/amd64 --provenance=false -f platform/Dockerfile -t "$IMG" .
docker push "$IMG"
aws ecs update-express-gateway-service \
  --service-arn arn:aws:ecs:ap-south-1:114171679953:service/default/efip-dev \
  --primary-container '{"image":"'"$IMG"'","containerPort":8080,"environment":[{"name":"NODE_ENV","value":"production"},{"name":"PORT","value":"8080"},{"name":"PGSSL_STRICT","value":"false"}],"secrets":[{"name":"JWT_SECRET","valueFrom":"arn:aws:secretsmanager:ap-south-1:114171679953:secret:efip-dev/JWT_SECRET-hQVgVX"},{"name":"DATABASE_URL","valueFrom":"arn:aws:secretsmanager:ap-south-1:114171679953:secret:efip-dev/DATABASE_URL-Wt6ser"}]}' \
  --monitor-resources
```

Check rollout: `aws ecs describe-services --cluster default --services efip-dev
--query 'services[0].{running:runningCount,desired:desiredCount,rollout:deployments[].rolloutState}' --output json`

### 4.2 The dashboard changed

The dashboard is `platform/public/index.html`, baked into the image at build. Edit
it, commit, push to `dev` — CI rebuilds and redeploys. No code change needed
**unless** it references a **new external host**, in which case add that host to
the CSP in `packages/server/src/main.ts` first (§6).

### 4.3 Add or update login users

Edit `platform/seed/rc_users.csv` (gitignored). Seeding needs the Mac to reach the
private RDS, so open it briefly, seed via the Docker image, then close it:

```bash
export AWS_PROFILE=sai-efip
DB_HOST=$(aws rds describe-db-instances --db-instance-identifier efip-dev-db --query 'DBInstances[0].Endpoint.Address' --output text)
aws rds modify-db-instance --db-instance-identifier efip-dev-db --publicly-accessible --apply-immediately
aws rds wait db-instance-available --db-instance-identifier efip-dev-db
MYIP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id sg-036013a640ef0cce2 --protocol tcp --port 5432 --cidr ${MYIP}/32

docker run --rm --platform linux/amd64 \
  -e DATABASE_URL="postgres://efip_admin:<DB_PW>@$DB_HOST:5432/efip" \
  -e JWT_SECRET="seed-only-not-used" \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='<admin-pw>' \
  -e SEED_USERS_CSV=/seed/rc_users.csv \
  -v "$PWD/platform/seed:/seed:ro" \
  114171679953.dkr.ecr.ap-south-1.amazonaws.com/efip-dev:v3 \
  sh -lc "node --experimental-strip-types --no-warnings packages/server/src/scripts/seed.ts && node --experimental-strip-types --no-warnings packages/server/src/scripts/seed-users.ts"

# LOCK BACK DOWN:
aws rds modify-db-instance --db-instance-identifier efip-dev-db --no-publicly-accessible --apply-immediately
aws ec2 revoke-security-group-ingress --group-id sg-036013a640ef0cce2 --protocol tcp --port 5432 --cidr ${MYIP}/32
```

> `JWT_SECRET` is required by the app's production guard even though seeding doesn't
> use it — pass any non-default value. Seeding is idempotent (upsert on username).

### 4.4 Status, logs, health, rollback

```bash
curl -s https://ef-c7fd4baf50a14236b19a2eaf7f3c2d2c.ecs.ap-south-1.on.aws/api/health   # {"ok":true}
aws logs describe-log-groups --query "logGroups[?contains(logGroupName,'efip')].logGroupName" --output text
aws logs tail <that-log-group> --follow
```

**Rollback:** redeploy a previous image tag (git SHA or `vN`) via §4.1. ECS Express
also auto-rolls-back if its 5XX RollbackAlarm fires during the bake.

## 5. IAM policy templates

**CI/CD trust policy** (`efip-dev-gha-deploy`) — note the immutable-ID `sub` (§7):

```json
{"Version":"2012-10-17","Statement":[{
  "Effect":"Allow",
  "Principal":{"Federated":"arn:aws:iam::114171679953:oidc-provider/token.actions.githubusercontent.com"},
  "Action":"sts:AssumeRoleWithWebIdentity",
  "Condition":{
    "StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"},
    "StringLike":{"token.actions.githubusercontent.com:sub":"repo:KheloIndiaAI@318880338/Expenditure-Tracker@1340286019:*"}
  }
}]}
```

**CI/CD permission policy** (`efip-dev-deploy`): `ecr:GetAuthorizationToken` (`*`),
the ECR push actions on `repository/efip-dev`, `ecs:*` (`*`), and `iam:PassRole` on
`efip-dev-task-exec` + `efip-dev-infra`.

## 6. Security posture

- **App hardening:** `@fastify/helmet` (CSP, HSTS, nosniff, `frame-ancestors none`),
  `@fastify/rate-limit` on `/api/auth/login` (8/min/IP), scrypt hashing,
  httpOnly+Secure+SameSite=Lax cookie, login audit logs, timing-equalised login,
  no user-count leak on `/api/health`.
- **CSP trade-off:** the dashboard uses inline handlers + loads the Google Sheet by
  injecting a `<script>` from `docs.google.com`, so `script-src`/`script-src-attr`
  allow `'unsafe-inline'` + the Google hosts (`docs.google.com`,
  `*.googleusercontent.com`, `fonts.googleapis.com`, `fonts.gstatic.com`).
  Acceptable: gated to authenticated users, renders the org's own sheet.
- **RDS is private** (`--no-publicly-accessible`); opened to a single IP only during
  seeding, then reverted.
- **Secrets** in Secrets Manager, injected at runtime via the task execution role.
- **CI/CD uses OIDC** — no long-lived AWS keys stored in GitHub.

## 7. Gotchas we hit (and the fix)

| Symptom | Cause | Fix |
|---|---|---|
| EC2 launch "more vCPU than your limit of 8" | Account vCPU quota | Requested increase; pivoted off EC2 |
| App Runner "not accepting new customers" | Closed 30 Apr 2026 | Used **ECS Express Mode** |
| `DB_PW` empty | `node -e` unavailable in that shell | `python3 -c "import secrets;print(secrets.token_urlsafe(18))"`; check `${#DB_PW}` |
| `create-secret` stuck at `quote>` | Unclosed quote in JSON `--tags` | `Ctrl+C`; use shorthand `--tags Key=..,Value=..` |
| Push failed: repo `efip-devatest` | `$REPO:latest` mangled the tag | Build/push with a literal image ref |
| `create-express-gateway-service` Invalid CPU/Memory | `--cpu 1 --memory 2` rejected | **Omit** them → default 1 vCPU / 2 GB |
| Seed: "JWT_SECRET must be set in production" | Image sets `NODE_ENV=production` | Pass any non-default `-e JWT_SECRET=...` |
| Dashboard CSP blocks (`script-src`/`script-src-attr`) | gviz `<script>` inject + inline `onclick` | Add Google hosts to `script-src`; `scriptSrcAttr: ['unsafe-inline']` |
| `describe-*` "AccountIDs mismatch" | New terminal without `AWS_PROFILE` | `export AWS_PROFILE=sai-efip` per tab |
| Deploy "IN_PROGRESS" ~5+ min | Normal blue/green canary bake | Wait; old version serves meanwhile |
| Docker build "SAI_Financial_Intelligence.html not found" | Repo restructured to one dashboard file | Dockerfile copies `platform/public`; server reads `platform/public/index.html` |
| ECR push `403 Forbidden` | ECR login token expired (~12h) | `aws ecr get-login-password \| docker login ...` again |
| OIDC "could not be validated" | OIDC provider never created (deployer lacks IAM) | Create provider as **root**: `iam:CreateOpenIDConnectProvider` |
| OIDC "Not authorized to AssumeRoleWithWebIdentity" | Trust `sub` didn't match | Org has **immutable-ID subjects** → `sub` = `repo:ORG@id/REPO@id:...`; match the numeric IDs |

## 8. Local development (unchanged)

Leave `DATABASE_URL` unset → the server uses the SQLite file DB. `npm run dev`,
`npm run seed`, `npm run seed:users` all work locally. Docker + RDS are prod-only.
