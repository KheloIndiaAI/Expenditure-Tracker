/**
 * Database access — one small async interface, two interchangeable drivers.
 *
 *   • Postgres (Amazon RDS) when `DATABASE_URL` is set — the production store.
 *     App Runner is stateless, so the auth table lives in managed Postgres.
 *   • SQLite (node:sqlite) otherwise — zero-dependency local development, the
 *     way the project ran before RDS. Same SQL, same code paths.
 *
 * All callers use the async `Db` interface below, so switching drivers is a
 * config change (set DATABASE_URL), never a code change. SQL is written with `?`
 * placeholders; the Postgres driver rewrites them to `$1,$2,…`.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { centreFromUsername } from '@efip/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
  exec(sql: string): Promise<void>;
}

const SCHEMA = () => readFileSync(resolve(__dirname, 'auth-schema.sql'), 'utf8');

/**
 * Columns added to `app_user` after the table already existed in production.
 *
 * `CREATE TABLE IF NOT EXISTS` cannot add a column to a table that is already
 * there, and the two engines disagree on the alternative: Postgres has
 * `ADD COLUMN IF NOT EXISTS`, SQLite does not. Rather than branch on the driver,
 * each ALTER is attempted and a "duplicate column" failure is treated as
 * success — the only outcome that matters is that the column exists afterwards.
 * Any other error is re-thrown, so a genuine problem still fails loudly at boot.
 *
 * Defaults are constants, which SQLite requires for ADD COLUMN, and they encode
 * the pre-existing behaviour: no contact details, and active.
 */
const ADD_COLUMNS = [
  "ALTER TABLE app_user ADD COLUMN email TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE app_user ADD COLUMN phone TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE app_user ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1',
  /* Append only, never reorder or edit: this list replays from the top on every
     boot. Empty means "belongs to no centre", which is the safe default — it
     grants nothing, so an existing login gains no write access by migrating. */
  "ALTER TABLE app_user ADD COLUMN regional_centre TEXT NOT NULL DEFAULT ''",
];

/**
 * Give every `RC_<Centre>` login its centre, where it has none.
 *
 * The column arrives empty, and empty means "may comment on nothing" — so
 * without this every Regional Centre login would silently lose the ability to
 * comment on its own vouchers until somebody ran a script, which is not a thing
 * anyone would know to do. The convention that names these accounts is the only
 * evidence the platform has about which centre they belong to, so it is used
 * here to fill the blank.
 *
 * Three properties make this safe to run on every boot:
 *   · it only ever writes where the value is empty, so an assignment made in
 *     Administration is never overwritten;
 *   · it matches a centre name exactly, with no fuzzy fallback, so a login it
 *     cannot place is left for a person to place;
 *   · it is not the authorisation rule. That reads the stored column. This just
 *     writes a sensible first value into it.
 *
 * The one case it gets wrong: an administrator who deliberately sets an `RC_*`
 * login to no centre will find it derived again at the next restart. Renaming
 * the login, or deactivating it, is the way to express that today.
 */
async function backfillCentres(db: Db): Promise<number> {
  const rows = await db.all<{ id: string; username: string }>(
    "SELECT id, username FROM app_user WHERE regional_centre IS NULL OR regional_centre = ''",
  );
  let n = 0;
  for (const r of rows) {
    const centre = centreFromUsername(r.username);
    if (!centre) continue;
    await db.run('UPDATE app_user SET regional_centre = ? WHERE id = ?', [centre, r.id]);
    n++;
  }
  return n;
}

async function applyMigrations(db: Db): Promise<void> {
  for (const sql of ADD_COLUMNS) {
    try {
      await db.exec(sql);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err).toLowerCase();
      const alreadyThere = msg.includes('duplicate column') || msg.includes('already exists');
      if (!alreadyThere) throw err;
    }
  }
  /* Data, not schema, so it follows the columns rather than sitting among them.
     A failure here must not stop the server booting: the platform works without
     a centre, it just cannot take comments, and refusing to start would turn a
     missing convenience into an outage. */
  try {
    const filled = await backfillCentres(db);
    if (filled) console.log(`✓ Assigned a Regional Centre to ${filled} login${filled === 1 ? '' : 's'} from its username.`);
  } catch (err) {
    console.error('!  Could not assign Regional Centres from usernames:', (err as Error)?.message ?? err);
  }
}

/** `?` → `$1,$2,…` for node-postgres, which uses numbered placeholders. */
function toPgPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

let _db: Promise<Db> | null = null;

/** Memoised: the first call creates and migrates the store. */
export function getDb(): Promise<Db> {
  if (!_db) _db = process.env.DATABASE_URL ? initPostgres() : initSqlite();
  return _db;
}

export async function closeDb(): Promise<void> {
  _db = null;
}

// ── Postgres (RDS) ───────────────────────────────────────────────────────────
async function initPostgres(): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // RDS requires TLS; verify-full needs the RDS CA bundle mounted, so default
    // to TLS-on with relaxed verification unless PGSSL_STRICT is set.
    ssl:
      process.env.PGSSL === 'disable'
        ? undefined
        : { rejectUnauthorized: process.env.PGSSL_STRICT === 'true' },
    max: Number(process.env.PG_POOL_MAX || 10),
  });
  const db: Db = {
    async all<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(toPgPlaceholders(sql), params as never[]);
      return r.rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(toPgPlaceholders(sql), params as never[]);
      return (r.rows[0] as T) ?? undefined;
    },
    async run(sql: string, params: unknown[] = []) {
      await pool.query(toPgPlaceholders(sql), params as never[]);
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
  };
  await db.exec(SCHEMA());
  await applyMigrations(db);
  return db;
}

// ── SQLite (local dev) ───────────────────────────────────────────────────────
async function initSqlite(): Promise<Db> {
  const { mkdirSync } = await import('node:fs');
  // node:sqlite is behind an experimental flag; only imported on this path.
  const { DatabaseSync } = await import('node:sqlite');
  const path = process.env.EFIP_DB ?? resolve(__dirname, '../../data/efip.db');
  mkdirSync(dirname(path), { recursive: true });
  const sq = new DatabaseSync(path);
  sq.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  sq.exec(SCHEMA());
  const db: Db = {
    async all<T>(sql: string, params: unknown[] = []) {
      return sq.prepare(sql).all(...(params as never[])) as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      return sq.prepare(sql).get(...(params as never[])) as T | undefined;
    },
    async run(sql: string, params: unknown[] = []) {
      sq.prepare(sql).run(...(params as never[]));
    },
    async exec(sql: string) {
      sq.exec(sql);
    },
  };
  await applyMigrations(db);
  return db;
}
