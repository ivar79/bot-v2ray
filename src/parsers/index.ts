/**
 * Parser Index — Routing, Text Extraction, and Unified Pipeline
 *
 * This module provides:
 * 1. parseRouter() — routes input to the correct protocol parser
 * 2. extractConfigs() — extracts config URIs from mixed text
 * 3. parseWithHash() — full async pipeline: extract → parse → hash
 * 4. Constants and re-exports
 */

import type { ParsedConfig, ProtocolParser } from "./base";
import { PARSER_VERSION, CANONICAL_VERSION } from "./base";
import { sha256hex } from "../utils/crypto";

import { VMessParser } from "./vmess";
import { VLESSParser } from "./vless";
import { TrojanParser } from "./trojan";
import { ShadowsocksParser } from "./shadowsocks";
import { HysteriaParser } from "./hysteria";
import { Hysteria2Parser } from "./hysteria2";

// ─── Re-exports ────────────────────────────────────────────

export { PARSER_VERSION, CANONICAL_VERSION } from "./base";
export type { ParsedConfig, ProtocolParser } from "./base";

export { VMessParser } from "./vmess";
export { VLESSParser } from "./vless";
export { TrojanParser } from "./trojan";
export { ShadowsocksParser } from "./shadowsocks";
export { HysteriaParser } from "./hysteria";
export { Hysteria2Parser } from "./hysteria2";

// ─── Parser Registry ───────────────────────────────────────

/** All registered parsers, in detection priority order. */
const PARSERS: ProtocolParser[] = [
  new VMessParser(),
  new VLESSParser(),
  new TrojanParser(),
  new ShadowsocksParser(),
  new Hysteria2Parser(),  // Must be before Hysteria (hy2/ hysteria2 overlap)
  new HysteriaParser(),
];

/** Map of scheme → parser for direct lookup. */
const SCHEME_MAP: Map<string, ProtocolParser> = new Map();
for (const parser of PARSERS) {
  for (const scheme of parser.schemes) {
    SCHEME_MAP.set(scheme, parser);
  }
}

// ─── Supported Schemes ─────────────────────────────────────

/** All supported URI schemes (lowercase, without "://"). */
export const SUPPORTED_SCHEMES: readonly string[] = [
  "vmess",
  "vless",
  "trojan",
  "ss",
  "hysteria",
  "hysteria2",
  "hy2",
];

// ─── Router ────────────────────────────────────────────────

/**
 * Route input to the correct protocol parser.
 * Returns null if no parser recognizes the input.
 *
 * Detection priority:
 * 1. Exact scheme match from SCHEME_MAP
 * 2. Each parser's detect() method in order
 */
export function parseRouter(input: string): ParsedConfig | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try scheme-based lookup first
  const schemeMatch = trimmed.match(/^([a-z0-9+.-]+):\/\//i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    const parser = SCHEME_MAP.get(scheme);
    if (parser) {
      return parser.parse(trimmed);
    }
  }

  // Fall back to detection order
  for (const parser of PARSERS) {
    if (parser.detect(trimmed)) {
      return parser.parse(trimmed);
    }
  }

  return null;
}

/**
 * Get the parser for a specific protocol.
 */
export function getParser(protocol: string): ProtocolParser | null {
  return SCHEME_MAP.get(protocol) ?? null;
}

// ─── Text Extraction ───────────────────────────────────────

/** Maximum input text size (1 MB). */
const MAX_TEXT_SIZE = 1_048_576;

/**
 * Supported URI scheme patterns for extraction.
 * Matches: vmess://, vless://, trojan://, ss://, hysteria://, hysteria2://, hy2://
 */
const URI_PATTERN =
  /(?:vmess|vless|trojan|ss|hysteria2|hy2|hysteria):\/\/[^\s<>"'`]+/gi;

/**
 * Extract configuration URIs from mixed text content.
 *
 * Handles:
 * - Multiple configs in one text
 * - Surrounding ordinary text, markdown, HTML
 * - Line breaks and whitespace
 * - Mixed content (text + configs)
 *
 * Returns deduplicated raw URIs in order of appearance.
 */
export function extractConfigs(text: string): string[] {
  if (!text || text.length > MAX_TEXT_SIZE) {
    return [];
  }

  const seen = new Set<string>();
  const results: string[] = [];

  // Find all URI-like strings
  const matches = text.match(URI_PATTERN);
  if (!matches) return [];

  for (const match of matches) {
    // Clean up trailing punctuation that's likely not part of the URI
    let cleaned = match;

    // Remove trailing characters that are unlikely to be part of a URI
    // (parentheses from markdown links, trailing periods, etc.)
    while (cleaned.length > 0 && /[),.;:!?\]]$/.test(cleaned)) {
      cleaned = cleaned.slice(0, -1);
    }

    // Must have something after the ://
    const afterScheme = cleaned.slice(cleaned.indexOf("://") + 3);
    if (!afterScheme) continue;

    // Deduplicate by normalized form (lowercase scheme)
    const normalized = cleaned.trim();
    const normalizedLower = normalized.toLowerCase();

    if (!seen.has(normalizedLower)) {
      seen.add(normalizedLower);
      results.push(normalized);
    }
  }

  return results;
}

// ─── Unified Pipeline ──────────────────────────────────────

/**
 * Full async pipeline: parse a config and compute its SHA-256 hash.
 * Returns an invalid result if parsing fails — never throws.
 */
export async function parseWithHash(input: string): Promise<ParsedConfig> {
  const result = parseRouter(input);

  if (!result) {
    return {
      protocol: "unknown",
      raw: input.trim(),
      canonical: "",
      configHash: "",
      isValid: false,
      parseError: "Unrecognized configuration format",
    };
  }

  if (!result.isValid) {
    return result;
  }

  // Compute SHA-256 hash of the canonical form
  const configHash = await sha256hex(result.canonical);
  return { ...result, configHash };
}

/**
 * Parse multiple config strings from text, returning all results.
 * Invalid entries still appear in results (with isValid: false).
 */
export async function parseAllFromText(
  text: string
): Promise<ParsedConfig[]> {
  const rawURIs = extractConfigs(text);
  const results: ParsedConfig[] = [];

  for (const uri of rawURIs) {
    const result = await parseWithHash(uri);
    results.push(result);
  }

  return results;
}

/**
 * Get supported protocol list for display.
 */
export function getSupportedProtocols(): string[] {
  return ["vmess", "vless", "trojan", "ss", "hysteria", "hysteria2"];
}
