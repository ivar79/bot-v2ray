-- Migration 0003: Add subscription columns to sources table
-- Supports URL-based subscription sources with health tracking

ALTER TABLE sources ADD COLUMN sub_url TEXT;
ALTER TABLE sources ADD COLUMN sub_type TEXT;
ALTER TABLE sources ADD COLUMN sub_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE sources ADD COLUMN auto_fetch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN fetch_interval_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE sources ADD COLUMN last_fetched_at TEXT;
ALTER TABLE sources ADD COLUMN last_fetch_status TEXT;
ALTER TABLE sources ADD COLUMN last_fetch_error TEXT;
ALTER TABLE sources ADD COLUMN last_config_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN total_fetches INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sources_sub ON sources(sub_url);
CREATE INDEX IF NOT EXISTS idx_sources_sub_status ON sources(sub_status);
