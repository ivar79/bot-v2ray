/**
 * Configs Table — D1 CRUD Operations
 *
 * Each row represents one canonical, deduplicated configuration.
 * config_hash is the UNIQUE dedup key.
 * Config identity (raw, canonical, config_hash, protocol) is immutable.
 */

import type {
  D1Database,
  D1Result,
} from "@cloudflare/workers-types";
import type { ConfigRow, ConfigInsert } from "./connection";
import { nowISO } from "./connection";

// ─── Insert ─────────────────────────────────────────────────

/**
 * Insert a new config. Returns the inserted row on success.
 * Throws if config_hash already exists (UNIQUE constraint).
 */
export async function insertConfig(
  db: D1Database,
  data: ConfigInsert
): Promise<ConfigRow> {
  const stmt = db.prepare(`
    INSERT INTO configs (protocol, raw, canonical, config_hash, normalized_uri, structured_data, is_valid, active, parser_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = await stmt
    .bind(
      data.protocol,
      data.raw,
      data.canonical,
      data.config_hash,
      data.normalized_uri ?? null,
      data.structured_data ?? null,
      data.is_valid ?? 1,
      data.active ?? 1,
      data.parser_version ?? "1.0"
    )
    .run();

  if (!result.success) {
    throw new Error(`Failed to insert config: ${JSON.stringify(result.error)}`);
  }

  const id = result.meta.last_row_id as number;
  const row = await getConfigById(db, id);
  if (!row) {
    throw new Error(`Failed to retrieve inserted config with id ${id}`);
  }
  return row;
}

// ─── Lookup ─────────────────────────────────────────────────

/** Get config by primary key. */
export async function getConfigById(
  db: D1Database,
  id: number
): Promise<ConfigRow | null> {
  const row = await db
    .prepare("SELECT * FROM configs WHERE id = ?")
    .bind(id)
    .first<ConfigRow>();
  return row ?? null;
}

/** Get config by canonical hash (the dedup key). */
export async function getConfigByHash(
  db: D1Database,
  configHash: string
): Promise<ConfigRow | null> {
  const row = await db
    .prepare("SELECT * FROM configs WHERE config_hash = ?")
    .bind(configHash)
    .first<ConfigRow>();
  return row ?? null;
}

/** Check if a config_hash already exists (fast boolean check). */
export async function configHashExists(
  db: D1Database,
  configHash: string
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM configs WHERE config_hash = ?")
    .bind(configHash)
    .first<{ "1": number }>();
  return row !== null;
}

// ─── Update ─────────────────────────────────────────────────

/** Update last_seen timestamp for a config. */
export async function touchConfig(
  db: D1Database,
  id: number
): Promise<void> {
  await db
    .prepare("UPDATE configs SET last_seen = ? WHERE id = ?")
    .bind(nowISO(), id)
    .run();
}

/** Deactivate a config (soft delete). */
export async function deactivateConfig(
  db: D1Database,
  id: number
): Promise<void> {
  await db
    .prepare("UPDATE configs SET active = 0 WHERE id = ?")
    .bind(id)
    .run();
}

/** Reactivate a config. */
export async function activateConfig(
  db: D1Database,
  id: number
): Promise<void> {
  await db
    .prepare("UPDATE configs SET active = 1 WHERE id = ?")
    .bind(id)
    .run();
}

// ─── Queries ────────────────────────────────────────────────

/** Get all valid, active configs. */
export async function getActiveConfigs(
  db: D1Database
): Promise<ConfigRow[]> {
  const result = await db
    .prepare("SELECT * FROM configs WHERE is_valid = 1 AND active = 1 ORDER BY protocol, config_hash")
    .all<ConfigRow>();
  return result.results ?? [];
}

/** Get all valid, active configs for a specific protocol. */
export async function getActiveConfigsByProtocol(
  db: D1Database,
  protocol: string
): Promise<ConfigRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM configs WHERE is_valid = 1 AND active = 1 AND protocol = ? ORDER BY config_hash"
    )
    .bind(protocol)
    .all<ConfigRow>();
  return result.results ?? [];
}

/** Count all configs. */
export async function countConfigs(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM configs")
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/** Count valid, active configs. */
export async function countActiveConfigs(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM configs WHERE is_valid = 1 AND active = 1")
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/** Count configs by protocol. */
export async function countConfigsByProtocol(
  db: D1Database
): Promise<Record<string, number>> {
  const result = await db
    .prepare(
      "SELECT protocol, COUNT(*) as cnt FROM configs WHERE is_valid = 1 AND active = 1 GROUP BY protocol"
    )
    .all<{ protocol: string; cnt: number }>();
  const counts: Record<string, number> = {};
  for (const row of result.results ?? []) {
    counts[row.protocol] = row.cnt;
  }
  return counts;
}

// ─── Operator Queries ──────────────────────────────────────

/**
 * Get all valid, active configs that have at least one occurrence
 * in a batch with the given operator.
 *
 * Operator membership is determined by batch metadata.
 * A config may appear in multiple operator files if it has
 * occurrences in batches with different operators.
 *
 * Sorting: protocol ASC, then config_hash ASC (deterministic).
 */
export async function getActiveConfigsByOperator(
  db: D1Database,
  operator: string
): Promise<ConfigRow[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT c.*
       FROM configs c
       JOIN occurrences o ON o.config_id = c.id
       JOIN batches b ON b.id = o.batch_id
       WHERE c.is_valid = 1 AND c.active = 1
         AND b.operator = ?
       ORDER BY c.protocol, c.config_hash`
    )
    .bind(operator)
    .all<ConfigRow>();
  return result.results ?? [];
}

/**
 * Count valid, active configs per operator.
 * Uses DISTINCT to avoid counting a config multiple times
 * within the same operator.
 */
export async function countActiveConfigsByOperator(
  db: D1Database
): Promise<Record<string, number>> {
  const result = await db
    .prepare(
      `SELECT b.operator, COUNT(DISTINCT c.id) as cnt
       FROM configs c
       JOIN occurrences o ON o.config_id = c.id
       JOIN batches b ON b.id = o.batch_id
       WHERE c.is_valid = 1 AND c.active = 1
       GROUP BY b.operator`
    )
    .all<{ operator: string; cnt: number }>();
  const counts: Record<string, number> = {};
  for (const row of result.results ?? []) {
    counts[row.operator] = row.cnt;
  }
  return counts;
}

/**
 * Count total distinct valid, active configs linked to any batch.
 */
export async function countActiveConfigsWithOccurrences(
  db: D1Database
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT c.id) as cnt
       FROM configs c
       JOIN occurrences o ON o.config_id = c.id
       WHERE c.is_valid = 1 AND c.active = 1`
    )
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}
