/**
 * Output Engine — Generator
 *
 * Generates deterministic output files from D1 database contents.
 * All output is in-memory; no filesystem operations.
 *
 * Output files generated:
 * - all.txt — all valid+active configs (protocol, then hash)
 * - {protocol}.txt — configs per protocol
 * - {operator}.txt — configs per operator (via occurrence/batch metadata)
 * - stats.json — machine-readable statistics
 * - README.md — human-readable project documentation
 *
 * Sorting rules (§17):
 * - Primary: protocol ASC
 * - Secondary: config_hash ASC
 * - This is deterministic and reproducible across runs.
 *
 * Operator membership rule (§16):
 * - A config appears in an operator's file if it has at least one
 *   occurrence linked to a batch with that operator.
 * - A config may appear in multiple operator files.
 * - The canonical config record is NEVER corrupted by operator metadata.
 * - Operator metadata belongs to the batch, not to the config.
 *
 * Inclusion rules (§17):
 * - Only configs where is_valid = 1 AND active = 1 appear in output.
 * - Invalid configs must never appear in public output.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { ConfigRow } from "../db/connection";
import { VALID_OPERATORS } from "../db/connection";
import {
  getActiveConfigs,
  getActiveConfigsByProtocol,
  getActiveConfigsByOperator,
  countConfigsByProtocol,
  countActiveConfigsByOperator,
} from "../db/configs";
import { countSources } from "../db/sources";
import { getSetting } from "../db/settings";
import { applyRemarkToConfigs } from "./remark";
import { countBatches } from "../db/batches";
import type { OutputStats } from "./types";
import { PROTOCOL_FILES, OPERATOR_FILES } from "./types";
import { generateStats } from "./stats";
import { generateReadme } from "./readme";

// ─── Core Generation Functions ─────────────────────────────

/**
 * Generate the content for all.txt.
 * Contains all valid, active configs, sorted deterministically.
 * Each line is the raw URI of one config.
 */
export async function generateAllTxt(db: D1Database): Promise<string> {
  const [configs, template] = await Promise.all([
    getActiveConfigs(db),
    getSetting(db, "remark_template"),
  ]);
  return configsToTxt(configs, template);
}

/**
 * Generate the content for a protocol-specific file.
 * Only includes valid, active configs matching the protocol.
 */
export async function generateProtocolTxt(
  db: D1Database,
  protocol: string
): Promise<string> {
  const [configs, template] = await Promise.all([
    getActiveConfigsByProtocol(db, protocol),
    getSetting(db, "remark_template"),
  ]);
  return configsToTxt(configs, template);
}

/**
 * Generate the content for an operator-specific file.
 * Includes valid, active configs that have at least one occurrence
 * in a batch with the given operator.
 *
 * Note: A config may appear in multiple operator files if it has
 * occurrences in batches with different operators.
 */
export async function generateOperatorTxt(
  db: D1Database,
  operator: string
): Promise<string> {
  const [configs, template] = await Promise.all([
    getActiveConfigsByOperator(db, operator),
    getSetting(db, "remark_template"),
  ]);
  return configsToTxt(configs, template);
}

// ─── Bulk Generation ───────────────────────────────────────

/**
 * Generate all output files and return them as a map.
 *
 * Files generated:
 * - all.txt
 * - {protocol}.txt for each supported protocol
 * - {operator}.txt for each supported operator
 * - stats.json
 * - README.md
 *
 * @returns OutputManifest — Map of filename → content
 */
export async function generateAllOutputs(
  db: D1Database
): Promise<Map<string, string>> {
  const manifest = new Map<string, string>();

  // ── all.txt ──
  const allContent = await generateAllTxt(db);
  manifest.set("all.txt", allContent);

  // ── Protocol files ──
  for (const protocol of PROTOCOL_FILES) {
    const content = await generateProtocolTxt(db, protocol);
    manifest.set(`${protocol}.txt`, content);
  }

  // ── Operator files ──
  for (const operator of OPERATOR_FILES) {
    const content = await generateOperatorTxt(db, operator);
    manifest.set(`${operator}.txt`, content);
  }

  // ── stats.json ──
  const stats = await generateStats(db);
  manifest.set("stats.json", JSON.stringify(stats, null, 2));

  // ── README.md ──
  const readme = await generateReadme(db, stats);
  manifest.set("README.md", readme);

  return manifest;
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Convert an array of ConfigRow objects to a deterministic .txt content.
 * Each line is the raw URI, one per line.
 * Sorting: protocol ASC, then config_hash ASC.
 * Trailing newline at end of file.
 */
export function configsToTxt(
  configs: ConfigRow[],
  remarkTemplate?: string | null
): string {
  // Already sorted by protocol, config_hash from the DB query.
  // When a remark template is configured, rewrite each URI's remark
  // (name) to our own channel name — stored configs are never touched.
  const lines = remarkTemplate
    ? applyRemarkToConfigs(configs, remarkTemplate)
    : configs.map((c) => c.raw);
  return lines.join("\n") + (configs.length > 0 ? "\n" : "");
}

/**
 * Get the list of operators that have at least one config.
 * Returns sorted operator names.
 */
export async function getPopulatedOperators(
  db: D1Database
): Promise<string[]> {
  const counts = await countActiveConfigsByOperator(db);
  return Object.keys(counts)
    .filter((op) => counts[op] > 0)
    .sort();
}

/**
 * Get the list of protocols that have at least one config.
 * Returns sorted protocol names.
 */
export async function getPopulatedProtocols(
  db: D1Database
): Promise<string[]> {
  const counts = await countConfigsByProtocol(db);
  return Object.keys(counts)
    .filter((p) => counts[p] > 0)
    .sort();
}
