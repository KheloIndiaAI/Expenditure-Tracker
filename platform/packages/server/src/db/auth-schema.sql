-- ============================================================================
--  Auth-only store — portable DDL for BOTH SQLite (local dev) and
--  PostgreSQL / Amazon RDS (production). No engine-specific syntax here:
--  TEXT, DEFAULT '', and IF NOT EXISTS are supported by both. SQLite-only
--  PRAGMAs are applied by the driver, not in this file.
--
--  Scope: the platform's financial data is read LIVE from the Google Sheet by
--  the dashboard, so none of it is persisted. The only table is login identity.
--  Users sign in with a short username (e.g. RC_Kolkata), not an email.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_user (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  designation   TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_app_user_username ON app_user(username);
