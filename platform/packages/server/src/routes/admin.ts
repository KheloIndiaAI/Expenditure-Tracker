/**
 * Super Admin and self-service routes.
 *
 * ENFORCEMENT LIVES HERE, NOT IN THE UI. Every /api/admin/* route re-checks the
 * caller's role against the database on each request (see session.ts), so hiding
 * the Administration menu in the SPA is a convenience, never the control. A
 * normal user who types the URL, replays a request or keeps a stale cookie is
 * refused by these handlers.
 *
 * Two rules protect the platform from being administered into a corner:
 *   • a Super Admin cannot deactivate or demote themselves — the last one out
 *     would leave nobody able to let anyone back in;
 *   • module access is stored for everyone but ignored for Super Admins, so a
 *     stray toggle cannot hide Administration from the person who owns it.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MODULE_KEYS, ROLES, isAdminRole, type ModuleAccess } from '@efip/shared';
import { isSuperAdmin, toAuthedUser, verifyPassword } from '../auth.ts';
import { currentUser } from '../session.ts';
import {
  findById,
  findByUsername,
  getModuleAccess,
  listUsers,
  setModuleAccess,
  setPassword,
  updateUser,
  upsertUser,
} from '../users.ts';

/* Passwords are hashed with scrypt, so length is the only real lever we have
   here; a floor of 8 keeps this from being theatre without locking out the
   existing government logins, which are set centrally rather than by users. */
const PASSWORD = z.string().min(8, 'Password must be at least 8 characters.');
const OPTIONAL_TEXT = z.string().trim().max(160);
const EMAIL = z.union([z.string().trim().email('Enter a valid email address.'), z.literal('')]);
const PHONE = z.union([z.string().trim().regex(/^[0-9+\-\s()]{6,20}$/, 'Enter a valid phone number.'), z.literal('')]);

const NEW_USER = z.object({
  username: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore.'),
  name: z.string().trim().min(1).max(160),
  designation: OPTIONAL_TEXT.optional(),
  email: EMAIL.optional(),
  phone: PHONE.optional(),
  role: z.enum(ROLES),
  password: PASSWORD,
  is_active: z.boolean().optional(),
});

const EDIT_USER = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  designation: OPTIONAL_TEXT.optional(),
  email: EMAIL.optional(),
  phone: PHONE.optional(),
  role: z.enum(ROLES).optional(),
  is_active: z.boolean().optional(),
});

const ACCESS = z.object(
  Object.fromEntries(MODULE_KEYS.map((k) => [k, z.boolean()])) as Record<string, z.ZodBoolean>,
).partial();

const PROFILE = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  designation: OPTIONAL_TEXT.optional(),
  email: EMAIL.optional(),
  phone: PHONE.optional(),
});

const CHANGE_PASSWORD = z.object({
  current: z.string().min(1, 'Enter your current password.'),
  next: PASSWORD,
});

function firstError(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid request.';
}

