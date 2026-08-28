/**
 * User store — identity, profile and per-module access.
 *
 * Users sign in with a short username (e.g. `RC_Kolkata`), not an email; the
 * email column is a contact detail only and is never a login identifier. The
 * financial data is read live from the Google Sheet by the dashboard, so nothing
 * financial is persisted here.
 */

import { randomUUID } from 'node:crypto';
import {
  MODULE_KEYS,
  isAdminRole,
  isRestrictedModule,
  type ModuleAccess,
  type ModuleKey,
  type Role,
  type User,
} from '@efip/shared';
import { getDb } from './db/index.ts';
import { hashPassword } from './auth.ts';

export type UserWithHash = User & { password_hash: string };

/** Every column of a user except the hash — the shape the API returns. */
const COLS = 'id, username, name, role, designation, email, phone, is_active, regional_centre';

/** SQLite and Postgres both hand back 0/1 here; the API contract is boolean. */
type Row = Omit<User, 'is_active'> & { is_active: number | boolean; password_hash?: string };

function toUser<T extends Row>(row: T): T extends { password_hash: string } ? UserWithHash : User {
  return { ...row, is_active: row.is_active === true || row.is_active === 1 } as never;
}

export async function findByUsername(username: string): Promise<UserWithHash | undefined> {
  const db = await getDb();
  const row = await db.one<Row & { password_hash: string }>(
    `SELECT ${COLS}, password_hash FROM app_user WHERE username = ?`,
    [normalise(username)],
  );
  return row ? (toUser(row) as UserWithHash) : undefined;
}

export async function findById(id: string): Promise<User | undefined> {
  const db = await getDb();
  const row = await db.one<Row>(`SELECT ${COLS} FROM app_user WHERE id = ?`, [id]);
  return row ? (toUser(row) as User) : undefined;
}

export async function listUsers(): Promise<User[]> {
  const db = await getDb();
  const rows = await db.all<Row>(`SELECT ${COLS} FROM app_user ORDER BY name`);
  return rows.map((r) => toUser(r) as User);
}

export async function countUsers(): Promise<number> {
  const db = await getDb();
  const row = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM app_user');
  return Number(row?.n ?? 0);
}

export interface NewUser {
  username: string;
  password: string;
  name: string;
  role: Role;
  designation?: string;
  email?: string;
  phone?: string;
  is_active?: boolean;
  regional_centre?: string;
}

