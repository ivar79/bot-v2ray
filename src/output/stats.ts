/**
 * Output Engine — Stats Generator
 *
 * Generates machine-readable statistics for stats.json.
 *
 * Structure (§18):
 * {
 *   "generated_at": "...",
 *   "total_active_valid": 0,
 *   "protocols": {},
 *   "operators": {},
 *   "sources": {},
 *   "batches": {}
 * }
 *
 * Security: Private Telegram IDs are NOT exposed in stats output.
 * The stats contain aggregate counts only, not individual IDs.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { OutputStats } from "./types";
import { PROTOCOL_FILES, OPERATOR_FILES } from "./types";
import {
  countActiveConfigs,
  countConfigsByProtocol,
  countActiveConfigsByOperator,
} from "../db/configs";
import { countSources } from "../db/sources";
import { countBatches } from "../db/batches";

// ─── Stats Generation ──────────────────────────────────────

/**
 * Generate the complete stats object.
 * All values are aggregate counts; no private IDs are exposed.
 */
export async function generateStats(db: D1Database): Promise<OutputStats> {
  const [
    totalActiveValid,
    protocols,
    operators,
    totalSources,
    totalBatches,
  ] = await Promise.all([
    countActiveConfigs(db),
    countConfigsByProtocol(db),
    countActiveConfigsByOperator(db),
    countSources(db),
    countBatches(db),
  ]);

  return {
    generated_at: new Date().toISOString(),
    total_active_valid: totalActiveValid,
    protocols,
    operators,
    total_sources: totalSources,
    total_batches: totalBatches,
    supported_protocols: [...PROTOCOL_FILES],
    supported_operators: [...OPERATOR_FILES],
  };
}
