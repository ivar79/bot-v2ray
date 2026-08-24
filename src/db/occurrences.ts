/**
 * Occurrences Table — D1 CRUD Operations
 *
 * Each occurrence links a config to a batch/source, preserving source traceability.
 * A config appearing in 3 batches = 3 occurrence rows, 1 canonical config.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { OccurrenceRow, OccurrenceInsert } from "./connection";
import { nowISO } from "./connection";

// ─── Insert ─────────────────────────────────────────────────

/** Create a new occurrence linking a config to a batch/source. */
export async function insertOccurrence(
  db: D1Database,
  data: OccurrenceInsert
): Promise<OccurrenceRow> {
  const stmt = db.prepare(`
    INSERT INTO occurrences (config_id, source_type, source_chat_id, source_message_id, batch_id, raw_at_occurrence)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = await stmt
    .bind(
      data.config_id,
      data.source_type,
      data.source_chat_id ?? null,
      data.source_message_id ?? null,
      data.batch_id ?? null,
      data.raw_at_occurrence ?? null
    )
    .run();

  if (!result.success) {
    throw new Error(`Failed to insert occurrence: ${JSON.stringify(result.error)}`);
  }

  const id = result.meta.last_row_id as number;
  const row = await getOccurrenceById(db, id);
  if (!row) {
    throw new Error(`Failed to retrieve inserted occurrence with id ${id}`);
  }
  return row;
}

// ─── Lookup ─────────────────────────────────────────────────

/** Get occurrence by primary key. */
export async function getOccurrenceById(
  db: D1Database,
  id: number
): Promise<OccurrenceRow | null> {
  const row = await db
    .prepare("SELECT * FROM occurrences WHERE id = ?")
    .bind(id)
    .first<OccurrenceRow>();
  return row ?? null;
}

/** Get all occurrences for a given config. */
export async function getOccurrencesByConfigId(
  db: D1Database,
  configId: number
): Promise<OccurrenceRow[]> {
  const result = await db
    .prepare("SELECT * FROM occurrences WHERE config_id = ? ORDER BY first_seen")
    .bind(configId)
    .all<OccurrenceRow>();
  return result.results ?? [];
}

/** Get all occurrences for a given batch. */
export async function getOccurrencesByBatchId(
  db: D1Database,
  batchId: number
): Promise<OccurrenceRow[]> {
  const result = await db
    .prepare("SELECT * FROM occurrences WHERE batch_id = ? ORDER BY first_seen")
    .bind(batchId)
    .all<OccurrenceRow>();
  return result.results ?? [];
}

// ─── Update ─────────────────────────────────────────────────

/** Touch (update last_seen) for an occurrence. */
export async function touchOccurrence(
  db: D1Database,
  id: number
): Promise<void> {
  await db
    .prepare("UPDATE occurrences SET last_seen = ? WHERE id = ?")
    .bind(nowISO(), id)
    .run();
}

// ─── Queries ────────────────────────────────────────────────

/** Count occurrences for a config. */
export async function countOccurrencesByConfigId(
  db: D1Database,
  configId: number
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM occurrences WHERE config_id = ?")
    .bind(configId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/** Count total occurrences. */
export async function countOccurrences(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM occurrences")
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}