export function registerAdminRoutes(app: FastifyInstance): void {
  /** Resolve the caller and refuse anyone who is not an administrator. */
  const requireSuperAdmin = async (req: never, reply: never) => {
    const user = await currentUser(req as never);
    if (!user) {
      (reply as never as { code: (n: number) => { send: (b: unknown) => unknown } })
        .code(401)
        .send({ message: 'Not authenticated.' });
      return null;
    }
    if (!isSuperAdmin(user)) {
      (req as never as { log: { warn: (o: unknown) => void } }).log.warn({
        event: 'admin.denied',
        userId: user.id,
        role: user.role,
      });
      (reply as never as { code: (n: number) => { send: (b: unknown) => unknown } })
        .code(403)
        .send({ message: 'Administration is restricted to Administrators.' });
      return null;
    }
    return user;
  };

  // ── Users ──────────────────────────────────────────────────────────────────
  app.get('/api/admin/users', async (req, reply) => {
    const admin = await requireSuperAdmin(req as never, reply as never);
    if (!admin) return;
    const users = await listUsers();
    const withAccess = await Promise.all(
      users.map(async (u) => ({ ...u, modules: await getModuleAccess(u.id, u.role) })),
    );
    return withAccess;
  });

  app.post('/api/admin/users', async (req, reply) => {
    const admin = await requireSuperAdmin(req as never, reply as never);
    if (!admin) return;
    const parsed = NEW_USER.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: firstError(parsed.error) });
    const input = parsed.data;
    if (await findByUsername(input.username)) {
      return reply.code(409).send({ message: `Username "${input.username}" is already taken.` });
    }
    const user = await upsertUser({ ...input, is_active: input.is_active !== false });
    req.log.info({ event: 'admin.user.create', by: admin.id, userId: user.id, role: user.role });
    return reply.code(201).send(user);
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (req, reply) => {
    const admin = await requireSuperAdmin(req as never, reply as never);
    if (!admin) return;
    const target = await findById(req.params.id);
    if (!target) return reply.code(404).send({ message: 'User not found.' });
    const parsed = EDIT_USER.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: firstError(parsed.error) });
    const patch = parsed.data;
    /* Self-lockout guard: an administrator who demotes or deactivates their own
       account would leave nobody able to reverse it. */
    if (target.id === admin.id) {
      if (patch.is_active === false) {
        return reply.code(400).send({ message: 'You cannot deactivate your own account.' });
      }
      /* Moving between the two administrator roles is not a demotion - they are
         one authority - so only a step outside them is refused. */
      if (patch.role && !isAdminRole(patch.role)) {
        return reply.code(400).send({ message: 'You cannot change your own role.' });
      }
    }
    const user = await updateUser(target.id, patch);
    req.log.info({ event: 'admin.user.update', by: admin.id, userId: target.id });
    return user;
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/password', async (req, reply) => {
    const admin = await requireSuperAdmin(req as never, reply as never);
    if (!admin) return;
    const target = await findById(req.params.id);
    if (!target) return reply.code(404).send({ message: 'User not found.' });
    const parsed = z.object({ password: PASSWORD }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: firstError(parsed.error) });
    await setPassword(target.id, parsed.data.password);
    req.log.info({ event: 'admin.user.password', by: admin.id, userId: target.id });
    return { ok: true };
  });

  // ── Module access ──────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/admin/users/:id/access', async (req, reply) => {
    const admin = await requireSuperAdmin(req as never, reply as never);
    if (!admin) return;
    const target = await findById(req.params.id);
    if (!target) return reply.code(404).send({ message: 'User not found.' });
    return getModuleAccess(target.id, target.role);
  });

  app.put<{ Params: { id: string } }>('/api/admin/users/:id/access', async (req, reply) => {
    const admin = await requireSuperAdmin(req as never, reply as never);
    if (!admin) return;
    const target = await findById(req.params.id);
    if (!target) return reply.code(404).send({ message: 'User not found.' });
    const parsed = ACCESS.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: firstError(parsed.error) });
    const saved = await setModuleAccess(target.id, parsed.data as Partial<ModuleAccess>);
    req.log.info({ event: 'admin.user.access', by: admin.id, userId: target.id });
    /* Super Admins are reported as fully allowed whatever was stored, matching
       what getModuleAccess will hand back on their next request. */
    return isSuperAdmin(target) ? getModuleAccess(target.id, target.role) : saved;
  });

  // ── Self-service ───────────────────────────────────────────────────────────
  app.patch('/api/me', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ message: 'Not authenticated.' });
    const parsed = PROFILE.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: firstError(parsed.error) });
    /* PROFILE has no role or is_active field, so a crafted body cannot smuggle a
       privilege change through the profile form. */
    const updated = await updateUser(user.id, parsed.data);
    if (!updated) return reply.code(404).send({ message: 'User not found.' });
    req.log.info({ event: 'profile.update', userId: user.id });
    return toAuthedUser(updated, await getModuleAccess(updated.id, updated.role));
  });

  app.post('/api/me/password', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ message: 'Not authenticated.' });
    const parsed = CHANGE_PASSWORD.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: firstError(parsed.error) });
    const row = await findByUsername(user.username);
    if (!row || !verifyPassword(parsed.data.current, row.password_hash)) {
      req.log.warn({ event: 'profile.password.failure', userId: user.id });
      return reply.code(400).send({ message: 'Your current password is incorrect.' });
    }
    if (parsed.data.current === parsed.data.next) {
      return reply.code(400).send({ message: 'The new password must differ from the current one.' });
    }
    await setPassword(user.id, parsed.data.next);
    req.log.info({ event: 'profile.password.change', userId: user.id });
    return { ok: true };
  });
}
