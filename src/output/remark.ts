/**
 * Config Remark Rewriter
 *
 * Rewrites the display name (remark) of config URIs to the operator's
 * own channel name, optionally enriched with location metadata.
 *
 * Design rules:
 * - Applied ONLY at output/send time — the stored canonical config,
 *   config_hash and dedup logic are never touched.
 * - vmess: rewrite the "ps" field inside the base64 JSON payload.
 * - All other protocols: replace the URI fragment (#remark).
 *
 * Template placeholders:
 *   {location} — flag + country (e.g. "🇩🇪 Germany")
 *   {flag}     — flag emoji only
 *   {country}  — country name only
 *   {protocol} — protocol name
 */

import type { ConfigRow } from "../db/connection";
import { utf8ToBase64, tryDecodeBase64 } from "../utils/base64";

/** Default remark when no template is configured. */
export const DEFAULT_REMARK_TEMPLATE = "Premium Config";

/** Setting key for the remark template. */
export const REMARK_TEMPLATE_SETTING = "remark_template";

// ─── Template Expansion ────────────────────────────────────

/**
 * Expand a remark template for a config row.
 * Falls back to DEFAULT_REMARK_TEMPLATE when template is empty.
 */
export function buildRemark(template: string | null | undefined, config: ConfigRow): string {
  const tpl = template && template.trim() ? template.trim() : DEFAULT_REMARK_TEMPLATE;

  const flag = config.location_flag || "🌍";
  const country = config.location_country || "Unknown";
  const location = config.location_display || flag + " " + country;
  const protocol = config.protocol.toUpperCase();

  return tpl
    .replace(/\{location\}/g, location)
    .replace(/\{flag\}/g, flag)
    .replace(/\{country\}/g, country)
    .replace(/\{protocol\}/g, protocol);
}

// ─── URI Rewriting ─────────────────────────────────────────

/**
 * Apply a new remark to a single raw config URI.
 * Returns the original URI unchanged if rewriting is not possible.
 */
export function applyRemarkToUri(raw: string, remark: string): string {
  if (!raw || !remark) return raw;

  const schemeEnd = raw.indexOf("://");
  if (schemeEnd < 0) return raw;
  const scheme = raw.slice(0, schemeEnd).toLowerCase();

  if (scheme === "vmess") {
    return rewriteVmessRemark(raw, remark);
  }

  // All other protocols: replace everything after '#'
  const hashIdx = raw.indexOf("#");
  const base = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  return base + "#" + encodeRemark(remark);
}

/**
 * Percent-encode a remark for safe use in a URI fragment.
 * Keeps readable characters (letters, digits, unreserved marks, emoji).
 */
function encodeRemark(remark: string): string {
  try {
    return encodeURIComponent(remark);
  } catch {
    return remark.replace(/[\s#?]/g, "_");
  }
}

/**
 * Rewrite the "ps" (remark) field of a vmess base64-JSON URI.
 * If the payload cannot be decoded, returns the original URI.
 */
function rewriteVmessRemark(raw: string, remark: string): string {
  const payload = raw.slice(raw.indexOf("://") + 3);
  const decoded = tryDecodeBase64(payload);
  if (decoded === null) return raw;

  try {
    const obj = JSON.parse(decoded) as Record<string, unknown>;
    if (typeof obj !== "object" || obj === null) return raw;
    obj.ps = remark;
    return raw.slice(0, raw.indexOf("://") + 3) + utf8ToBase64(JSON.stringify(obj));
  } catch {
    return raw;
  }
}

// ─── Batch Helpers ─────────────────────────────────────────

/**
 * Apply the remark template to a config row's raw URI.
 */
export function applyRemarkToConfig(config: ConfigRow, template: string | null | undefined): string {
  return applyRemarkToUri(config.raw, buildRemark(template, config));
}

/**
 * Apply the remark template to many configs.
 * Returns an array of rewritten URI strings (same order).
 */
export function applyRemarkToConfigs(configs: ConfigRow[], template: string | null | undefined): string[] {
  return configs.map((c) => applyRemarkToConfig(c, template));
}
