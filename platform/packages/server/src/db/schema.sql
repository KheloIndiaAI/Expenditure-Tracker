-- ============================================================================
--  Executive Financial Intelligence Platform — Published store (star schema)
--  Implements PRD `03_Data_Model.md` §2–§5 and `07_Upload_System.md` §5–§7.
--
--  PORTABILITY (02 §4 portability note): this is deliberately plain SQL. It runs
--  on SQLite (dev / single-node ministry deployment) and ports to PostgreSQL /
--  Supabase by swapping INTEGER PRIMARY KEY AUTOINCREMENT → BIGSERIAL and TEXT
--  timestamps → TIMESTAMPTZ. No vendor-specific constructs are used.
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── Identity & access (07 §8) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_user (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  designation   TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- ─── dim_version (03 §4, 07 §5) ─────────────────────────────────────────────
-- A version is immutable once published; corrections create a NEW version (RI-4).

CREATE TABLE IF NOT EXISTS dim_version (
  version_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  label             TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('staged','submitted','published','rejected','superseded')),
  uploaded_by       TEXT REFERENCES app_user(id),
  uploaded_at       TEXT NOT NULL,
  submitted_by      TEXT REFERENCES app_user(id),
  submitted_at      TEXT,
  published_by      TEXT REFERENCES app_user(id),
  published_at      TEXT,
  source_filename   TEXT NOT NULL,
  checksum          TEXT NOT NULL,
  is_current        INTEGER NOT NULL DEFAULT 0,
  txn_count         INTEGER NOT NULL DEFAULT 0,
  net_amount        REAL NOT NULL DEFAULT 0,
  utilisation       REAL NOT NULL DEFAULT 0,
  balance_remaining REAL NOT NULL DEFAULT 0,
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS ix_version_current ON dim_version(is_current);
CREATE INDEX IF NOT EXISTS ix_version_status  ON dim_version(status);

-- ─── Conformed dimensions (03 §4) ───────────────────────────────────────────
-- RI-5: a dimension member in use by any version is never deleted; retire instead.

CREATE TABLE IF NOT EXISTS dim_head (
  name       TEXT PRIMARY KEY,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dim_subvertical (
  name       TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dim_sub_category_group (
  name       TEXT PRIMARY KEY,
  ordinal    INTEGER NOT NULL DEFAULT 0
);

-- The controlled vocabulary — a GOVERNED asset, not free text (03 §7).
-- `status` (In Use / Reserved) is derived per version, so it is not stored here.
CREATE TABLE IF NOT EXISTS dim_sub_category (
  name                TEXT PRIMARY KEY,
  group_name          TEXT NOT NULL REFERENCES dim_sub_category_group(name),
  definition          TEXT NOT NULL DEFAULT '',
  classification_rule TEXT NOT NULL DEFAULT '',
  ordinal             INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dim_regional_centre (
  name          TEXT PRIMARY KEY,
  city          TEXT NOT NULL DEFAULT '',
  is_hq         INTEGER NOT NULL DEFAULT 0,
  region        TEXT NOT NULL DEFAULT '',
  is_ner        INTEGER NOT NULL DEFAULT 0,
  source_sheet  TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dim_grantee (
  name       TEXT PRIMARY KEY,
  type       TEXT NOT NULL DEFAULT 'Regional Centre',
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dim_sanction (
  sanction_no TEXT PRIMARY KEY,
  series      TEXT NOT NULL
);

-- ─── fact_transaction (03 §3) ───────────────────────────────────────────────
-- Grain: one voucher-level fund release on one RC tab (03 §2.1).
-- Each publish stores a full immutable snapshot keyed by version_id (03 §9).

CREATE TABLE IF NOT EXISTS fact_transaction (
  transaction_id       TEXT NOT NULL,
  version_id           INTEGER NOT NULL REFERENCES dim_version(version_id),
  s_no                 INTEGER NOT NULL,
  source_sheet         TEXT NOT NULL,
  source_row           INTEGER NOT NULL,
  payment_date         TEXT NOT NULL,
  voucher_no           TEXT NOT NULL,
  sanction_no          TEXT NOT NULL,
  head                 TEXT NOT NULL REFERENCES dim_head(name),
  subvertical          TEXT NOT NULL REFERENCES dim_subvertical(name),
  regional_centre      TEXT NOT NULL REFERENCES dim_regional_centre(name),
  grantee              TEXT NOT NULL REFERENCES dim_grantee(name),
  expenditure_type     TEXT NOT NULL,
  narration            TEXT NOT NULL,          -- NEVER altered (03 §3)
  sub_category         TEXT NOT NULL REFERENCES dim_sub_category(name),
  sub_category_group   TEXT NOT NULL,
  classification_basis TEXT NOT NULL CHECK (classification_basis IN ('explicit','contextual')),
  classification_rule_id TEXT NOT NULL DEFAULT '',
  classification_evidence TEXT NOT NULL DEFAULT '',
  net_amount           REAL NOT NULL,
  amt_general          REAL NOT NULL DEFAULT 0,
  amt_sc               REAL NOT NULL DEFAULT 0,
  amt_st               REAL NOT NULL DEFAULT 0,
  utilisation          REAL NOT NULL DEFAULT 0,
  balance_remaining    REAL NOT NULL DEFAULT 0,
  -- derived on publish (03 §3.1)
  utilisation_pct      REAL NOT NULL DEFAULT 0,
  balance_pct          REAL NOT NULL DEFAULT 0,
  is_idle              INTEGER NOT NULL DEFAULT 0,
  is_fully_utilised    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (version_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS ix_txn_version   ON fact_transaction(version_id);
CREATE INDEX IF NOT EXISTS ix_txn_rc        ON fact_transaction(version_id, regional_centre);
CREATE INDEX IF NOT EXISTS ix_txn_subv      ON fact_transaction(version_id, subvertical);
CREATE INDEX IF NOT EXISTS ix_txn_subcat    ON fact_transaction(version_id, sub_category);
CREATE INDEX IF NOT EXISTS ix_txn_head      ON fact_transaction(version_id, head);
CREATE INDEX IF NOT EXISTS ix_txn_grantee   ON fact_transaction(version_id, grantee);
CREATE INDEX IF NOT EXISTS ix_txn_date      ON fact_transaction(version_id, payment_date);
CREATE INDEX IF NOT EXISTS ix_txn_idle      ON fact_transaction(version_id, is_idle);

-- ─── fact_budget_allocation (03 §5) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fact_budget_allocation (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id             INTEGER NOT NULL REFERENCES dim_version(version_id),
  component              TEXT NOT NULL,
  sub_component          TEXT,
  head                   TEXT NOT NULL,
  be_allocation_cr       REAL,
  assigned_to_sai_cr     REAL,
  balance_cr             REAL,
  expenditure_to_date_cr REAL,
  week                   TEXT
);
CREATE INDEX IF NOT EXISTS ix_budget_version ON fact_budget_allocation(version_id);

-- ─── Compute-on-publish materialisations (02 §6) ────────────────────────────
-- Heavy roll-ups are materialised once per publish, not computed per request.
-- This is what makes the <2s dashboard and <500ms filter targets achievable.

CREATE TABLE IF NOT EXISTS agg_breakdown (
  version_id        INTEGER NOT NULL REFERENCES dim_version(version_id),
  dim               TEXT NOT NULL,
  member_key        TEXT NOT NULL,
  label             TEXT NOT NULL,
  net_amount        REAL NOT NULL,
  utilisation       REAL NOT NULL,
  balance_remaining REAL NOT NULL,
  utilisation_pct   REAL NOT NULL,
  txn_count         INTEGER NOT NULL,
  idle_count        INTEGER NOT NULL,
  idle_amount       REAL NOT NULL,
  amt_general       REAL NOT NULL,
  amt_sc            REAL NOT NULL,
  amt_st            REAL NOT NULL,
  share_of_parent   REAL NOT NULL,
  rank              INTEGER NOT NULL,
  colour_slot       INTEGER NOT NULL,
  PRIMARY KEY (version_id, dim, member_key)
);

CREATE TABLE IF NOT EXISTS agg_totals (
  version_id             INTEGER PRIMARY KEY REFERENCES dim_version(version_id),
  net_amount             REAL NOT NULL,
  utilisation            REAL NOT NULL,
  balance_remaining      REAL NOT NULL,
  utilisation_pct        REAL NOT NULL,
  balance_pct            REAL NOT NULL,
  txn_count              INTEGER NOT NULL,
  amt_general            REAL NOT NULL,
  amt_sc                 REAL NOT NULL,
  amt_st                 REAL NOT NULL,
  idle_count             INTEGER NOT NULL,
  idle_amount            REAL NOT NULL,
  fully_utilised_count   INTEGER NOT NULL,
  fully_utilised_amount  REAL NOT NULL
);

-- ─── Intelligence layer, regenerated on publish (05 §2, §6) ─────────────────

CREATE TABLE IF NOT EXISTS version_health (
  version_id INTEGER PRIMARY KEY REFERENCES dim_version(version_id),
  score      REAL NOT NULL,
  band       TEXT NOT NULL,
  components TEXT NOT NULL           -- JSON: the explainable breakdown (FR-HS-02)
);

CREATE TABLE IF NOT EXISTS version_insight (
  id            TEXT NOT NULL,
  version_id    INTEGER NOT NULL REFERENCES dim_version(version_id),
  kind          TEXT NOT NULL,
  severity      TEXT NOT NULL,
  statement     TEXT NOT NULL,
  figure        REAL NOT NULL,
  figure_label  TEXT NOT NULL,
  entity        TEXT,
  materiality   REAL NOT NULL,
  drill         TEXT,                -- JSON DrillTarget
  PRIMARY KEY (version_id, id)
);

CREATE TABLE IF NOT EXISTS version_exception (
  id              TEXT NOT NULL,
  version_id      INTEGER NOT NULL REFERENCES dim_version(version_id),
  type            TEXT NOT NULL,
  rule_id         TEXT NOT NULL,
  severity        TEXT NOT NULL,
  amount          REAL NOT NULL,
  regional_centre TEXT,
  grantee         TEXT,
  sub_category    TEXT,
  age_days        INTEGER,
  reason          TEXT NOT NULL,
  transaction_ids TEXT NOT NULL,     -- JSON array
  PRIMARY KEY (version_id, id)
);
CREATE INDEX IF NOT EXISTS ix_exc_type ON version_exception(version_id, type);

-- ─── Validation (06) ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS validation_run (
  run_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES dim_version(version_id),
  ran_at     TEXT NOT NULL,
  passed     INTEGER NOT NULL,
  blockers   INTEGER NOT NULL,
  warnings   INTEGER NOT NULL,
  infos      INTEGER NOT NULL,
  report     TEXT NOT NULL           -- JSON ValidationReport
);
CREATE INDEX IF NOT EXISTS ix_val_version ON validation_run(version_id);

-- The workbook's own DATA QUALITY LOG, elevated to a live control (04.13).
CREATE TABLE IF NOT EXISTS data_quality_observation (
  id          INTEGER NOT NULL,
  version_id  INTEGER NOT NULL REFERENCES dim_version(version_id),
  sheet       TEXT NOT NULL,
  row_no      INTEGER NOT NULL,
  issue_type  TEXT NOT NULL,
  observation TEXT NOT NULL,
  severity    TEXT NOT NULL,
  rule_id     TEXT NOT NULL,
  PRIMARY KEY (version_id, id)
);

-- ─── Immutable audit trail (07 §7, NFR-8) ───────────────────────────────────
-- Write-once. No UPDATE or DELETE is ever issued against this table.

CREATE TABLE IF NOT EXISTS audit_event (
  event_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  actor_name  TEXT NOT NULL,
  actor_role  TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  version_id  INTEGER,
  entity      TEXT,
  summary     TEXT NOT NULL,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_time   ON audit_event(occurred_at);
CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_event(action);

-- ─── Settings & saved views ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,          -- JSON
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS saved_view (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES app_user(id),
  name       TEXT NOT NULL,
  page       TEXT NOT NULL,
  state      TEXT NOT NULL,          -- JSON: filter + drill state
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_saved_owner ON saved_view(owner_id);

-- Raw uploaded workbooks retained as immutable version evidence (07 §3.1).
CREATE TABLE IF NOT EXISTS upload_artifact (
  version_id  INTEGER PRIMARY KEY REFERENCES dim_version(version_id),
  filename    TEXT NOT NULL,
  checksum    TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  stored_path TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);
