-- Migration 0002: Add location columns to configs table
-- Stores detected geographic location from config fragments/hostnames

ALTER TABLE configs ADD COLUMN location_country TEXT;
ALTER TABLE configs ADD COLUMN location_country_code TEXT;
ALTER TABLE configs ADD COLUMN location_flag TEXT;
ALTER TABLE configs ADD COLUMN location_display TEXT;

CREATE INDEX IF NOT EXISTS idx_configs_country ON configs(location_country_code);
