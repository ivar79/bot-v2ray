/**
 * Batches Table — D1 CRUD Operations
 *
 * Each ingestion session = one independent batch with full metadata.
 * Operator metadata belongs to the batch, not to the config.
 * Batch records also hold per-batch aggregate stats.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { BatchRow, BatchInsert } from "./connection";
import { nowISO } from "./connection";

// ─── Insert ─────────────────────────────────────────────────

/**
 * Create a new batch. Returns the inserted row.
 */
export async function insertBatch(
  db: D1Database,
  data: BatchInsert
): Promise<BatchRow> {
  const result = await db
    .prepare(
      `INSERT INTO batches
        (source_type, source_chat_id, source_message_id, update_id,
         name, description, operator, verification_status, verification_method,
         verified_by, verified_at, confidence, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.source_type,
      data.source_chat_id ?? null,
      data.source_message_id ?? null,
      data.update_id ?? null,
      data.name ?? null,
      data.description ?? null,
      data.operator ?? "unknown",
      data.verification_status ?? "admin_supplied",
      data.verification_method ?? "admin_upload",
      data.verified_by ?? null,
      data.verified_at ?? null,
      data.confidence ?? "admin",
      data.notes ?? null
    )
    .run();

  if (!result.success) {
    throw new Error(`Failed to insert batch: ${JSON.stringify(result.error)}`);
  }

  const id = result.meta.last_row_id as number;
  const row = await getBatchById(db, id);
  if (!row) {
    throw new Error(`Failed to retrieve inserted batch with id ${id}`);
  }
  return row;
}

// ─── Lookup ─────────────────────────────────────────────────

/** Get batch by primary key. */
export async function getBatchById(
  db: D1Database,
  id: number
): Promise<BatchRow | null> {
  const row = await db
    .prepare("SELECT * FROM batches WHERE id = ?")
    .bind(id)
    .first<BatchRow>();
  return row ?? null;
}

/** Get all batches for a specific source. */
export async function getBatchesBySource(
  db: D1Database,
  sourceType: string,
  sourceChatId: number
): Promise<BatchRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM batches WHERE source_type = ? AND source_chat_id = ? ORDER BY created_at DESC"
    )
    .bind(sourceType, sourceChatId)
    .all<BatchRow>();
  return result.results ?? [];
}

/** Get batch by update_id (for idempotency lookup). */
export async function getBatchByUpdateId(
  db: D1Database,
  updateId: number
): Promise<BatchRow | null> {
  const row = await db
    .prepare("SELECT * FROM batches WHERE update_id = ?")
    .bind(updateId)
    .first<BatchRow>();
  return row ?? null;
}

/** Get all batches (most recent first). */
export async function getAllBatches(db: D1Database): Promise<BatchRow[]> {
  const result = await db
    .prepare("SELECT * FROM batches ORDER BY created_at DESC")
    .all<BatchRow>();
  return result.results ?? [];
}

// ─── Update ─────────────────────────────────────────────────

/**
 * Update aggregate stats for a batch after processing.
 * Called when the ingestion pipeline finishes extracting configs.
 */
export async function updateBatchStats(
  db: D1Database,
  batchId: number,
  stats: {
    total_extracted: number;
    valid_count: number;
    invalid_count: number;
    new_count: number;
    duplicate_count: number;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE batches SET
         total_extracted = ?,
         valid_count = ?,
         invalid_count = ?,
         new_count = ?,
         duplicate_count = ?
       WHERE id = ?`
    )
    .bind(
      stats.total_extracted,
      stats.valid_count,
      stats.invalid_count,
      stats.new_count,
      stats.duplicate_count,
      batchId
    )
    .run();
}

/**
 * Update batch operator metadata.
 */
export async function updateBatchOperator(
  db: D1Database,
  batchId: number,
  operatorMeta: {
    operator?: string;
    verification_status?: string;
    verification_method?: string;
    verified_by?: number;
    verified_at?: string;
    confidence?: string;
    notes?: string;
  }
): Promise<BatchRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (operatorMeta.operator !== undefined) {
    sets.push("operator = ?");
    values.push(operatorMeta.operator);
  }
  if (operatorMeta.verification_status !== undefined) {
    sets.push("verification_status = ?");
    values.push(operatorMeta.verification_status);
  }
  if (operatorMeta.verification_method !== undefined) {
    sets.push("verification_method = ?");
    values.push(operatorMeta.verification_method);
  }
  if (operatorMeta.verified_by !== undefined) {
    sets.push("verified_by = ?");
    values.push(operatorMeta.verified_by);
  }
  if (operatorMeta.verified_at !== undefined) {
    sets.push("verified_at = ?");
    values.push(operatorMeta.verified_at);
  }
  if (operatorMeta.confidence !== undefined) {
    sets.push("confidence = ?");
    values.push(operatorMeta.confidence);
  }
  if (operatorMeta.notes !== undefined) {
    sets.push("notes = ?");
    values.push(operatorMeta.notes);
  }

  if (sets.length === 0) {
    return getBatchById(db, batchId);
  }

  values.push(batchId);
  await db
    .prepare(`UPDATE batches SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  return getBatchById(db, batchId);
}

// ─── Queries ────────────────────────────────────────────────

/** Count total batches. */
export async function countBatches(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM batches")
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/** Count batches by operator. */
export async function countBatchesByOperator(
  db: D1Database
): Promise<Record<string, number>> {
  const result = await db
    .prepare(
      "SELECT operator, COUNT(*) as cnt FROM batches GROUP BY operator"
    )
    .all<{ operator: string; cnt: number }>();
  const counts: Record<string, number> = {};
  for (const row of result.results ?? []) {
    counts[row.operator] = row.cnt;
  }
  return counts;
}
