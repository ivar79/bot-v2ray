/**
 * Output Engine — Config Card Formatter
 *
 * Formats a single ConfigRow into a Telegram-ready message card.
 * Used for publishing individual configs to channels with rich metadata.
 */

import type { ConfigRow } from "../db/connection";

// ─── Constants ─────────────────────────────────────────────

/** How old a config must be (hours) to be considered stale. */
export const STALENESS_THRESHOLD_HOURS = 72;

/** Max length for the config URI in the card (Telegram limit). */
const MAX_URI_DISPLAY = 3000;

// ─── Protocol Display Names ────────────────────────────────

const PROTOCOL_LABELS: Record<string, string> = {
  vmess: "VMess",
  vless: "VLESS",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  ss: "Shadowsocks",
  hysteria: "Hysteria",
  hysteria2: "Hysteria2",
};

// ─── Staleness Check ──────────────────────────────────────

export interface StalenessInfo {
  isStale: boolean;
  hoursSinceLastSeen: number;
  lastSeenISO: string;
}

/**
 * Check if a config is stale based on last_seen timestamp.
 * A config is stale if it has not been seen for more than STALENESS_THRESHOLD_HOURS.
 */
export function checkStaleness(config: ConfigRow, now?: Date): StalenessInfo {
  const nowMs = (now ?? new Date()).getTime();
  const lastSeenMs = new Date(config.last_seen).getTime();
  const diffMs = nowMs - lastSeenMs;
  const hoursSinceLastSeen = Math.round(diffMs / (1000 * 60 * 60));
  return {
    isStale: hoursSinceLastSeen > STALENESS_THRESHOLD_HOURS,
    hoursSinceLastSeen,
    lastSeenISO: config.last_seen,
  };
}

// ─── Card Formatting ──────────────────────────────────────

export interface ConfigCardOptions {
  /** Source channel name to display (e.g. @MyChannel). */
  sourceChannel?: string;
  /** Whether to include the raw config URI in the card. */
  includeRaw?: boolean;
  /** Whether to check and display staleness info. */
  checkStale?: boolean;
}

/**
 * Format a single config into a Telegram message card.
 *
 * Output format:
 * ━━━━━━━━━━━━━━━━
 * 🚀 Premium V2Ray Config
 *
 * 🌍 Location: 🇩🇪 Germany
 * 📡 Protocol: VLESS
 * ⚡ Status: Active
 *
 * ━━━━━━━━━━━━━━━━
 *
 * vless://xxxxx
 *
 * ━━━━━━━━━━━━━━━━
 * 📢 Source: @MyChannel
 */
export function formatConfigCard(config: ConfigRow, options: ConfigCardOptions = {}): string {
  const parts: string[] = [];
  const separator = "━━━━━━━━━━━━━━━━";

  // Header
  parts.push(separator);
  parts.push("🚀 Premium V2Ray Config");
  parts.push("");

  // Location
  const location = formatLocation(config);
  parts.push("🌍 " + location);

  // Protocol
  const protocolLabel = PROTOCOL_LABELS[config.protocol] ?? config.protocol.toUpperCase();
  parts.push("📡 Protocol: " + protocolLabel);

  // Status
  if (options.checkStale) {
    const stale = checkStaleness(config);
    if (stale.isStale) {
      parts.push("⚡ Status: ⚠️ Stale (" + stale.hoursSinceLastSeen + "h ago)");
    } else {
      parts.push("⚡ Status: ✅ Active");
    }
  } else {
    parts.push("⚡ Status: Active");
  }

  parts.push("");
  parts.push(separator);
  parts.push("");

  // Config URI
  const raw = config.raw.length > MAX_URI_DISPLAY
    ? config.raw.slice(0, MAX_URI_DISPLAY) + "..."
    : config.raw;
  parts.push(raw);

  parts.push("");
  parts.push(separator);

  // Source
  if (options.sourceChannel) {
    parts.push("📢 Source: " + options.sourceChannel);
  }

  return parts.join("\n");
}

/**
 * Format a batch of configs as a single multi-config message.
 * Used when publishing multiple configs at once.
 */
export function formatConfigBatchCard(
  configs: ConfigRow[],
  options: ConfigCardOptions = {}
): string {
  if (configs.length === 0) return "";
  if (configs.length === 1) return formatConfigCard(configs[0], options);

  const parts: string[] = [];
  const separator = "━━━━━━━━━━━━━━━━";

  // Header
  parts.push(separator);
  parts.push("🚀 Premium V2Ray Configs (" + configs.length + ")");
  parts.push(separator);
  parts.push("");

  for (let i = 0; i < configs.length; i++) {
    const c = configs[i];
    const protocolLabel = PROTOCOL_LABELS[c.protocol] ?? c.protocol.toUpperCase();
    const location = formatLocation(c);
    parts.push("🌍 " + location + " | 📡 " + protocolLabel);
    const raw = c.raw.length > MAX_URI_DISPLAY
      ? c.raw.slice(0, MAX_URI_DISPLAY) + "..."
      : c.raw;
    parts.push(raw);
    if (i < configs.length - 1) parts.push("");
  }

  parts.push("");
  parts.push(separator);
  if (options.sourceChannel) {
    parts.push("📢 Source: " + options.sourceChannel);
  }

  return parts.join("\n");
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Format location from ConfigRow location fields.
 * Returns a display string like "🇩🇪 Germany" or "🌍 Unknown".
 */
function formatLocation(config: ConfigRow): string {
  if (config.location_flag && config.location_country) {
    return config.location_flag + " " + config.location_country;
  }
  if (config.location_country) {
    return "🌍 " + config.location_country;
  }
  if (config.location_display) {
    return "🌍 " + config.location_display;
  }
  return "🌍 Unknown";
}
