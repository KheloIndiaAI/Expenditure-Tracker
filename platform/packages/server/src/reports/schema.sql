-- Report automation storage.
--
-- The pipeline this serves was written to run from a folder on a desktop: it
-- reads its settings from config.json, keeps run history and Monday snapshots
-- as JSON files, appends to an .xlsx log and writes documents into output/.
-- None of that survives here. ECS replaces the container on every deploy and
-- the filesystem goes with it, so everything the pipeline expects to find on
-- disk is held in these tables and written into a throwaway working directory
-- immediately before each run (see store.ts / service.ts).
--
-- A note on column types: timestamps are ISO-8601 TEXT and structured values
-- are JSON TEXT, rather than timestamptz/jsonb. Postgres would hand those back
-- as Date objects and parsed objects while the SQLite development path hands
-- back strings, and code that has to ask which engine it is talking to is code
-- that will eventually be wrong on one of them. TEXT reads identically on both.
--
-- Written to be re-runnable: every statement is IF NOT EXISTS, so this file is
-- applied on every boot exactly like auth-schema.sql.

-- One row per attempt, successful or not. Replaces the desktop's data/runs.json.
CREATE TABLE IF NOT EXISTS report_run (
  id            TEXT PRIMARY KEY,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL,          -- running | success | failed
  trigger       TEXT NOT NULL,          -- scheduled | manual | catch-up
  triggered_by  TEXT,                   -- username, when a person asked for it
  as_on         TEXT,                   -- dd.mm.yyyy, the report's own heading
  stamp         TEXT,                   -- yyyy-mm-dd, its filename date
  claims        INTEGER,
  agencies      INTEGER,
  totals        TEXT,                  -- assigned / expenditure / balance / rcUnutilised
  divisions     TEXT,
  warnings      TEXT,                  -- what the run wanted the reader to know
  error         TEXT
);
CREATE INDEX IF NOT EXISTS report_run_started_idx ON report_run (started_at DESC);
CREATE INDEX IF NOT EXISTS report_run_stamp_idx   ON report_run (stamp);

-- The documents themselves. A report is ~180KB, so bytea is comfortable and
-- keeps them inside the backup that already exists rather than adding a bucket.
CREATE TABLE IF NOT EXISTS report_doc (
  run_id     TEXT NOT NULL REFERENCES report_run(id) ON DELETE CASCADE,
  format     TEXT NOT NULL,             -- report(docx) | html | weekly-html | pdf | weekly-pdf
  name       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  content    BYTEA NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, format)
);

-- Monday component snapshots. Sheet3 carries running totals with no date, so a
-- week's component spend is the difference between two Mondays; losing these
-- silently costs a week of the leaderboard, which is why they are not left on
-- an ephemeral disk.
CREATE TABLE IF NOT EXISTS report_snapshot (
  taken_on   TEXT PRIMARY KEY,          -- yyyy-mm-dd
  components TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Small singleton blobs the pipeline reads and writes as files: its config
-- (which carries the division mapping and the manual overrides an operator
-- types in) and the cumulative daily log workbook.
CREATE TABLE IF NOT EXISTS report_state (
  key        TEXT PRIMARY KEY,          -- 'config' | 'daily-log'
  json       TEXT,
  blob       BYTEA,
  updated_at TEXT NOT NULL
);

-- One row every time an operator enters a new "Yesterday's Total" and it is
-- saved — the RBI Official Records ledger. This is deliberately NOT the same
-- table as report_state.manualOverrides: that holds only the figure CURRENTLY
-- in force, overwritten on every save, while this is an append-only history of
-- every day a figure was entered, which is the whole point of an official
-- record. See rbi-records.ts for the one rule that decides when a row is
-- added (a genuinely new day-total value, not a resave of an old one).
--
-- Soft-deleted, not dropped: "delete" in the panel removes a mistaken entry
-- from what is shown and exported, but a row here is never physically
-- destroyed. An official record with a silent, untraceable erase is a
-- contradiction, and keeping the row costs nothing a reader would notice.
CREATE TABLE IF NOT EXISTS rbi_record (
  id                 TEXT PRIMARY KEY,
  entry_date         TEXT NOT NULL,     -- yyyy-mm-dd, IST calendar day of the save
  total_assigned     INTEGER,           -- rupees; null only if never established
  total_expenditure  INTEGER NOT NULL,  -- rupees; the fixed total this entry produced
  balance            INTEGER,           -- rupees
  day_total          INTEGER NOT NULL,  -- rupees; the "Yesterday's Total" entered
  recorded_by        TEXT,              -- username
  created_at         TEXT NOT NULL,
  deleted_at         TEXT,
  deleted_by         TEXT
);
CREATE INDEX IF NOT EXISTS rbi_record_date_idx ON rbi_record (entry_date DESC, created_at DESC);
