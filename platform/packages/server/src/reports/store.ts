/**
 * Report automation — persistence, and the bridge between Postgres and the
 * folder the pipeline expects.
 *
 * The vendored pipeline reads and writes files: a config, a snapshots file, a
 * cumulative .xlsx log, a folder of documents. That is right for the desktop it
 * came from and impossible here, where the container is replaced on every
 * deploy. So nothing is left on disk between runs. Before a run, `hydrate()`
 * builds a working directory and fills it from these tables; after a run,
 * `persist()` reads back whatever the pipeline wrote and stores it. The pipeline
 * itself is never told any of this is happening — see vendor/README.md.
 */

import { readFileSync, mkdirSync, existsSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = () => readFileSync(resolve(__dirname, 'schema.sql'), 'utf8');
const SEED = () => JSON.parse(readFileSync(resolve(__dirname, 'default-config.json'), 'utf8'));
const SEED_SNAPS = (): Array<{ takenOn: string; components: unknown }> =>
  JSON.parse(readFileSync(resolve(__dirname, 'default-snapshots.json'), 'utf8')).snapshots ?? [];

const now = () => new Date().toISOString();

/**
 * Postgres hands jsonb back parsed and SQLite hands text back as a string; the
 * columns are TEXT precisely so neither happens, but a value that has already
 * been parsed by a driver upgrade should not become a crash.
 */
function asJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}

/** node-postgres returns bytea as Buffer; node:sqlite returns Uint8Array. */
function asBuffer(v: unknown): Buffer | null {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  return null;
}

/**
 * Bring an existing rbi_record table up to the shape schema.sql now declares.
 *
 * `CREATE TABLE IF NOT EXISTS` only helps a table that does not exist yet, so
 * an environment that already ran an earlier version of this schema keeps
 * whatever it was first given. Two things have to be corrected there:
 *
 *  · BIGINT, not INTEGER. Postgres's INTEGER stops at 2,147,483,647 and this
 *    scheme's own Total Assigned is already ~3.94 billion rupees, so every
 *    insert was rejected — silently, because the caller is right to swallow
 *    errors from a ledger write rather than fail the operator's save.
 *  · NOT NULL dropped from the two figure columns, which a row is now allowed
 *    to be missing (see schema.sql).
 *
 * Postgres only — SQLite has neither ALTER COLUMN TYPE nor DROP NOT NULL, and
 * needs neither: its INTEGER never had a width limit. It does inherit the
 * NOT NULL columns though, which migrateRbiSqlite below deals with separately.
 *
 * Safe on every boot: altering a column to the type it already has, or
 * dropping a NOT NULL that is already gone, are both valid no-ops in Postgres.
 * A failure is logged, never thrown — a migration problem must not be the
 * reason the whole server refuses to start.
 */
async function migrateRbiColumns(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    await db.exec(`
      ALTER TABLE rbi_record ALTER COLUMN total_assigned TYPE BIGINT;
      ALTER TABLE rbi_record ALTER COLUMN total_expenditure TYPE BIGINT;
      ALTER TABLE rbi_record ALTER COLUMN balance TYPE BIGINT;
      ALTER TABLE rbi_record ALTER COLUMN day_total TYPE BIGINT;
      ALTER TABLE rbi_record ALTER COLUMN total_expenditure DROP NOT NULL;
      ALTER TABLE rbi_record ALTER COLUMN day_total DROP NOT NULL;
    `);
  } catch (err) {
    console.error('rbi_record: could not bring its columns up to date —', (err as Error)?.message ?? err);
  }
}

/**
 * The same correction for SQLite, which cannot express it as an ALTER.
 *
 * Only the NOT NULL half applies here — SQLite's INTEGER has no width to
 * outgrow — and the only way to drop a constraint it has is to build the table
 * again beside it, copy the rows across and swap the names. That is a real
 * operation on a table holding real records, so it runs ONLY when the old
 * constraint is actually still there, and inside a transaction, so a database
 * that fails half way through is left exactly as it was rather than half
 * converted.
 *
 * This exists for development databases created in the short window when the
 * columns were NOT NULL. It costs a PRAGMA on every boot and does nothing at
 * all afterwards.
 */
