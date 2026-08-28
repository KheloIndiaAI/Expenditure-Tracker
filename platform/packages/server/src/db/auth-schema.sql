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

-- `regional_centre` names the centre whose vouchers this login may comment on,
-- and is empty for everyone who belongs to none. It is an explicit column and
-- not a rule read off the username: `RC_Kolkata` is a naming convention that
-- nothing enforces, usernames are stored lower-cased, and one of the thirteen
-- centres ("DDO HQ") contains a space the username charset forbids. An
-- authorisation boundary parsed out of a display string at request time is a
-- boundary that fails on a typo, so this is stored, shown in Administration,
-- and changeable there.
CREATE TABLE IF NOT EXISTS app_user (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL,
  designation     TEXT NOT NULL DEFAULT '',
  regional_centre TEXT NOT NULL DEFAULT '',
  password_hash   TEXT NOT NULL,
  created_at      TEXT NOT NULL
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

-- ============================================================================
--  Sign-in history — who reached the platform, when, and from where.
--
--  Refusals are recorded as well as successes. A log of successes alone answers
--  "who was here"; only the refusals answer "who tried and could not", which is
--  the question that matters when an account is being probed or a colleague
--  cannot get in. `outcome` is one of:
--    success  — signed in
--    failed   — wrong username or password
--    blocked  — correct password, but the account is deactivated
--    logout   — signed out
--
--  `username` is stored as typed, in lower case, and is the only identifier for
--  a `failed` attempt against a username that does not exist — hence NOT NULL
--  here while `user_id` may be empty. Names and roles are NOT copied in: they
--  are joined from app_user when the log is read, so the list shows people as
--  they are currently known rather than under a name since changed.
--
--  Append-only by intent. Nothing in the application updates or deletes a row.
-- ============================================================================
CREATE TABLE IF NOT EXISTS login_event (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL,
  outcome  TEXT NOT NULL,
  ip       TEXT NOT NULL DEFAULT '',
  at       TEXT NOT NULL
);

-- The log is read newest-first and filtered by person; both are indexed.
CREATE INDEX IF NOT EXISTS ix_login_event_at ON login_event(at);
CREATE INDEX IF NOT EXISTS ix_login_event_user ON login_event(user_id);

-- ============================================================================
--  Voucher comments — a Regional Centre's note to HQ about one release.
--
--  `tx_key` is `CENTRE|VOUCHER`, the same identity the change log uses (txKey in
--  the dashboard). It deliberately carries no amount: a comment must survive the
--  figures moving, and the balance reaching nil is what FREEZES a comment, never
--  what orphans it. One row per voucher — a comment is edited in place, not
--  threaded — so tx_key is the primary key.
--
--  `centre` is stored rather than parsed back out of the key, so the check that
--  decides who may write reads a column instead of a substring.
--
--  `locked` is a latch, set when the balance is reported nil and never cleared.
--  Honest scope: the server holds no financial data — the dashboard reads the
--  sheet in the browser — so the balance arrives as a client claim and the
--  freeze is enforced in the UI. This column makes it durable once observed; it
--  is not, and cannot be, a server-verified fact. What IS enforced server-side
--  is who may write: see canComment() in comments.ts.
-- ============================================================================
CREATE TABLE IF NOT EXISTS transaction_comment (
  tx_key      TEXT PRIMARY KEY,
  centre      TEXT NOT NULL,
  voucher     TEXT NOT NULL,
  body        TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  locked      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Read path is always "every comment for one centre".
CREATE INDEX IF NOT EXISTS ix_txn_comment_centre ON transaction_comment(centre);
