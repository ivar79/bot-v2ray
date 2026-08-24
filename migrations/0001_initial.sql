-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 0001: Initial Schema
-- V2Ray Aggregator — Cloudflare D1
-- ═══════════════════════════════════════════════════════════════

-- ─── configs ─────────────────────────────────────────────────
-- One row per unique configuration (deduplicated by config_hash).
-- Immutable identity: raw, canonical, config_hash, protocol never change.
CREATE TABLE IF NOT EXISTS configs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  protocol        TEXT NOT NULL,
  raw             TEXT NOT NULL,
  canonical       TEXT NOT NULL,
  config_hash     TEXT NOT NULL UNIQUE,
  normalized_uri  TEXT,
  structured_data TEXT,
  is_valid        INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 1,
  parser_version  TEXT NOT NULL DEFAULT '1.0',
  first_seen      TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_configs_protocol ON configs(protocol);
CREATE INDEX IF NOT EXISTS idx_configs_hash ON configs(config_hash);
CREATE INDEX IF NOT EXISTS idx_configs_active_valid ON configs(active, is_valid);

-- ─── occurrences ─────────────────────────────────────────────
-- Links configs to batches. Preserves source traceability.
-- A config appearing in 3 batches = 3 occurrence rows, 1 canonical config.
CREATE TABLE IF NOT EXISTS occurrences (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id         INTEGER NOT NULL,
  source_type       TEXT NOT NULL,
  source_chat_id    INTEGER,
  source_message_id INTEGER,
  batch_id          INTEGER,
  raw_at_occurrence TEXT,
  first_seen        TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_occ_config ON occurrences(config_id);
CREATE INDEX IF NOT EXISTS idx_occ_batch ON occurrences(batch_id);
CREATE INDEX IF NOT EXISTS idx_occ_source ON occurrences(source_type, source_chat_id);

-- ─── sources ─────────────────────────────────────────────────
-- Trusted ingestion sources (channels where bot is admin).
CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL DEFAULT 'trusted_channel',
  chat_id     INTEGER NOT NULL UNIQUE,
  title       TEXT,
  username    TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  trusted     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── batches ─────────────────────────────────────────────────
-- Each ingestion session = one independent batch with full metadata.
-- Operator belongs to batch, not to config.
CREATE TABLE IF NOT EXISTS batches (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type          TEXT NOT NULL,
  source_chat_id       INTEGER,
  source_message_id    INTEGER,
  update_id            INTEGER,
  name                 TEXT,
  description          TEXT,
  operator             TEXT NOT NULL DEFAULT 'unknown',
  verification_status  TEXT NOT NULL DEFAULT 'admin_supplied',
  verification_method  TEXT NOT NULL DEFAULT 'admin_upload',
  verified_by          INTEGER,
  verified_at          TEXT,
  confidence           TEXT NOT NULL DEFAULT 'admin',
  notes                TEXT,
  total_extracted      INTEGER NOT NULL DEFAULT 0,
  valid_count          INTEGER NOT NULL DEFAULT 0,
  invalid_count        INTEGER NOT NULL DEFAULT 0,
  new_count            INTEGER NOT NULL DEFAULT 0,
  duplicate_count      INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_batches_operator ON batches(operator);
CREATE INDEX IF NOT EXISTS idx_batches_source ON batches(source_type, source_chat_id);

-- ─── collection_runs ─────────────────────────────────────────
-- Audit trail for each pipeline execution.
CREATE TABLE IF NOT EXISTS collection_runs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type       TEXT NOT NULL,
  batch_id           INTEGER,
  update_id          INTEGER,
  started_at         TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at       TEXT,
  status             TEXT NOT NULL DEFAULT 'running',
  configs_extracted  INTEGER NOT NULL DEFAULT 0,
  configs_valid      INTEGER NOT NULL DEFAULT 0,
  configs_new        INTEGER NOT NULL DEFAULT 0,
  configs_duplicate  INTEGER NOT NULL DEFAULT 0,
  error_message      TEXT
);

-- ─── processed_updates ───────────────────────────────────────
-- Idempotency for Telegram webhook delivery.
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id    INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── settings ────────────────────────────────────────────────
-- System configuration key-value store.
-- Secrets (bot token, GitHub token) are in Cloudflare Secrets, NOT here.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── admin_states ────────────────────────────────────────────
-- Conversation flow for multi-step admin interactions.
CREATE TABLE IF NOT EXISTS admin_states (
  user_id    INTEGER PRIMARY KEY,
  state      TEXT NOT NULL DEFAULT 'idle',
  context    TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