async function migrateRbiSqlite(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  if (process.env.DATABASE_URL) return;
  try {
    const cols = await db.all<{ name: string; notnull: number }>('PRAGMA table_info(rbi_record)');
    const stuck = cols.some((c) => (c.name === 'total_expenditure' || c.name === 'day_total') && Number(c.notnull) === 1);
    if (!stuck) return;
    await db.exec(`
      BEGIN;
      CREATE TABLE rbi_record_new (
        id                 TEXT PRIMARY KEY,
        entry_date         TEXT NOT NULL,
        total_assigned     BIGINT,
        total_expenditure  BIGINT,
        balance            BIGINT,
        day_total          BIGINT,
        recorded_by        TEXT,
        created_at         TEXT NOT NULL,
        deleted_at         TEXT,
        deleted_by         TEXT
      );
      INSERT INTO rbi_record_new
        SELECT id, entry_date, total_assigned, total_expenditure, balance, day_total,
               recorded_by, created_at, deleted_at, deleted_by
          FROM rbi_record;
      DROP TABLE rbi_record;
      ALTER TABLE rbi_record_new RENAME TO rbi_record;
      CREATE INDEX IF NOT EXISTS rbi_record_date_idx ON rbi_record (entry_date DESC, created_at DESC);
      COMMIT;
    `);
    console.log('✓ rbi_record: rebuilt without the NOT NULL columns (SQLite).');
  } catch (err) {
    try { await db.exec('ROLLBACK;'); } catch { /* nothing open to roll back */ }
    console.error('rbi_record: could not rebuild the table —', (err as Error)?.message ?? err);
  }
}

let ready: Promise<void> | null = null;
export function initReports(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await getDb();
      await db.exec(SCHEMA());
      await migrateRbiColumns(db);
      await migrateRbiSqlite(db);
      /* Once per process, right after the tables are known to exist. There is no
         scheduler to do this at boot any more, and it has to happen before the
         first status or run — a run left 'running' by a container replaced
         mid-flight would otherwise refuse every later one. Inline rather than
         a wrapper that awaits initReports() first, which would deadlock. */
      await reap(db);
      await seedSnapshots(db);
    })();
  }
  return ready;
}

/**
 * Carry the desktop tool's Monday snapshots over, ONCE, into an empty table.
 *
 * Component spending on the weekly report is a week-over-week difference, so
 * it needs a Monday to subtract from. A platform that has never produced a
 * report has none, and would have to wait two weeks to grow its own - so the
 * tool's own history is seeded instead, from the same sheet and the same
 * component keys this pipeline computes.
 *
 * Only into an EMPTY table. Once the platform holds any snapshot of its own,
 * the stored rows are the record and this never runs again - a seed that
 * reasserted itself on every boot could quietly overwrite a real Monday with
 * a stale copy of one.
 */
async function seedSnapshots(db: Awaited<ReturnType<typeof getDb>>): Promise<number> {
  const existing = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM report_snapshot');
  if (Number(existing?.n ?? 0) > 0) return 0;
  let seeded = 0;
  for (const s of SEED_SNAPS()) {
    if (!s?.takenOn) continue;
    await db.run(
      'INSERT INTO report_snapshot (taken_on, components, created_at) VALUES (?, ?, ?)',
      [s.takenOn, JSON.stringify(s.components ?? []), now()],
    );
    seeded++;
  }
  return seeded;
}

const STALE_AFTER_MS = 20 * 60 * 1000;

async function reap(db: Awaited<ReturnType<typeof getDb>>): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const stale = await db.all<{ id: string }>(
    "SELECT id FROM report_run WHERE status = 'running' AND started_at < ?", [cutoff],
  );
  for (const r of stale) {
    await db.run(
      `UPDATE report_run SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`,
      [now(), 'The server restarted while this run was in progress.', r.id],
    );
  }
  return stale.length;
}

// ── config ───────────────────────────────────────────────────────────────────

