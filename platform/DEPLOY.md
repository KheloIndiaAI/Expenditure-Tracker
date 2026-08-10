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
