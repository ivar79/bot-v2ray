/**
 * Output Engine — README Generator
 *
 * Generates a public README.md file.
 *
 * Rules (§19):
 * - Project purpose
 * - Available protocols
 * - Generated files
 * - Operator categories
 * - Update timestamp
 * - Methodology
 *
 * MUST NOT claim "tested from Iran" unless there is an actual
 * verified Iranian testing system.
 *
 * MUST use wording such as:
 * "Operator classification is based on administrator-provided verification."
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { OutputStats } from "./types";
import { PROTOCOL_DISPLAY_NAMES, OPERATOR_DISPLAY_NAMES } from "./types";
import { countActiveConfigs } from "../db/configs";

// ─── README Generation ─────────────────────────────────────

/**
 * Generate the README.md content.
 * Uses pre-computed stats to avoid redundant DB queries.
 */
export async function generateReadme(
  db: D1Database,
  stats: OutputStats
): Promise<string> {
  const lines: string[] = [];

  // ── Title ──
  lines.push("# V2Ray Configuration Aggregator", "");

  // ── Description ──
  lines.push(
    "Automated aggregation and deduplication of V2Ray/Xray configurations from",
    "trusted Telegram channels and administrator uploads.",
    ""
  );

  // ── Update Timestamp ──
  lines.push(
    `**Last updated:** ${stats.generated_at}`,
    ""
  );

  // ── Statistics ──
  lines.push("## Statistics", "");
  lines.push(`- **Total active configurations:** ${stats.total_active_valid}`);
  lines.push(`- **Sources:** ${stats.total_sources}`);
  lines.push(`- **Ingestion batches:** ${stats.total_batches}`);
  lines.push("");

  // ── Supported Protocols ──
  lines.push("## Supported Protocols", "");
  lines.push(
    "| Protocol | Config File |",
    "| --- | --- |"
  );
  for (const proto of stats.supported_protocols) {
    const displayName = PROTOCOL_DISPLAY_NAMES[proto] ?? proto;
    const count = stats.protocols[proto] ?? 0;
    lines.push(`| ${displayName} | \`${proto}.txt\` (${count} configs) |`);
  }
  lines.push(`| **All** | \`all.txt\` (${stats.total_active_valid} configs) |`);
  lines.push("");

  // ── Operator Categories ──
  lines.push("## Operator Categories", "");
  lines.push(
    "Operator classification is based on administrator-provided verification.",
    "The system does not perform network connectivity testing.",
    ""
  );
  lines.push(
    "| Operator | Config File |",
    "| --- | --- |"
  );
  for (const op of stats.supported_operators) {
    const displayName = OPERATOR_DISPLAY_NAMES[op] ?? op;
    const count = stats.operators[op] ?? 0;
    lines.push(`| ${displayName} | \`${op}.txt\` (${count} configs) |`);
  }
  lines.push("");

  // ── Generated Files ──
  lines.push("## Generated Files", "");
  lines.push("| File | Description |");
  lines.push("| --- | --- |");
  lines.push(
    "| `all.txt` | All valid, active configurations |"
  );
  for (const proto of stats.supported_protocols) {
    const displayName = PROTOCOL_DISPLAY_NAMES[proto] ?? proto;
    lines.push(`| \`${proto}.txt\` | ${displayName} configurations only |`);
  }
  for (const op of stats.supported_operators) {
    const displayName = OPERATOR_DISPLAY_NAMES[op] ?? op;
    lines.push(
      `| \`${op}.txt\` | Configurations from ${displayName} batches |`
    );
  }
  lines.push("| `stats.json` | Machine-readable statistics |");
  lines.push("| `README.md` | This file |");
  lines.push("");

  // ── Methodology ──
  lines.push("## Methodology", "");
  lines.push(
    "- Configurations are collected from trusted Telegram channels and administrator uploads.",
    "- Each configuration is parsed, canonicalized, and deduplicated using SHA-256 hashing.",
    "- Source traceability is preserved: every configuration can be traced to its origin batch and source.",
    "- Operator metadata is provided by administrators during upload and is not inferred by the system.",
    "- Configurations are deterministic: the same input always produces the same output.",
    ""
  );

  // ── Sorting ──
  lines.push("## Sorting", "");
  lines.push(
    "Configurations are sorted deterministically:",
    "1. Primary: protocol (alphabetical)",
    "2. Secondary: configuration hash (alphabetical)",
    ""
  );

  // ── Disclaimer ──
  lines.push("## Disclaimer", "");
  lines.push(
    "This system is a configuration aggregator. It does not:",
    "- Test network connectivity from any location",
    "- Verify that configurations work from specific ISPs or countries",
    "- Claim compatibility with any specific network or provider",
    "",
    "Operator classification is based on administrator-provided verification.",
    "No automated testing or verification of configuration functionality is performed.",
    ""
  );

  return lines.join("\n");
}
