/**
 * Ingestion Pipeline
 *
 * Core pipeline that:
 * 1. Extracts config URIs from text
 * 2. Parses each config
 * 3. Deduplicates by config_hash
 * 4. Stores new configs + occurrences in D1
 * 5. Returns detailed batch statistics
 *
 * This pipeline is shared between admin uploads (Phase 5)
 * and trusted channel ingestion (Phase 6).
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { ParsedConfig } from "../parsers/base";
import { parseAllFromText } from "../parsers";
import { insertConfig, configHashExists, touchConfig } from "../db/configs";
import { insertOccurrence } from "../db/occurrences";
import { updateBatchStats } from "../db/batches";

// ─── Types ─────────────────────────────────────────────────

/** Result of processing a single config in the pipeline. */
export interface ProcessedConfig {
  /** The raw input URI. */
  raw: string;
  /** The parsed result (valid or invalid). */
  parsed: ParsedConfig;
  /** Whether this config was new (not a duplicate). */
  isNew: boolean;
  /** The config row ID if stored, null if duplicate or invalid. */
  configId: number | null;
}

/** Aggregate statistics for a batch processing run. */
export interface PipelineResult {
  /** All processed configs (including invalid and duplicates). */
  configs: ProcessedConfig[];
  /** Total number of configs extracted from text. */
  totalExtracted: number;
  /** Number of successfully parsed configs. */
  validCount: number;
  /** Number of configs that failed parsing. */
  invalidCount: number;
  /** Number of new configs stored in D1. */
  newCount: number;
  /** Number of duplicate configs (already existed). */
  duplicateCount: number;
  /** Batch ID in the database. */
  batchId: number;
}

/** Options for the pipeline run. */
export interface PipelineOptions {
  /** Database instance. */
  db: D1Database;
  /** Batch ID to link occurrences to. */
  batchId: number;
  /** Source type for occurrence tracking. */
  sourceType: string;
  /** Source chat ID for occurrence tracking. */
  sourceChatId?: number;
  /** Source message ID for occurrence tracking. */
  sourceMessageId?: number;
}

// ─── Maximum Input Size ────────────────────────────────────

/** Maximum text size to process (1 MB). */
const MAX_PROCESS_SIZE = 1_048_576;

// ─── Pipeline ──────────────────────────────────────────────

/**
 * Run the full ingestion pipeline on a text input.
 *
 * Steps:
 * 1. Parse all configs from text (extract + parse + hash)
 * 2. For each valid config:
 *    a. Check if config_hash already exists in D1
 *    b. If new: insert config, insert occurrence, increment newCount
 *    c. If duplicate: touch config's last_seen, insert occurrence, increment duplicateCount
 * 3. Update batch stats in D1
 * 4. Return full pipeline result
 *
 * Error handling:
 * - Individual config errors do NOT abort the batch
 * - Each config is processed independently
 * - All errors are captured in the result
 */
export async function runPipeline(
  text: string,
  options: PipelineOptions
): Promise<PipelineResult> {
  const { db, batchId, sourceType, sourceChatId, sourceMessageId } = options;

  // Validate input size
  if (!text || text.length > MAX_PROCESS_SIZE) {
    return {
      configs: [],
      totalExtracted: 0,
      validCount: 0,
      invalidCount: 0,
      newCount: 0,
      duplicateCount: 0,
      batchId,
    };
  }

  // Step 1: Extract and parse all configs from text
  const parsedConfigs = await parseAllFromText(text);

  const processedConfigs: ProcessedConfig[] = [];
  let newCount = 0;
  let duplicateCount = 0;
  let validCount = 0;
  let invalidCount = 0;

  // Step 2: Process each config independently
  for (const parsed of parsedConfigs) {
    if (!parsed.isValid) {
      invalidCount++;
      processedConfigs.push({
        raw: parsed.raw,
        parsed,
        isNew: false,
        configId: null,
      });
      continue;
    }

    validCount++;

    try {
      // Check for duplicate by config_hash
      const exists = await configHashExists(db, parsed.configHash);

      if (exists) {
        // Duplicate — touch last_seen and record occurrence
        duplicateCount++;

        // We need to get the config_id for the occurrence
        // Use a query that returns the ID
        const existingConfig = await db
          .prepare("SELECT id FROM configs WHERE config_hash = ?")
          .bind(parsed.configHash)
          .first<{ id: number }>();

        if (existingConfig) {
          await touchConfig(db, existingConfig.id);
          await insertOccurrence(db, {
            config_id: existingConfig.id,
            source_type: sourceType,
            source_chat_id: sourceChatId,
            source_message_id: sourceMessageId,
            batch_id: batchId,
            raw_at_occurrence: parsed.raw,
          });
        }

        processedConfigs.push({
          raw: parsed.raw,
          parsed,
          isNew: false,
          configId: existingConfig?.id ?? null,
        });
      } else {
        // New config — insert and record occurrence
        newCount++;
        const configRow = await insertConfig(db, {
          protocol: parsed.protocol,
          raw: parsed.raw,
          canonical: parsed.canonical,
          config_hash: parsed.configHash,
          normalized_uri: parsed.normalizedUri,
        });

        await insertOccurrence(db, {
          config_id: configRow.id,
          source_type: sourceType,
          source_chat_id: sourceChatId,
          source_message_id: sourceMessageId,
          batch_id: batchId,
          raw_at_occurrence: parsed.raw,
        });

        processedConfigs.push({
          raw: parsed.raw,
          parsed,
          isNew: true,
          configId: configRow.id,
        });
      }
    } catch {
      // Individual config error — count as invalid, continue processing
      invalidCount++;
      processedConfigs.push({
        raw: parsed.raw,
        parsed: {
          ...parsed,
          isValid: false,
          parseError: "Storage error",
        },
        isNew: false,
        configId: null,
      });
    }
  }

  // Step 3: Update batch stats
  await updateBatchStats(db, batchId, {
    total_extracted: parsedConfigs.length,
    valid_count: validCount,
    invalid_count: invalidCount,
    new_count: newCount,
    duplicate_count: duplicateCount,
  });

  return {
    configs: processedConfigs,
    totalExtracted: parsedConfigs.length,
    validCount,
    invalidCount,
    newCount,
    duplicateCount,
    batchId,
  };
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Format a pipeline result as a human-readable summary for Telegram.
 */
export function formatPipelineSummary(result: PipelineResult): string {
  return [
    "✅ <b>Batch processed</b>",
    "",
    `Total extracted: ${result.totalExtracted}`,
    `Valid: ${result.validCount}`,
    `Invalid: ${result.invalidCount}`,
    `New: ${result.newCount}`,
    `Duplicate: ${result.duplicateCount}`,
    "",
    `Batch ID: #${result.batchId}`,
  ].join("\n");
}
