/**
 * D1 Database Connection Types and Helpers
 *
 * Centralizes type definitions for all database tables.
 * All queries in the project should use these types.
 */

// ─── Row Types ──────────────────────────────────────────────

export interface ConfigRow {
  id: number;
  protocol: string;
  raw: string;
  canonical: string;
  config_hash: string;
  normalized_uri: string | null;
  structured_data: string | null;
  is_valid: number;
  active: number;
  parser_version: string;
  first_seen: string;
  last_seen: string;
}

export interface OccurrenceRow {
  id: number;
  config_id: number;
  source_type: string;
  source_chat_id: number | null;
  source_message_id: number | null;
  batch_id: number | null;
  raw_at_occurrence: string | null;
  first_seen: string;
  last_seen: string;
}

export interface SourceRow {
  id: number;
  type: string;
  chat_id: number;
  title: string | null;
  username: string | null;
  enabled: number;
  trusted: number;
  created_at: string;
  updated_at: string;
}

export interface BatchRow {
  id: number;
  source_type: string;
  source_chat_id: number | null;
  source_message_id: number | null;
  update_id: number | null;
  name: string | null;
  description: string | null;
  operator: string;
  verification_status: string;
  verification_method: string;
  verified_by: number | null;
  verified_at: string | null;
  confidence: string;
  notes: string | null;
  total_extracted: number;
  valid_count: number;
  invalid_count: number;
  new_count: number;
  duplicate_count: number;
  created_at: string;
}

export interface CollectionRunRow {
  id: number;
  trigger_type: string;
  batch_id: number | null;
  update_id: number | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  configs_extracted: number;
  configs_valid: number;
  configs_new: number;
  configs_duplicate: number;
  error_message: string | null;
}

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface AdminStateRow {
  user_id: number;
  state: string;
  context: string | null;
  updated_at: string;
}

// ─── Input Types (for inserts/updates) ──────────────────────

export interface ConfigInsert {
  protocol: string;
  raw: string;
  canonical: string;
  config_hash: string;
  normalized_uri?: string;
  structured_data?: string;
  is_valid?: number;
  active?: number;
  parser_version?: string;
}

export interface OccurrenceInsert {
  config_id: number;
  source_type: string;
  source_chat_id?: number;
  source_message_id?: number;
  batch_id?: number;
  raw_at_occurrence?: string;
}

export interface SourceInsert {
  type?: string;
  chat_id: number;
  title?: string;
  username?: string;
  enabled?: number;
  trusted?: number;
}

export interface BatchInsert {
  source_type: string;
  source_chat_id?: number;
  source_message_id?: number;
  update_id?: number;
  name?: string;
  description?: string;
  operator?: string;
  verification_status?: string;
  verification_method?: string;
  verified_by?: number;
  verified_at?: string;
  confidence?: string;
  notes?: string;
}

export interface CollectionRunInsert {
  trigger_type: string;
  batch_id?: number;
  update_id?: number;
}

// ─── Operator Constants ─────────────────────────────────────

export const VALID_OPERATORS = [
  "irancell",
  "mci",
  "rightel",
  "wifi",
  "mokhaberat",
  "other",
  "unknown",
] as const;

export type Operator = (typeof VALID_OPERATORS)[number];

export function isValidOperator(value: string): value is Operator {
  return (VALID_OPERATORS as readonly string[]).includes(value);
}

// ─── Helper: now() ──────────────────────────────────────────

export function nowISO(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}
