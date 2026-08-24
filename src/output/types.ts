/**
 * Output Engine — Type Definitions
 *
 * Defines the types used across the output generation modules.
 * All output is in-memory; no filesystem operations.
 */

// ─── Output File ───────────────────────────────────────────

/** A single generated output file. */
export interface OutputFile {
  /** Filename (e.g., "all.txt", "stats.json"). */
  name: string;
  /** File content as a string. */
  content: string;
}

// ─── Output Manifest ───────────────────────────────────────

/** Map of filename → content for all generated output files. */
export type OutputManifest = Map<string, string>;

// ─── Stats ─────────────────────────────────────────────────

/** Machine-readable statistics structure for stats.json. */
export interface OutputStats {
  /** ISO timestamp when stats were generated. */
  generated_at: string;
  /** Total number of valid, active configurations. */
  total_active_valid: number;
  /** Count of configs by protocol. */
  protocols: Record<string, number>;
  /** Count of configs by operator (via occurrence/batch metadata). */
  operators: Record<string, number>;
  /** Number of trusted sources. */
  total_sources: number;
  /** Number of batches. */
  total_batches: number;
  /** List of protocols supported. */
  supported_protocols: string[];
  /** List of operators recognized. */
  supported_operators: string[];
}

// ─── Constants ─────────────────────────────────────────────

/** All protocols that have dedicated output files. */
export const PROTOCOL_FILES = [
  "vmess",
  "vless",
  "trojan",
  "shadowsocks",
  "hysteria",
  "hysteria2",
] as const;

/** All operators that have dedicated output files. */
export const OPERATOR_FILES = [
  "irancell",
  "mci",
  "rightel",
  "mokhaberat",
  "other",
  "unknown",
] as const;

/** Display names for protocols in output files. */
export const PROTOCOL_DISPLAY_NAMES: Record<string, string> = {
  vmess: "VMess",
  vless: "VLESS",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  hysteria: "Hysteria",
  hysteria2: "Hysteria2",
};

/** Display names for operators in output files. */
export const OPERATOR_DISPLAY_NAMES: Record<string, string> = {
  irancell: "🇮🇷 Irancell",
  mci: "📱 MCI",
  rightel: "📡 Rightel",
  mokhaberat: "☎️ Mokhaberat",
  other: "🌐 Other",
  unknown: "❓ Unknown",
};
