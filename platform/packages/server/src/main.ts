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
import { findByUsername, countUsers, getModuleAccess } from './users.ts';
import { dummyVerify, signToken, toAuthedUser, verifyPassword } from './auth.ts';
import { COOKIE_NAME, currentUser, stripHash } from './session.ts';
import { registerAdminRoutes } from './routes/admin.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
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
  // The CSP is scoped to what the two served documents actually need:
  //   • login SPA  → same-origin JS/CSS from /assets
  //   • dashboard  → a self-contained HTML doc that uses inline <script>/<style>,
  //     inline event handlers (onclick/onchange), and loads live Google Sheets
  //     data by INJECTING a <script> from docs.google.com (gviz JSONP), plus
  //     Google Fonts. Those patterns force 'unsafe-inline' + the Google hosts in
  //     script-src and script-src-attr. The dashboard is only served to
  //     authenticated users and renders the org's own sheet, so this is an
  //     acceptable trade-off vs. rewriting the dashboard to drop inline handlers.
  const GOOGLE = ['https://docs.google.com', 'https://*.googleusercontent.com'];
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", ...GOOGLE],
        scriptSrcAttr: ["'unsafe-inline'"], // inline onclick/onchange in the dashboard
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'", ...GOOGLE],
        imgSrc: ["'self'", 'data:', 'https:'],
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
      const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
      if (!username || !password) {
        return reply.code(400).send({ message: 'Username and password are required.' });
      }
      const row = await findByUsername(username);
      // Equalise timing between "unknown user" and "wrong password": run a real
      // scrypt in both branches so response time doesn't reveal valid accounts.
      const ok = row ? verifyPassword(password, row.password_hash) : (dummyVerify(password), false);
      if (!row || !ok) {
        req.log.warn({ event: 'auth.login.failure', username: String(username).toLowerCase(), ip: req.ip });
        return reply.code(401).send({ message: 'Invalid username or password.' });
      }
      const user = stripHash(row);
      /* Deactivation is a login-time refusal, not merely a hidden menu. The same
         check runs on every request in session.ts, so an already-signed-in user
         loses access immediately rather than at token expiry. */
      if (!user.is_active) {
        req.log.warn({ event: 'auth.login.deactivated', userId: user.id, ip: req.ip });
        return reply.code(403).send({ message: 'This account has been deactivated. Contact the administrator.' });
      }
      reply.setCookie(COOKIE_NAME, signToken(user), {
        httpOnly: true,
        sameSite: 'lax',
        secure: IS_PROD,
        path: '/',
        maxAge: MAX_AGE,
      });
      req.log.info({ event: 'auth.login.success', userId: user.id, role: user.role, ip: req.ip });
      return { token: 'cookie', user: toAuthedUser(user, await getModuleAccess(user.id, user.role)) };
    },
  );

  app.get('/api/auth/me', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ message: 'Not authenticated.' });
    return toAuthedUser(user, await getModuleAccess(user.id, user.role));
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const user = await currentUser(req);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    if (user) req.log.info({ event: 'auth.logout', userId: user.id, ip: req.ip });
    return { ok: true };
  });

  // Super Admin (/api/admin/*) and self-service (/api/me*) routes. Every one of
  // them re-checks the caller against the database — see routes/admin.ts.
  registerAdminRoutes(app);

  // Public liveness probe — no user count or other internal detail is exposed.
  app.get('/api/health', async () => ({ ok: true }));

  // ── Pages ─────────────────────────────────────────────────────────────────
  app.get('/login', async (_req, reply) => {
    if (!loginHtml) {
      return reply.code(500).type('text/plain').send('Login UI not built. Run: npm run build -w @efip/web');
    }
    return reply.type('text/html').send(loginHtml);
  });

  /* The login bundle is also the Administration and Profile SPA, so these paths
     serve the same document and let the client router take over. They are still
     gated: an unauthenticated visitor is sent to /login, and every action the SPA
     can take is authorised server-side regardless of what it chooses to render. */
  /* My Profile is a panel of the dashboard now, not a screen of this SPA. The
     path is kept and redirected so existing links and bookmarks still work. */
  app.get('/profile', async (_req, reply) => reply.redirect('/?panel=profile'));

  for (const path of ['/admin', '/admin/*']) {
    app.get(path, async (req, reply) => {
      if (!(await currentUser(req))) return reply.redirect('/login');
      if (!loginHtml) {
        return reply.code(500).type('text/plain').send('UI not built. Run: npm run build -w @efip/web');
      }
      return reply.type('text/html').send(loginHtml);
    });
  }

  app.get('/', async (req, reply) => {
    if (!(await currentUser(req))) return reply.redirect('/login');
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
  app.log.info(`EFIP server listening on http://${HOST}:${PORT} (users in DB: ${await countUsers()})`);
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
