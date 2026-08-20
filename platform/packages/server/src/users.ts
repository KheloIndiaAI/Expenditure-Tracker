/**
 * User store — the only table this database holds.
 *
 * Identity for the custom login. Users sign in with a short username (e.g.
 * `RC_Kolkata`), not an email. The financial data is read live from the Google
 * Sheet by the dashboard, so nothing financial is persisted here.
 */

import { randomUUID } from 'node:crypto';
import type { Role, User } from '@efip/shared';
import { getDb } from './db/index.ts';
import { hashPassword } from './auth.ts';

export type UserWithHash = User & { password_hash: string };

export async function findByUsername(username: string): Promise<UserWithHash | undefined> {
  const db = await getDb();
  return db.one<UserWithHash>(
    'SELECT id, username, name, role, designation, password_hash FROM app_user WHERE username = ?',
    [normalise(username)],
  );
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
}

/** Idempotent upsert on username — used by both seed scripts, safe to re-run. */
export async function upsertUser(input: NewUser): Promise<User> {
  const db = await getDb();
  const username = normalise(input.username);
  const designation = input.designation ?? '';
  const existing = await findByUsername(username);
  if (existing) {
    await db.run(
      'UPDATE app_user SET name = ?, role = ?, designation = ?, password_hash = ? WHERE username = ?',
      [input.name, input.role, designation, hashPassword(input.password), username],
    );
    return { id: existing.id, username, name: input.name, role: input.role, designation };
  }
  const id = randomUUID();
  await db.run(
    'INSERT INTO app_user (id, username, name, role, designation, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, username, input.name, input.role, designation, hashPassword(input.password), new Date().toISOString()],
  );
  return { id, username, name: input.name, role: input.role, designation };
}

/** Usernames are case-insensitive and trimmed for lookup stability. */
function normalise(username: string): string {
  return String(username).trim().toLowerCase();
}
