/**
 * Sign-in history.
 *
 * Every attempt to reach the platform is appended here — successes, refusals
 * and sign-outs alike — so Administration can answer "who was on the platform,
 * and when?" without reading server logs. See `login_event` in auth-schema.sql
 * for the shape and for why refusals are kept.
 *
 * Nothing in this module updates or deletes. The table is append-only.
 */

import { randomUUID } from 'node:crypto';
import type { Role } from '@efip/shared';
import { getDb } from './db/index.ts';

export const LOGIN_OUTCOMES = ['success', 'failed', 'blocked', 'logout'] as const;
export type LoginOutcome = (typeof LOGIN_OUTCOMES)[number];

export interface LoginEvent {
  id: string;
  user_id: string;
  username: string;
  outcome: LoginOutcome;
  ip: string;
  at: string;
  /**
   * Joined from app_user at read time. NULL — not undefined — when the username
   * matches no account, because that is what a LEFT JOIN returns and callers
   * must render the stored `username` instead of an empty cell.
   */
  name: string | null;
  designation: string | null;
  role: Role | null;
}

/**
 * Append one event.
 *
 * Deliberately swallows its own failure. This runs inside the sign-in path, and
 * a database hiccup while writing the audit row must not become a platform
 * nobody can sign in to — the sign-in has already been authorised by the time we
 * get here, and refusing it now would protect nothing. The error is logged at
 * error level so a broken log is loud rather than silent.
 */
export async function recordLogin(
  e: { userId?: string; username: string; outcome: LoginOutcome; ip?: string },
  onError?: (err: unknown) => void,
): Promise<void> {
  try {
    const db = await getDb();
    await db.run(
      'INSERT INTO login_event (id, user_id, username, outcome, ip, at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        randomUUID(),
        e.userId ?? '',
        String(e.username ?? '').trim().toLowerCase(),
        e.outcome,
        (e.ip ?? '').slice(0, 60),
        new Date().toISOString(),
      ],
    );
  } catch (err) {
    onError?.(err);
  }
}

export interface LoginQuery {
  /** Rows to return. Clamped to 1..500; the log can be long. */
  limit?: number;
  /** Only this user's events. */
  userId?: string;
  /** Only this outcome. */
  outcome?: LoginOutcome;
  /** Only events at or after this ISO instant. */
  since?: string;
}

/**
 * Read the log, newest first.
 *
 * The join is LEFT, and the caller gets the stored username when it matches no
 * account: a failed attempt against a username that never existed is exactly
 * what an administrator most wants to see, and an INNER join would hide it.
 */
export async function listLogins(q: LoginQuery = {}): Promise<LoginEvent[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(Math.trunc(q.limit ?? 200) || 200, 1), 500);
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.userId) {
    where.push('e.user_id = ?');
    params.push(q.userId);
  }
  if (q.outcome) {
    where.push('e.outcome = ?');
    params.push(q.outcome);
  }
  if (q.since) {
    where.push('e.at >= ?');
    params.push(q.since);
  }
  const sql =
    'SELECT e.id, e.user_id, e.username, e.outcome, e.ip, e.at,' +
    ' u.name AS name, u.designation AS designation, u.role AS role' +
    ' FROM login_event e LEFT JOIN app_user u ON u.id = e.user_id' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY e.at DESC LIMIT ${limit}`;
  return db.all<LoginEvent>(sql, params);
}

/** How many events the log holds, and when each person was last seen. */
export async function loginSummary(): Promise<{
  total: number;
  lastSeen: { user_id: string; at: string }[];
}> {
  const db = await getDb();
  const t = await db.one<{ n: number | string }>('SELECT COUNT(*) AS n FROM login_event');
  const lastSeen = await db.all<{ user_id: string; at: string }>(
    "SELECT user_id, MAX(at) AS at FROM login_event WHERE outcome = 'success' AND user_id <> '' GROUP BY user_id",
  );
  return { total: Number(t?.n ?? 0), lastSeen };
}
