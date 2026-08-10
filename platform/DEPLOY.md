# EFIP — Deployment (AWS EC2)

The platform is a single Node process (Fastify) that:

- serves the **React login SPA** at `/login`,
- validates credentials against a **SQLite users table** (the *only* thing stored in the DB),
- issues an **httpOnly JWT cookie**, and
- serves the **dashboard** (the self-contained, Google‑Sheets‑synced HTML) at `/` — but only to authenticated users.

No financial data lives in the database; the dashboard reads it live from the Google Sheet, exactly as before.

---

## 1. Prerequisites

- **Node.js 22.x LTS** (required — the server uses `node:sqlite` and TypeScript type‑stripping, which are stable/available in Node 22 with the flags already wired into the npm scripts). Do **not** use Node 24 without adjusting the flags.
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  node -v   # v22.x
  ```
- An EC2 instance (Ubuntu 22.04+), security group allowing 80/443 (and 22 for SSH).

## 2. Get the code & install

```bash
sudo mkdir -p /opt/efip && sudo chown "$USER" /opt/efip
git clone <your-repo-url> /opt/efip
cd /opt/efip/platform
npm install
```

## 3. Configure

```bash
cp .env.example .env
# edit .env — set a strong JWT_SECRET, the ADMIN_* login, and EFIP_DB path
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # for JWT_SECRET
sudo mkdir -p /var/lib/efip && sudo chown "$USER" /var/lib/efip            # matches EFIP_DB
```

## 4. Build & seed

```bash
npm run build:deploy          # builds @efip/shared + @efip/web, copies the dashboard into the server
npm run seed                  # creates the admin login from ADMIN_* in .env
```

## 5. Run

```bash
npm start                     # starts Fastify on PORT (default 4000)
# visit http://<ec2-ip>:4000  -> redirects to /login
```

### Keep it running (systemd)

Create `/etc/systemd/system/efip.service`:

```ini
[Unit]
Description=EFIP server
After=network.target

[Service]
WorkingDirectory=/opt/efip/platform
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production
User=ubuntu

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now efip
sudo journalctl -u efip -f
```

## 6. HTTPS + port 80/443 (nginx reverse proxy)

```nginx
server {
  listen 80;
  server_name your.domain;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain     # provisions TLS; NODE_ENV=production makes the cookie Secure
```

---

## Updating the dashboard

The served dashboard is `packages/server/public/dashboard.html`. When the source
`SAI_Financial_Intelligence.html` (repo root) changes, refresh the copy:

```bash
cd /opt/efip/platform && npm run sync:dashboard && sudo systemctl restart efip
```

## Managing logins

- Change the admin password: edit `ADMIN_PASSWORD` in `.env`, then `npm run seed` (idempotent).
- Add more users: extend `.env`/seed or add a small admin route later. Passwords are hashed with scrypt; only hashes are stored.

## Notes

- **Auth‑only DB.** `packages/server/src/db/auth-schema.sql` defines a single `app_user` table. The richer star schema (`schema.sql`) is retained for a future full‑data build but is not loaded.
- **Cookie security.** In `NODE_ENV=production` the session cookie is `Secure` + `httpOnly` + `SameSite=Lax`. Terminate TLS (step 6) so the cookie is sent.
- **Dev mode.** `npm run dev` runs the login SPA on Vite (:5173, proxying `/api` to :4000) for UI iteration. The integrated login→dashboard flow is best exercised against the built server (`npm run build:deploy && npm start`).

## Security hardening

The server ships with the following controls (see `packages/server/src/main.ts`):

- **Security headers (`@fastify/helmet`).** Every response carries a Content‑Security‑Policy, `X‑Frame‑Options`, `X‑Content‑Type‑Options: nosniff`, `Referrer‑Policy: no‑referrer` and (in production) HSTS. The CSP is deliberately scoped to what the two served documents need — the login SPA's same‑origin assets, and the dashboard's inline scripts/styles, Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`) and its live Google Sheets read (`docs.google.com`). **If the dashboard later loads a resource from a new host, add that host to the matching CSP directive in `main.ts` or the browser will block it.** `frame-ancestors 'none'` protects the gated dashboard from clickjacking.
- **Login rate limiting (`@fastify/rate-limit`).** `POST /api/auth/login` is capped at 8 attempts/minute per client IP (returns `429` beyond that) as brute‑force / credential‑stuffing protection. Other routes are not globally limited.
- **`trustProxy` is enabled.** Behind the nginx reverse proxy (step 6), the rate limiter and audit log key on the real client IP from `X‑Forwarded‑For`. Make sure nginx sets that header (the sample config in step 6 does). Do **not** expose the Node port (4000) directly to the internet, or clients could spoof `X‑Forwarded‑For`.
- **Audit logging.** Login success, login failure and logout are logged (actor id/role where known, plus client IP) via the Fastify logger — visible in `journalctl -u efip`. Ship these logs somewhere durable if you need a long‑term audit trail.
- **Account enumeration & health.** Login timing is equalised between unknown‑email and wrong‑password paths, and `GET /api/health` returns only `{ ok: true }` (no user count or internal detail).
- **HTML cached at boot.** The login and dashboard HTML are read into memory at startup, so a redeploy or `sync:dashboard` requires a service restart (`sudo systemctl restart efip`) — already the documented step for refreshing the dashboard.

### Dependency vulnerabilities

- `npm audit` is clean of **high**‑severity issues in the served stack. Re‑run it after any dependency change: `cd platform && npm audit`.
- Two **moderate** advisories remain in `react-router` (pulled in only by the *parked* dashboard‑SPA scaffolding — `AppShell`, `CommandPalette`, `useFilters` — which is **not** part of the login build or the deployed bundle). Resolving them requires a breaking upgrade to React Router v7 and should be done as part of building the full dashboard SPA, not before.
- `xlsx`/SheetJS was removed from dependencies (unpatched prototype‑pollution/ReDoS advisories, and not imported anywhere). When the ingestion pipeline is built, add a patched SheetJS build from the vendor's official distribution rather than the npm registry copy.
