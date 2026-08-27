/**
 * User store — identity, profile and per-module access.
 *
 * Users sign in with a short username (e.g. `RC_Kolkata`), not an email; the
 * email column is a contact detail only and is never a login identifier. The
 * financial data is read live from the Google Sheet by the dashboard, so nothing
 * financial is persisted here.
 */

import { randomUUID } from 'node:crypto';
import { MODULE_KEYS, isAdminRole, type ModuleAccess, type ModuleKey, type Role, type User } from '@efip/shared';
import { getDb } from './db/index.ts';
import { hashPassword } from './auth.ts';

export type UserWithHash = User & { password_hash: string };

/** Every column of a user except the hash — the shape the API returns. */
const COLS = 'id, username, name, role, designation, email, phone, is_active';

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
  };
  if (existing) {
    /* Re-seeding must not silently revive a login a Super Admin deactivated, so
       is_active is only written when the caller states one. */
    const keepActive = input.is_active === undefined;
    await db.run(
      `UPDATE app_user SET name = ?, role = ?, designation = ?, email = ?, phone = ?, password_hash = ?
       ${keepActive ? '' : ', is_active = ?'} WHERE username = ?`,
      keepActive
        ? [fields.name, fields.role, fields.designation, fields.email, fields.phone, hashPassword(input.password), username]
        : [fields.name, fields.role, fields.designation, fields.email, fields.phone, hashPassword(input.password), fields.is_active, username],
    );
    return (await findByUsername(username)) as User;
  }
  const id = randomUUID();
  await db.run(
    `INSERT INTO app_user (id, username, name, role, designation, email, phone, is_active, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      username,
      fields.name,
      fields.role,
      fields.designation,
      fields.email,
      fields.phone,
      fields.is_active,
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
}

/** Fields a user may change on themselves — role and access are not among them. */
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
 * A user with no rows gets everything. That is what keeps every login that
 * predates this table working unchanged — the absence of a decision is not a
 * denial. An administrator always gets everything regardless of stored rows, so
 * the platform cannot be locked away from its own administrators by a stray
 * toggle.
 */
export async function getModuleAccess(id: string, role?: Role): Promise<ModuleAccess> {
  const all = Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as ModuleAccess;
  if (isAdminRole(role)) return all;
  const db = await getDb();
  const rows = await db.all<{ module: string; allowed: number | boolean }>(
    'SELECT module, allowed FROM user_module_access WHERE user_id = ?',
    [id],
  );
  if (!rows.length) return all;
  for (const r of rows) {
    if ((MODULE_KEYS as readonly string[]).includes(r.module)) {
      all[r.module as ModuleKey] = r.allowed === true || r.allowed === 1;
    }
  }
  return all;
}

/** Replaces the whole set in one go, so the stored rows always mirror the UI. */
export async function setModuleAccess(id: string, access: Partial<ModuleAccess>): Promise<ModuleAccess> {
  const db = await getDb();
  await db.run('DELETE FROM user_module_access WHERE user_id = ?', [id]);
  for (const key of MODULE_KEYS) {
    const allowed = access[key] !== false;
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
