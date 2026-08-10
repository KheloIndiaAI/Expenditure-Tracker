/**
 * EFIP application server.
 *
 * One process serves everything, which suits a single EC2 instance:
 *   • POST /api/auth/login   — validate credentials, set an httpOnly JWT cookie
 *   • GET  /api/auth/me      — current user (from the cookie)
 *   • POST /api/auth/logout  — clear the cookie
 *   • GET  /login            — the React login SPA (packages/web/dist)
 *   • GET  /                 — the dashboard, but only when authenticated;
 *                              otherwise redirect to /login
 *
 * The dashboard is the self-contained HTML that syncs live from the Google
 * Sheet, so the server never touches the financial data — it only guards access
 * to it and manages login identities.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fstatic from '@fastify/static';
import type { User } from '@efip/shared';
import { findByEmail, countUsers } from './users.ts';
import { signToken, toAuthedUser, verifyPassword, verifyToken } from './auth.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE_NAME = process.env.COOKIE_NAME || 'efip_session';
const IS_PROD = process.env.NODE_ENV === 'production';
const MAX_AGE = 60 * 60 * 12; // 12h, in seconds

const WEB_DIST = process.env.WEB_DIST || resolve(__dirname, '../../web/dist');
const WEB_ASSETS = join(WEB_DIST, 'assets');
const LOGIN_HTML = join(WEB_DIST, 'index.html');
const DASHBOARD_HTML = process.env.DASHBOARD_HTML || resolve(__dirname, '../public/dashboard.html');

function stripHash(u: User & { password_hash?: string }): User {
  const { password_hash, ...rest } = u;
  return rest;
}

/** Resolve the signed-in user from the request cookie, or null. */
function currentUser(req: { cookies?: Record<string, string | undefined> }): User | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  const claims = verifyToken(token);
  if (!claims) return null;
  const row = findByEmail(claims.email);
  return row ? stripHash(row) : null;
}

async function start(): Promise<void> {
  const app = Fastify({ logger: true });
  await app.register(cookie);

  // React login-SPA assets (JS/CSS). The dashboard HTML is fully self-contained,
  // so only the login build needs static hosting.
  if (existsSync(WEB_ASSETS)) {
    await app.register(fstatic, { root: WEB_ASSETS, prefix: '/assets/' });
  } else {
    app.log.warn(`Web assets not found at ${WEB_ASSETS} — run "npm run build -w @efip/web".`);
  }

  // ── Auth API ──────────────────────────────────────────────────────────────
  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) {
      return reply.code(400).send({ message: 'Email and password are required.' });
    }
    const row = findByEmail(email);
    if (!row || !verifyPassword(password, row.password_hash)) {
      return reply.code(401).send({ message: 'Invalid email or password.' });
    }
    const user = stripHash(row);
    reply.setCookie(COOKIE_NAME, signToken(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      path: '/',
      maxAge: MAX_AGE,
    });
    return { token: 'cookie', user: toAuthedUser(user) };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ message: 'Not authenticated.' });
    return toAuthedUser(user);
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true, users: countUsers() }));

  // ── Pages ─────────────────────────────────────────────────────────────────
  app.get('/login', async (_req, reply) => {
    if (!existsSync(LOGIN_HTML)) {
      return reply.code(500).type('text/plain').send('Login UI not built. Run: npm run build -w @efip/web');
    }
    return reply.type('text/html').send(readFileSync(LOGIN_HTML, 'utf8'));
  });

  app.get('/', async (req, reply) => {
    if (!currentUser(req)) return reply.redirect('/login');
    if (!existsSync(DASHBOARD_HTML)) {
      return reply
        .code(500)
        .type('text/plain')
        .send('Dashboard not found. Run: npm run sync:dashboard (from platform/).');
    }
    return reply.type('text/html').send(readFileSync(DASHBOARD_HTML, 'utf8'));
  });

  // Anything else the browser asks for while logged out goes to login.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.redirect('/login');
    return reply.code(404).send({ message: 'Not found.' });
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`EFIP server listening on http://${HOST}:${PORT} (users in DB: ${countUsers()})`);
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
