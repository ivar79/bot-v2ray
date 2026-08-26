/**
 * Processed Updates Table — D1 CRUD Operations
 *
 * Provides idempotency for Telegram webhook delivery.
 * If the same update_id is delivered twice, the second delivery
 * is detected and rejected.
 *
 * Primary key is the Telegram update_id (INTEGER).
 */

import type { D1Database } from "@cloudflare/workers-types";
import { nowISO } from "./connection";

// ─── Core Idempotency ───────────────────────────────────────

/**
 * Claim a processed update. Returns true if inserted successfully.
 * Returns false if the update was already claimed (duplicate).
 *
 * This is the primary idempotency mechanism. Call it BEFORE processing
 * the update: a Telegram retry that arrives while a long-running handler
 * (e.g. a manual subscription fetch) is still executing is then rejected
 * by the idempotency check instead of re-executed.
 */
export async function markUpdateProcessed(
  db: D1Database,
  updateId: number
): Promise<boolean> {
  try {
    const result = await db
      .prepare("INSERT INTO processed_updates (update_id) VALUES (?)")
      .bind(updateId)
      .run();
    return result.success;
  } catch {
    // UNIQUE constraint violation = already processed
    return false;
  }
}

/**
 * Check if a Telegram update has already been processed.
 */
export async function isUpdateProcessed(
  db: D1Database,
  updateId: number
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM processed_updates WHERE update_id = ?")
    .bind(updateId)
    .first<{ "1": number }>();
  return row !== null;
}

// ─── Cleanup ────────────────────────────────────────────────

/**
 * Remove processed update records older than a given age.
 * Useful for periodic cleanup to prevent unbounded table growth.
 *
 * @param olderThanDays - Delete records older than this many days.
 * @returns Number of rows deleted.
 */
export async function cleanupOldUpdates(
  db: D1Database,
  olderThanDays: number = 90
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM processed_updates
       WHERE processed_at < datetime('now', '-' || ? || ' days')`
    )
    .bind(olderThanDays)
    .run();
  return result.meta?.changes ?? 0;
}

// ─── Queries ────────────────────────────────────────────────

/**
 * Count total processed updates.
 */
export async function countProcessedUpdates(
  db: D1Database
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM processed_updates")
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}
