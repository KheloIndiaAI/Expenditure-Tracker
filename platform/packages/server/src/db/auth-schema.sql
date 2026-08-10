-- ============================================================================
--  Auth-only store.
--
--  Scope decision: the platform's financial data is read LIVE from the Google
--  Sheet by the dashboard (client-side), so none of it is persisted here. The
--  only thing this database holds is the custom-login identity table. If/when
--  the full published-store model is adopted, swap this file for schema.sql.
--
--  Uses node:sqlite (zero native dependencies). Plain SQL — ports to Postgres
--  by changing TEXT timestamps to TIMESTAMPTZ.
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_user (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  designation   TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_app_user_email ON app_user(email);
