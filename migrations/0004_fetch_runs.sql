-- MIGRATION 0004: Persistent manual fetch lifecycle
-- Keeps fetch cancellation independent from admin conversation state.

CREATE TABLE IF NOT EXISTS fetch_runs (
  flow_id       TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  chat_id       INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_fetch_runs_owner_status
  ON fetch_runs(user_id, chat_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fetch_runs_one_active_owner
  ON fetch_runs(user_id, chat_id) WHERE status = 'running';
