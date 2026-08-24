/**
 * Collection Runs Table — D1 CRUD Operations
 *
 * Audit trail for each pipeline execution.
 * Tracks the lifecycle: running → completed/error.
 * Records per-run aggregate statistics.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { CollectionRunRow, CollectionRunInsert } from "./connection";
import { nowISO } from "./connection";

// ─── Insert ─────────────────────────────────────────────────

/**
 * Start a new collection run. Returns the inserted row.
 */
export async function startCollectionRun(
  db: D1Database,
  data: CollectionRunInsert
): Promise<CollectionRunRow> {
  const result = await db
    .prepare(
      `INSERT INTO collection_runs (trigger_type, batch_id, update_id, status)
       VALUES (?, ?, ?, 'running')`
    )
    .bind(
      data.trigger_type,
      data.batch_id ?? null,
      data.update_id ?? null
    )
    .run();

  if (!result.success) {
    throw new Error(
      `Failed to insert collection run: ${JSON.stringify(result.error)}`
    );
  }

  const id = result.meta.last_row_id as number;
  const row = await getCollectionRunById(db, id);
  if (!row) {
    throw new Error(
      `Failed to retrieve inserted collection run with id ${id}`
    );
  }
  return row;
}

// ─── Lookup ─────────────────────────────────────────────────

/** Get collection run by primary key. */
export async function getCollectionRunById(
  db: D1Database,
  id: number
): Promise<CollectionRunRow | null> {
  const row = await db
    .prepare("SELECT * FROM collection_runs WHERE id = ?")
    .bind(id)
    .first<CollectionRunRow>();
  return row ?? null;
}

/** Get collection runs for a batch. */
export async function getCollectionRunsByBatchId(
  db: D1Database,
  batchId: number
): Promise<CollectionRunRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM collection_runs WHERE batch_id = ? ORDER BY started_at DESC"
    )
    .bind(batchId)
    .all<CollectionRunRow>();
  return result.results ?? [];
}

/** Get recent collection runs. */
export async function getRecentCollectionRuns(
  db: D1Database,
  limit: number = 10
): Promise<CollectionRunRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT ?"
    )
    .bind(limit)
    .all<CollectionRunRow>();
  return result.results ?? [];
}

// ─── Update ─────────────────────────────────────────────────

/**
 * Complete a collection run with final stats.
 * Transitions status from 'running' to 'completed'.
 */
export async function completeCollectionRun(
  db: D1Database,
  runId: number,
  stats: {
    configs_extracted: number;
    configs_valid: number;
    configs_new: number;
    configs_duplicate: number;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE collection_runs SET
         status = 'completed',
         completed_at = ?,
         configs_extracted = ?,
         configs_valid = ?,
         configs_new = ?,
         configs_duplicate = ?
       WHERE id = ?`
    )
    .bind(
      nowISO(),
      stats.configs_extracted,
      stats.configs_valid,
      stats.configs_new,
      stats.configs_duplicate,
      runId
    )
    .run();
}

/**
 * Mark a collection run as failed.
 */
export async function failCollectionRun(
  db: D1Database,
  runId: number,
  errorMessage: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE collection_runs SET
         status = 'error',
         completed_at = ?,
         error_message = ?
       WHERE id = ?`
    )
    .bind(nowISO(), errorMessage, runId)
    .run();
}

// ─── Queries ────────────────────────────────────────────────

/** Count total collection runs. */
export async function countCollectionRuns(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM collection_runs")
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/** Get the last completed collection run. */
export async function getLastCompletedRun(
  db: D1Database
): Promise<CollectionRunRow | null> {
  const row = await db
    .prepare(
      "SELECT * FROM collection_runs WHERE status = 'completed' ORDER BY completed_at DESC, id DESC LIMIT 1"
    )
    .first<CollectionRunRow>();
  return row ?? null;
}
