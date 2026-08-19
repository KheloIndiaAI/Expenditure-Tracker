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
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { User } from '@efip/shared';
import { findByEmail, countUsers } from './users.ts';
import { dummyVerify, signToken, toAuthedUser, verifyPassword, verifyToken } from './auth.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE_NAME = process.env.COOKIE_NAME || 'efip_session';
const IS_PROD = process.env.NODE_ENV === 'production';
const MAX_AGE = 60 * 60 * 12; // 12h, in seconds

const WEB_DIST = process.env.WEB_DIST || resolve(__dirname, '../../web/dist');
const WEB_ASSETS = join(WEB_DIST, 'assets');
const LOGIN_HTML = join(WEB_DIST, 'index.html');
/**
 * The dashboard is a single file at platform/public/index.html. It used to be
 * copied into packages/server/public before every deploy; three copies of a
 * 400 KB document kept byte-identical by hand is a drift waiting to happen, so
 * there is now one, read from where it lives.
 *
 * This server is the only way it is published. A static copy was served
 * unauthenticated from Vercel for a while — the same financial data with no
 * login in front of it — and that deployment has been retired. If a static
 * mirror is ever wanted again, it needs an answer for authentication first;
 * `/` here is deliberately gated and a static host cannot reproduce that.
 */
const DASHBOARD_HTML = process.env.DASHBOARD_HTML || resolve(__dirname, '../../../public/index.html');

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

/**
 * Read a file once at boot and keep it in memory. The login and dashboard HTML
 * are served on hot paths; reading them synchronously per request blocks the
 * event loop under load. They only change on redeploy, so cache them.
 */
function cachedHtml(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

async function start(): Promise<void> {
  const app = Fastify({ logger: true, trustProxy: true });
  await app.register(cookie);

  // Security headers (clickjacking, MIME sniffing, HSTS, referrer, etc.).
  // The CSP is scoped to exactly what the two served documents need:
  //   • login SPA  → same-origin JS/CSS from /assets
  //   • dashboard  → inline scripts/styles + Google Fonts + live Google Sheets read
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The dashboard is a self-contained HTML doc with inline <script>/<style>.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        // Live data read from the Google Sheet (gviz) — no financial data on our server.
        connectSrc: ["'self'", 'https://docs.google.com'],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"], // clickjacking protection for the gated dashboard
        formAction: ["'self'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    // HSTS only makes sense once TLS is terminated (nginx, step 6 of DEPLOY.md).
    hsts: IS_PROD ? { maxAge: 15552000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false, // avoid blocking Google Fonts/Sheets
  });

  // Global rate limit as a backstop; the login route tightens this further below.
  await app.register(rateLimit, {
    global: false, // opt-in per route — we only guard the auth endpoints
    max: 100,
    timeWindow: '1 minute',
  });

  // React login-SPA assets (JS/CSS). The dashboard HTML is fully self-contained,
  // so only the login build needs static hosting.
  if (existsSync(WEB_ASSETS)) {
    await app.register(fstatic, { root: WEB_ASSETS, prefix: '/assets/' });
  } else {
    app.log.warn(`Web assets not found at ${WEB_ASSETS} — run "npm run build -w @efip/web".`);
  }

  // HTML cached at boot (see cachedHtml). Fall back to a live read if absent at start.
  const loginHtml = cachedHtml(LOGIN_HTML);
  const dashboardHtml = cachedHtml(DASHBOARD_HTML);

  // ── Auth API ──────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/login',
    {
      // Brute-force / credential-stuffing protection: a handful of attempts per
      // IP per minute. Keyed by client IP (trustProxy honours X-Forwarded-For).
      config: {
        rateLimit: { max: 8, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
      if (!email || !password) {
        return reply.code(400).send({ message: 'Email and password are required.' });
      }
      const row = findByEmail(email);
      // Equalise timing between "unknown email" and "wrong password": run a real
      // scrypt in both branches so response time doesn't reveal valid accounts.
      const ok = row ? verifyPassword(password, row.password_hash) : (dummyVerify(password), false);
      if (!row || !ok) {
        req.log.warn({ event: 'auth.login.failure', email: String(email).toLowerCase(), ip: req.ip });
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
      req.log.info({ event: 'auth.login.success', userId: user.id, role: user.role, ip: req.ip });
      return { token: 'cookie', user: toAuthedUser(user) };
    },
  );

  app.get('/api/auth/me', async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ message: 'Not authenticated.' });
    return toAuthedUser(user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const user = currentUser(req);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    if (user) req.log.info({ event: 'auth.logout', userId: user.id, ip: req.ip });
    return { ok: true };
  });

  // Public liveness probe — no user count or other internal detail is exposed.
  app.get('/api/health', async () => ({ ok: true }));

  // ── Pages ─────────────────────────────────────────────────────────────────
  app.get('/login', async (_req, reply) => {
    if (!loginHtml) {
      return reply.code(500).type('text/plain').send('Login UI not built. Run: npm run build -w @efip/web');
    }
    return reply.type('text/html').send(loginHtml);
  });

  app.get('/', async (req, reply) => {
    if (!currentUser(req)) return reply.redirect('/login');
    if (!dashboardHtml) {
      return reply
        .code(500)
        .type('text/plain')
        .send(`Dashboard not found at ${DASHBOARD_HTML}. Check the file exists, or set DASHBOARD_HTML.`);
    }
    return reply.type('text/html').send(dashboardHtml);
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
