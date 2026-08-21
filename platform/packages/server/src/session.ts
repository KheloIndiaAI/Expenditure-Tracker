/**
 * Session resolution — the one place a request turns into a user.
 *
 * The JWT carries the username, but the user is re-read from the database on
 * every request rather than trusted from the token. That costs a lookup and buys
 * something important: deactivating an account, changing its role, or revoking a
 * module takes effect on the user's very next request instead of whenever their
 * 12-hour token happens to expire.
 */

import type { User } from '@efip/shared';
import { findByUsername } from './users.ts';
import { verifyToken } from './auth.ts';

export const COOKIE_NAME = process.env.COOKIE_NAME || 'efip_session';

export interface CookieCarrier {
  cookies?: Record<string, string | undefined>;
}

/** Never let a hash leave this process, even into a log line. */
export function stripHash(u: User & { password_hash?: string }): User {
  const { password_hash, ...rest } = u;
  return rest;
}

export async function currentUser(req: CookieCarrier): Promise<User | null> {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  const claims = verifyToken(token);
  if (!claims) return null;
  const row = await findByUsername(claims.username);
  if (!row) return null;
  const user = stripHash(row);
  // A deactivated account is treated as signed out, immediately.
  return user.is_active ? user : null;
}
