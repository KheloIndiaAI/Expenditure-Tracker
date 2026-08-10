/**
 * User store — the only table this database holds.
 *
 * The financial dataset is read live from the Google Sheet by the dashboard, so
 * nothing financial is persisted; this module is exclusively about identity for
 * the custom login.
 */

import { randomUUID } from 'node:crypto';
import type { Role, User } from '@efip/shared';
import { getDb, one, run } from './db/index.ts';
import { hashPassword } from './auth.ts';

interface UserRow extends User {
  password_hash: string;
}

export type UserWithHash = User & { password_hash: string };

export function findByEmail(email: string): UserWithHash | undefined {
  return one<UserRow>(
    getDb(),
    'SELECT id, email, name, role, designation, password_hash FROM app_user WHERE email = ?',
    [String(email).trim().toLowerCase()],
  );
}

export function countUsers(): number {
  return one<{ n: number }>(getDb(), 'SELECT COUNT(*) AS n FROM app_user')?.n ?? 0;
}

export interface NewUser {
  email: string;
  password: string;
  name: string;
  role: Role;
  designation?: string;
}

export function createUser(input: NewUser): User {
  const id = randomUUID();
  const email = input.email.trim().toLowerCase();
  const designation = input.designation ?? '';
  run(
    getDb(),
    'INSERT INTO app_user (id, email, name, role, designation, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, email, input.name, input.role, designation, hashPassword(input.password), new Date().toISOString()],
  );
  return { id, email, name: input.name, role: input.role, designation };
}

/** Idempotent — used by the seed script so re-running never errors on the unique email. */
export function upsertUser(input: NewUser): User {
  const existing = findByEmail(input.email);
  const email = input.email.trim().toLowerCase();
  const designation = input.designation ?? '';
  if (existing) {
    run(
      getDb(),
      'UPDATE app_user SET name = ?, role = ?, designation = ?, password_hash = ? WHERE email = ?',
      [input.name, input.role, designation, hashPassword(input.password), email],
    );
    return { id: existing.id, email, name: input.name, role: input.role, designation };
  }
  return createUser(input);
}