export interface ReportConfig {
  paths: Record<string, unknown>;
  googleSheets: Record<string, unknown>;
  testSheet2: Record<string, unknown>;
  divisions: Array<Record<string, unknown>>;
  manualOverrides?: Record<string, unknown>;
  expenditureBaseline?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * The live config. Seeded from default-config.json the first time only; after
 * that the database copy wins, because that is what the operator has edited.
 */
export async function getConfig(): Promise<ReportConfig> {
  await initReports();
  const db = await getDb();
  const row = await db.one<{ json: string }>("SELECT json FROM report_state WHERE key = 'config'");
  if (row?.json) return asJson<ReportConfig>(row.json, SEED());
  const seed = SEED() as ReportConfig;
  await saveConfig(seed);
  return seed;
}

export async function saveConfig(config: ReportConfig): Promise<ReportConfig> {
  await initReports();
  const db = await getDb();
  const json = JSON.stringify(config);
  await db.run(
    `INSERT INTO report_state (key, json, updated_at) VALUES ('config', ?, ?)
     ON CONFLICT (key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    [json, now()],
  );
  return config;
}

// ── runs ─────────────────────────────────────────────────────────────────────

export interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'failed';
  trigger: string;
  triggered_by: string | null;
  as_on: string | null;
  stamp: string | null;
  claims: number | null;
  agencies: number | null;
  totals: unknown;
  divisions: unknown;
  warnings: unknown;
  error: string | null;
}

export interface RunSummary {
  id: string;
  at: string;
  finishedAt: string | null;
  status: string;
  trigger: string;
  triggeredBy: string | null;
  asOn: string | null;
  stamp: string | null;
  claims: number | null;
  agencies: number | null;
  totals: Record<string, number> | null;
  warnings: string[];
  error: string | null;
  docs?: Array<{ format: string; name: string; bytes: number }>;
}

const toSummary = (r: RunRow): RunSummary => ({
  id: r.id,
  at: r.started_at,
  finishedAt: r.finished_at,
  status: r.status,
  trigger: r.trigger,
  triggeredBy: r.triggered_by,
  asOn: r.as_on,
  stamp: r.stamp,
  claims: r.claims,
  agencies: r.agencies,
  totals: asJson<Record<string, number> | null>(r.totals, null),
  warnings: asJson<string[]>(r.warnings, []),
  error: r.error,
});

export async function startRun(trigger: string, triggeredBy?: string | null): Promise<string> {
  await initReports();
  const db = await getDb();
  const id = randomUUID();
  await db.run(
    `INSERT INTO report_run (id, started_at, status, trigger, triggered_by)
     VALUES (?, ?, 'running', ?, ?)`,
    [id, now(), trigger, triggeredBy ?? null],
  );
  return id;
}

export async function finishRun(
  id: string,
  patch: {
    status: 'success' | 'failed';
    asOn?: string | null;
    stamp?: string | null;
    claims?: number | null;
    agencies?: number | null;
    totals?: unknown;
    divisions?: unknown;
    warnings?: unknown;
    error?: string | null;
  },
): Promise<void> {
  const db = await getDb();
  await db.run(
    `UPDATE report_run SET finished_at = ?, status = ?, as_on = ?, stamp = ?,
            claims = ?, agencies = ?, totals = ?, divisions = ?, warnings = ?, error = ?
      WHERE id = ?`,
    [
      now(), patch.status, patch.asOn ?? null, patch.stamp ?? null,
      patch.claims ?? null, patch.agencies ?? null,
      patch.totals ? JSON.stringify(patch.totals) : null,
      patch.divisions ? JSON.stringify(patch.divisions) : null,
      JSON.stringify(patch.warnings ?? []),
      patch.error ?? null,
      id,
    ],
  );
}

export async function listRuns(limit = 20): Promise<RunSummary[]> {
  await initReports();
  const db = await getDb();
  const n = Math.max(1, Math.min(200, Math.trunc(limit) || 20));
  const rows = await db.all<RunRow>(
    'SELECT * FROM report_run ORDER BY started_at DESC LIMIT ?', [n],
  );
  return rows.map(toSummary);
}

/** The newest run that produced documents — what the panel opens on. */
export async function latestSuccess(): Promise<RunSummary | null> {
  await initReports();
  const db = await getDb();
  const row = await db.one<RunRow>(
    "SELECT * FROM report_run WHERE status = 'success' ORDER BY started_at DESC LIMIT 1",
  );
  if (!row) return null;
  const s = toSummary(row);
  s.docs = await listDocs(row.id);
  return s;
}

export async function getRun(id: string): Promise<RunSummary | null> {
  await initReports();
  const db = await getDb();
  const row = await db.one<RunRow>('SELECT * FROM report_run WHERE id = ?', [id]);
  if (!row) return null;
  const s = toSummary(row);
  s.docs = await listDocs(row.id);
  return s;
}

/** Is something already running? Guards a second Generate while one is in flight. */
export async function runningRun(): Promise<RunSummary | null> {
  await initReports();
  const db = await getDb();
  const row = await db.one<RunRow>(
    "SELECT * FROM report_run WHERE status = 'running' ORDER BY started_at DESC LIMIT 1",
  );
  return row ? toSummary(row) : null;
}

// ── documents ────────────────────────────────────────────────────────────────

export async function putDoc(runId: string, format: string, name: string, content: Buffer): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO report_doc (run_id, format, name, bytes, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (run_id, format) DO UPDATE SET
       name = excluded.name, bytes = excluded.bytes,
       content = excluded.content, created_at = excluded.created_at`,
    [runId, format, name, content.length, content, now()],
  );
}

export async function listDocs(runId: string): Promise<Array<{ format: string; name: string; bytes: number }>> {
  const db = await getDb();
  return db.all<{ format: string; name: string; bytes: number }>(
    'SELECT format, name, bytes FROM report_doc WHERE run_id = ? ORDER BY format', [runId],
  );
}

export async function getDoc(runId: string, format: string): Promise<{ name: string; content: Buffer } | null> {
  const db = await getDb();
  const row = await db.one<{ name: string; content: unknown }>(
    'SELECT name, content FROM report_doc WHERE run_id = ? AND format = ?', [runId, format],
  );
  const content = row ? asBuffer(row.content) : null;
  return row && content ? { name: row.name, content } : null;
}

// ── the working directory ────────────────────────────────────────────────────

export interface WorkDir { home: string; outDir: string }

/**
 * Build the folder the pipeline expects and fill it from the database.
 *
 * `EFIP_REPORTS_HOME` is what makes the vendored code look here instead of at
 * its own package folder — the one patch that makes any of this possible.
 */
export async function hydrate(): Promise<WorkDir> {
  await initReports();
  const db = await getDb();
  const home = join(tmpdir(), `efip-reports-${randomUUID()}`);
  for (const d of ['config', 'data', 'logs', 'output', join('input', '_live')]) {
    mkdirSync(join(home, d), { recursive: true });
  }

  const config = await getConfig();
  writeFileSync(join(home, 'config', 'config.json'), JSON.stringify(config, null, 2) + '\n');

  const snaps = await db.all<{ taken_on: string; components: string }>(
    'SELECT taken_on, components FROM report_snapshot ORDER BY taken_on ASC',
  );
  writeFileSync(
    join(home, 'data', 'weekly-snapshots.json'),
    JSON.stringify({
      snapshots: snaps.map((s) => ({ takenOn: s.taken_on, components: asJson(s.components, []) })),
    }, null, 2) + '\n',
  );

  const log = await db.one<{ blob: unknown }>("SELECT blob FROM report_state WHERE key = 'daily-log'");
  const logBuf = log ? asBuffer(log.blob) : null;
  if (logBuf) writeFileSync(join(home, 'logs', 'daily-expenditure-log.xlsx'), logBuf);

  return { home, outDir: join(home, 'output') };
}

/**
 * Read back everything the run wrote and store it, then delete the folder.
 * Documents are keyed by the format the pipeline itself labelled them with, so
 * the DOCX, the HTML it prints from and the weekly HTML each land in their own
 * row and can be fetched independently.
 */
export async function persist(
  work: WorkDir,
  runId: string,
  outputs: Array<{ format: string; name: string; path: string }>,
): Promise<Array<{ format: string; name: string; bytes: number }>> {
  const db = await getDb();
  const stored: Array<{ format: string; name: string; bytes: number }> = [];

  for (const o of outputs) {
    if (!o.path || !existsSync(o.path)) continue;
    const content = readFileSync(o.path);
    await putDoc(runId, o.format, o.name, content);
    stored.push({ format: o.format, name: o.name, bytes: content.length });
  }

  const snapFile = join(work.home, 'data', 'weekly-snapshots.json');
  if (existsSync(snapFile)) {
    const parsed = asJson<{ snapshots?: Array<{ takenOn: string; components: unknown }> }>(
      readFileSync(snapFile, 'utf8'), {},
    );
    for (const s of parsed.snapshots ?? []) {
      await db.run(
        `INSERT INTO report_snapshot (taken_on, components, created_at) VALUES (?, ?, ?)
         ON CONFLICT (taken_on) DO UPDATE SET components = excluded.components`,
        [s.takenOn, JSON.stringify(s.components ?? []), now()],
      );
    }
  }

  const logFile = join(work.home, 'logs', 'daily-expenditure-log.xlsx');
  if (existsSync(logFile)) {
    await db.run(
      `INSERT INTO report_state (key, blob, updated_at) VALUES ('daily-log', ?, ?)
       ON CONFLICT (key) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at`,
      [readFileSync(logFile), now()],
    );
  }

  /* The pipeline may have rewritten config.json (the overrides endpoints go
     through its own saveConfig), so it is read back rather than assumed. */
  const cfgFile = join(work.home, 'config', 'config.json');
  if (existsSync(cfgFile)) {
    try { await saveConfig(JSON.parse(readFileSync(cfgFile, 'utf8'))); } catch { /* keep the stored one */ }
  }

  return stored;
}

export function discard(work: WorkDir): void {
  try { rmSync(work.home, { recursive: true, force: true }); } catch { /* a temp dir left behind is not worth failing a run over */ }
}

/** The cumulative daily log, for the panel's download. */
export async function getDailyLog(): Promise<Buffer | null> {
  await initReports();
  const db = await getDb();
  const row = await db.one<{ blob: unknown }>("SELECT blob FROM report_state WHERE key = 'daily-log'");
  return row ? asBuffer(row.blob) : null;
}

// ── the current-week report ─────────────────────────────────────────────────
//
// A singleton, deliberately: "this week so far" has exactly one meaningful
// answer at any moment, and generating it again replaces the old one rather
// than adding to a history. That is the whole difference from report_doc,
// which keys documents to the run that produced them because each of those is
// a record of a particular day and all of them stay worth keeping.

export interface CurrentWeekMeta {
  generatedAt: string;
  generatedBy: string | null;
  /** The window the pages actually cover, yyyy-mm-dd. */
  rangeStart: string | null;
  rangeEnd: string | null;
  bytes: number;
  pages: number | null;
  /** Anything the reader should know about what is and is not on the pages. */
  warnings: string[];
}

const CURRENT_WEEK_KEY = 'weekly-current';

export async function putCurrentWeek(pdf: Buffer, meta: CurrentWeekMeta): Promise<void> {
  await initReports();
  const db = await getDb();
  await db.run(
    `INSERT INTO report_state (key, json, blob, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET
       json = excluded.json, blob = excluded.blob, updated_at = excluded.updated_at`,
    [CURRENT_WEEK_KEY, JSON.stringify(meta), pdf, now()],
  );
}

/** The metadata alone — what the panel needs to describe the stored copy. */
export async function getCurrentWeekMeta(): Promise<CurrentWeekMeta | null> {
  await initReports();
  const db = await getDb();
  const row = await db.one<{ json: string }>(
    'SELECT json FROM report_state WHERE key = ?', [CURRENT_WEEK_KEY],
  );
  return row?.json ? asJson<CurrentWeekMeta | null>(row.json, null) : null;
}

/** The stored PDF itself, for the download. */
export async function getCurrentWeekPdf(): Promise<Buffer | null> {
  await initReports();
  const db = await getDb();
  const row = await db.one<{ blob: unknown }>(
    'SELECT blob FROM report_state WHERE key = ?', [CURRENT_WEEK_KEY],
  );
  return row ? asBuffer(row.blob) : null;
}

// ── RBI Official Records ────────────────────────────────────────────────────
// One row per calendar day, holding the four figures as they were last saved
// that day. See schema.sql for why this is its own table rather than living
// inside manualOverrides, and rbi-records.ts for what a row means and why
// nothing conditional decides whether one gets written.

export interface RbiRecordRow {
  id: string;
  entryDate: string;
  totalAssigned: number | null;
  totalExpenditure: number | null;
  balance: number | null;
  dayTotal: number | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface RbiRecordInput {
  entryDate: string;
  totalAssigned: number | null;
  totalExpenditure: number | null;
  balance: number | null;
  dayTotal: number | null;
  recordedBy: string | null;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

const toRbiRow = (r: Record<string, unknown>): RbiRecordRow => ({
  id: r.id as string,
  entryDate: r.entry_date as string,
  totalAssigned: num(r.total_assigned),
  totalExpenditure: num(r.total_expenditure),
  balance: num(r.balance),
  dayTotal: num(r.day_total),
  recordedBy: (r.recorded_by as string) ?? null,
  createdAt: r.created_at as string,
});

/**
 * Write the row for one calendar day: update the day's existing row if it has
 * one, otherwise insert it. Rupees throughout — see rbi-records.ts for the
 * crore boundary.
 *
 * Read-then-write rather than ON CONFLICT, for two reasons. The table shipped
 * without a unique constraint on entry_date, and adding one to a table that
 * already exists in production is a migration that can fail on data it finds;
 * and the two engines spell upsert differently enough that the plain version
 * is the one that is obviously correct on both. This runs once per save, so
 * the extra SELECT costs nothing worth optimising.
 *
 * A day whose row was deleted starts clean: the lookup only considers rows
 * that are not soft-deleted, so re-entering a figure after deleting a mistake
 * inserts a fresh row rather than resurrecting the discarded one.
 */
export async function upsertRbiRecord(input: RbiRecordInput): Promise<RbiRecordRow> {
  await initReports();
  const db = await getDb();
  const existing = await db.one<{ id: string; created_at: string }>(
    'SELECT id, created_at FROM rbi_record WHERE entry_date = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1',
    [input.entryDate],
  );

  if (existing) {
    await db.run(
      `UPDATE rbi_record
          SET total_assigned = ?, total_expenditure = ?, balance = ?, day_total = ?,
              recorded_by = ?, created_at = ?
        WHERE id = ?`,
      [input.totalAssigned, input.totalExpenditure, input.balance, input.dayTotal,
        input.recordedBy, now(), existing.id],
    );
    return { id: existing.id, createdAt: now(), ...input };
  }

  const id = randomUUID();
  const createdAt = now();
  await db.run(
    `INSERT INTO rbi_record
       (id, entry_date, total_assigned, total_expenditure, balance, day_total, recorded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.entryDate, input.totalAssigned, input.totalExpenditure, input.balance,
      input.dayTotal, input.recordedBy, createdAt],
  );
  return { id, createdAt, ...input };
}

/** Newest first — the order the panel and the exported workbook both use. */
export async function listRbiRecords(): Promise<RbiRecordRow[]> {
  await initReports();
  const db = await getDb();
  const rows = await db.all<Record<string, unknown>>(
    `SELECT * FROM rbi_record WHERE deleted_at IS NULL ORDER BY entry_date DESC, created_at DESC`,
  );
  return rows.map(toRbiRow);
}

/**
 * Soft-delete one entry made by mistake.
 *
 * Marked, not removed: an "official record" that could be silently and
 * untraceably erased would not be one. The row simply stops appearing in the
 * list or the exported workbook from here on — see listRbiRecords, which is
 * also what the download reads from, so a deleted row can never appear in a
 * workbook generated after it was deleted.
 *
 * Returns false for an id that does not exist or was already deleted, so the
 * route can tell the difference between "gone" and "never was".
 */
export async function deleteRbiRecord(id: string, deletedBy: string | null): Promise<boolean> {
  await initReports();
  const db = await getDb();
  const row = await db.one<{ id: string }>(
    'SELECT id FROM rbi_record WHERE id = ? AND deleted_at IS NULL', [id],
  );
  if (!row) return false;
  await db.run(
    'UPDATE rbi_record SET deleted_at = ?, deleted_by = ? WHERE id = ?',
    [now(), deletedBy, id],
  );
  return true;
}

export const _internal = { asJson, asBuffer, readdirSync, statSync };
