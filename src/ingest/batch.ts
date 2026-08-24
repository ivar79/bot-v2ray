/**
 * Batch Lifecycle Management
 *
 * Handles the creation and lifecycle of ingestion batches.
 * A batch represents a single admin upload session with full metadata.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { insertBatch, getBatchById, updateBatchOperator } from "../db/batches";
import { startCollectionRun, completeCollectionRun, failCollectionRun } from "../db/collection-runs";
import { nowISO } from "../db/connection";
import type { PipelineResult } from "./pipeline";

// ─── Batch Creation ────────────────────────────────────────

/** Options for creating a new batch. */
export interface CreateBatchOptions {
  db: D1Database;
  sourceType: string;
  sourceChatId?: number;
  sourceMessageId?: number;
  updateId?: number;
  operator?: string;
  verifiedBy?: number;
}

/** Result of batch creation. */
export interface BatchCreationResult {
  batchId: number;
  collectionRunId: number;
}

/**
 * Create a new batch and start a collection run.
 * Returns the batch ID and collection run ID.
 */
export async function createBatch(
  options: CreateBatchOptions
): Promise<BatchCreationResult> {
  const {
    db,
    sourceType,
    sourceChatId,
    sourceMessageId,
    updateId,
    operator = "unknown",
    verifiedBy,
  } = options;

  // Create the batch
  const batch = await insertBatch(db, {
    source_type: sourceType,
    source_chat_id: sourceChatId,
    source_message_id: sourceMessageId,
    update_id: updateId,
    operator,
    verification_status: "admin_supplied",
    verification_method: "admin_upload",
    verified_by: verifiedBy,
    verified_at: nowISO(),
    confidence: "admin",
  });

  // Start a collection run
  const collectionRun = await startCollectionRun(db, {
    trigger_type: "admin_upload",
    batch_id: batch.id,
    update_id: updateId,
  });

  return {
    batchId: batch.id,
    collectionRunId: collectionRun.id,
  };
}

// ─── Batch Completion ──────────────────────────────────────

/**
 * Complete a collection run with pipeline results.
 */
export async function completeBatchRun(
  db: D1Database,
  collectionRunId: number,
  result: PipelineResult
): Promise<void> {
  await completeCollectionRun(db, collectionRunId, {
    configs_extracted: result.totalExtracted,
    configs_valid: result.validCount,
    configs_new: result.newCount,
    configs_duplicate: result.duplicateCount,
  });
}

/**
 * Mark a collection run as failed.
 */
export async function failBatchRun(
  db: D1Database,
  collectionRunId: number,
  errorMessage: string
): Promise<void> {
  await failCollectionRun(db, collectionRunId, errorMessage);
}

// ─── Batch Operator Update ─────────────────────────────────

/**
 * Update the operator metadata for a batch.
 * Used when the admin selects an operator after uploading configs.
 */
export async function setBatchOperator(
  db: D1Database,
  batchId: number,
  operator: string,
  verifiedBy?: number
): Promise<void> {
  await updateBatchOperator(db, batchId, {
    operator,
    verification_status: "admin_verified",
    verification_method: "admin_upload",
    verified_by: verifiedBy,
    verified_at: nowISO(),
    confidence: "admin",
  });
}
