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

-- ============================================================================
--  Per-user module access. A user with NO rows here can see every module —
--  that keeps every pre-existing login working exactly as before this table
--  arrived, so adding it is not a silent lockout. A row is written only when a
--  Super Admin actually decides something, and `allowed = 0` is that decision.
--
--  `module` is the dashboard's own view name (command, tracker, kigroups, mdsd,
--  rc, exceptions) so a grant maps 1:1 onto what the UI renders.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_module_access (
  user_id  TEXT NOT NULL,
  module   TEXT NOT NULL,
  allowed  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, module)
);

CREATE INDEX IF NOT EXISTS ix_user_module_access_user ON user_module_access(user_id);