/** Idempotent upsert on username — used by both seed scripts, safe to re-run. */
export async function upsertUser(input: NewUser): Promise<User> {
  const db = await getDb();
  const username = normalise(input.username);
  const existing = await findByUsername(username);
  const fields = {
    name: input.name,
    role: input.role,
    designation: input.designation ?? '',
    email: input.email ?? '',
    phone: input.phone ?? '',
    is_active: input.is_active === false ? 0 : 1,
    regional_centre: input.regional_centre ?? '',
  };
  if (existing) {
    /* Two fields are written only when the caller actually states one, because
       a re-seed must not undo a decision an administrator made in the platform.
       The CSV roster is a list of logins, not a record of every setting: it
       carries no is_active and no centre, so writing the defaults for those
       would silently revive a login that was deactivated on purpose, and strip
       the centre from every RC account on the next routine re-seed. Absent
       means "not stated", never "set it back to the default". */
    const sets = ['name = ?', 'role = ?', 'designation = ?', 'email = ?', 'phone = ?', 'password_hash = ?'];
    const args: unknown[] = [
      fields.name,
      fields.role,
      fields.designation,
      fields.email,
      fields.phone,
      hashPassword(input.password),
    ];
    if (input.is_active !== undefined) {
      sets.push('is_active = ?');
      args.push(fields.is_active);
    }
    if (input.regional_centre !== undefined) {
      sets.push('regional_centre = ?');
      args.push(fields.regional_centre);
    }
    args.push(username);
    await db.run(`UPDATE app_user SET ${sets.join(', ')} WHERE username = ?`, args);
    return (await findByUsername(username)) as User;
  }
  const id = randomUUID();
  await db.run(
    `INSERT INTO app_user (id, username, name, role, designation, email, phone, is_active, regional_centre, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      username,
      fields.name,
      fields.role,
      fields.designation,
      fields.email,
      fields.phone,
      fields.is_active,
      fields.regional_centre,
      hashPassword(input.password),
      new Date().toISOString(),
    ],
  );
  return (await findById(id)) as User;
}

/** Fields a Super Admin may change on someone else. Password is separate. */
export interface AdminPatch {
  name?: string;
  designation?: string;
  email?: string;
  phone?: string;
  role?: Role;
  is_active?: boolean;
  /** Which centre's vouchers they may comment on. Super Admin only. */
  regional_centre?: string;
}

/** Fields a user may change on themselves — role, centre and access are not among them. */
export type ProfilePatch = Pick<AdminPatch, 'name' | 'designation' | 'email' | 'phone'>;

export async function updateUser(id: string, patch: AdminPatch): Promise<User | undefined> {
  const db = await getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  const put = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.name !== undefined) put('name', patch.name);
  if (patch.designation !== undefined) put('designation', patch.designation);
  if (patch.email !== undefined) put('email', patch.email);
  if (patch.phone !== undefined) put('phone', patch.phone);
  if (patch.role !== undefined) put('role', patch.role);
  if (patch.is_active !== undefined) put('is_active', patch.is_active ? 1 : 0);
  if (patch.regional_centre !== undefined) put('regional_centre', patch.regional_centre);
  if (!sets.length) return findById(id);
  args.push(id);
  await db.run(`UPDATE app_user SET ${sets.join(', ')} WHERE id = ?`, args);
  return findById(id);
}

export async function setPassword(id: string, password: string): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE app_user SET password_hash = ? WHERE id = ?', [hashPassword(password), id]);
}

// ── Module access ────────────────────────────────────────────────────────────

/**
 * Resolve what a user may open.
 *
 * A user with no rows gets every module except the restricted ones. That is what
 * keeps every login that predates this table working unchanged — for an ordinary
 * module the absence of a decision is not a denial. A module in
 * RESTRICTED_MODULES inverts exactly that: it is withheld until a row says
 * otherwise, so shipping one does not hand it to the whole platform.
 *
 * An administrator always gets everything regardless of stored rows, so the
 * platform cannot be locked away from its own administrators by a stray toggle.
 */
function baselineAccess(): ModuleAccess {
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, !isRestrictedModule(k)])) as ModuleAccess;
}

export async function getModuleAccess(id: string, role?: Role): Promise<ModuleAccess> {
  if (isAdminRole(role)) {
    return Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as ModuleAccess;
  }
  const all = baselineAccess();
  const db = await getDb();
  const rows = await db.all<{ module: string; allowed: number | boolean }>(
    'SELECT module, allowed FROM user_module_access WHERE user_id = ?',
    [id],
  );
  /* No early return for the empty case: the baseline is already the answer, and
     a short-circuit here would have to repeat it. */
  for (const r of rows) {
    if ((MODULE_KEYS as readonly string[]).includes(r.module)) {
      all[r.module as ModuleKey] = r.allowed === true || r.allowed === 1;
    }
  }
  return all;
}

/**
 * Replaces the whole set in one go, so the stored rows always mirror the UI.
 *
 * The two kinds of module read a MISSING key oppositely, and that asymmetry is
 * the point. For an ordinary module, absent means "not mentioned", which is not
 * a denial — a caller sending a partial set must not switch off what it failed
 * to mention. For a restricted one, absent means not granted: reading silence as
 * a grant would let any partial request hand out the very panel that is meant to
 * stay shut until someone deliberately opens it.
 */
export async function setModuleAccess(id: string, access: Partial<ModuleAccess>): Promise<ModuleAccess> {
  const db = await getDb();
  await db.run('DELETE FROM user_module_access WHERE user_id = ?', [id]);
  for (const key of MODULE_KEYS) {
    const allowed = isRestrictedModule(key) ? access[key] === true : access[key] !== false;
    await db.run('INSERT INTO user_module_access (user_id, module, allowed) VALUES (?, ?, ?)', [
      id,
      key,
      allowed ? 1 : 0,
    ]);
  }
  return getModuleAccess(id);
}

/** Usernames are case-insensitive and trimmed for lookup stability. */
function normalise(username: string): string {
  return String(username).trim().toLowerCase();
}
