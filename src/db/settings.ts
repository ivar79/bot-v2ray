/**
 * Settings Table — D1 CRUD Operations
 *
 * Key-value store for system configuration.
 * Keys are unique (PRIMARY KEY).
 *
 * Secrets (bot token, GitHub token, webhook secret) belong in
 * Cloudflare Secrets — never in this table.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { SettingRow } from "./connection";
import { nowISO } from "./connection";

// ─── Get/Set ────────────────────────────────────────────────

/**
 * Get a setting value by key. Returns null if not found.
 */
export async function getSetting(
  db: D1Database,
  key: string
): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/**
 * Get a setting as a parsed JSON object. Returns null if not found or not valid JSON.
 */
export async function getSettingJSON<T = unknown>(
  db: D1Database,
  key: string
): Promise<T | null> {
  const raw = await getSetting(db, key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Set (upsert) a setting value.
 * If the key already exists, the value is overwritten.
 */
export async function setSetting(
  db: D1Database,
  key: string,
  value: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`
    )
    .bind(key, value, nowISO(), value, nowISO())
    .run();
}

/**
 * Set a setting as a JSON-serialized value.
 */
export async function setSettingJSON(
  db: D1Database,
  key: string,
  value: unknown
): Promise<void> {
  await setSetting(db, key, JSON.stringify(value));
}

/**
 * Delete a setting by key.
 */
export async function deleteSetting(
  db: D1Database,
  key: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM settings WHERE key = ?")
    .bind(key)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

// ─── Queries ────────────────────────────────────────────────

/**
 * Get all settings as key-value pairs.
 */
export async function getAllSettings(db: D1Database): Promise<SettingRow[]> {
  const result = await db
    .prepare("SELECT * FROM settings ORDER BY key")
    .all<SettingRow>();
  return result.results ?? [];
}

/**
 * Check if a setting key exists.
 */
export async function settingExists(
  db: D1Database,
  key: string
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM settings WHERE key = ?")
    .bind(key)
    .first<{ "1": number }>();
  return row !== null;
}

/**
 * Count total settings.
 */
export async function countSettings(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM settings")
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}
