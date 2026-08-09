/**
 * Database connection & migration.
 *
 * Uses Node's built-in `node:sqlite` — zero native dependencies, which matters
 * for a government deployment that may not permit compiling native modules.
 * The SQL in `schema.sql` is plain and ports to PostgreSQL / Supabase without
 * application changes (02 §4 portability note).
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type DB = DatabaseSync;

let _db: DatabaseSync | null = null;

export function dbPath(): string {
  return process.env.EFIP_DB ?? resolve(__dirname, '../../data/efip.db');
}

export function getDb(): DatabaseSync {
  if (_db) return _db;
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(readFileSync(resolve(__dirname, 'schema.sql'), 'utf8'));
  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** Reset to a clean database — used by the seed script and tests. */
export function resetDb(): DatabaseSync {
  closeDb();
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(path + suffix);
      } catch {
        /* not present */
      }
    }
  } catch {
    /* ignore */
  }
  return getDb();
}

/**
 * Run `fn` inside a transaction. Staging is transactional so a pipeline failure
 * mid-way leaves no partial state (07 §9).
 */
export function transact<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

/** Typed query helper — node:sqlite returns null-prototype objects. */
export function all<T = Record<string, unknown>>(
  db: DatabaseSync,
  sql: string,
  params: unknown[] = [],
): T[] {
  const stmt = db.prepare(sql);
  return stmt.all(...(params as never[])) as T[];
}

export function one<T = Record<string, unknown>>(
  db: DatabaseSync,
  sql: string,
  params: unknown[] = [],
): T | undefined {
  const stmt = db.prepare(sql);
  return stmt.get(...(params as never[])) as T | undefined;
}

export function run(db: DatabaseSync, sql: string, params: unknown[] = []): void {
  const stmt = db.prepare(sql);
  stmt.run(...(params as never[]));
}
