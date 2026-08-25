/**
 * VMess Protocol Parser
 *
 * Supports:
 * - VMess V1/V2 JSON-based format: vmess://base64(json)
 * - Canonicalizes by removing display-only fields (ps)
 * - Deterministically sorts JSON keys
 * - SHA-256 of canonical representation
 *
 * Canonicalization rules:
 * - Decode base64 payload
 * - Parse JSON
 * - Remove "ps" (display name / remark)
 * - Sort all remaining keys deterministically
 * - Produce canonical JSON string
 * - SHA-256 of that string
 */

import type { ProtocolParser, ParsedConfig } from "./base";
import { detectLocation } from "../utils/location";
import { PARSER_VERSION, CANONICAL_VERSION, invalidResult, isValidPort } from "./base";
import { decodeBase64 } from "../utils/base64";
import { sha256hex } from "../utils/crypto";

// ─── VMess JSON Schema ─────────────────────────────────────

/** Known VMess connection-identity fields that affect the connection. */
const IDENTITY_FIELDS = new Set([
  "v",      // version
  "add",    // server address
  "port",   // server port
  "id",     // user UUID
  "aid",    // alterId
  "net",    // network type
  "type",   // header type
  "host",   // host (for ws/http/h2)
  "path",   // path (for ws/http/h2)
  "tls",    // TLS setting
  "sni",    // TLS SNI
  "alpn",   // ALPN protocols
  "fp",     // TLS fingerprint
  "scy",    // security method
]);

/** Fields that are display-only and should be removed for canonicalization. */
const DISPLAY_ONLY_FIELDS = new Set(["ps"]);

/**
 * Known fields we recognize but do NOT discard.
 * If a field is unknown, we preserve it (conservative approach).
 */
const KNOWN_FIELDS = new Set([
  ...IDENTITY_FIELDS,
  ...DISPLAY_ONLY_FIELDS,
  "skip-cert-verify",  // connection behavior
  "tag",              // display (same as ps)
]);

// ─── Parser ────────────────────────────────────────────────

export class VMessParser implements ProtocolParser {
  readonly protocol = "vmess";
  readonly schemes = ["vmess"];

  detect(input: string): boolean {
    return input.trim().toLowerCase().startsWith("vmess://");
  }

  parse(input: string): ParsedConfig {
    const raw = input.trim();
    const payload = raw.slice("vmess://".length);

    if (!payload) {
      return invalidResult("vmess", raw, "Empty VMess payload");
    }

    // Decode base64
    const jsonStr = decodeBase64(payload);
    if (jsonStr === null) {
      return invalidResult("vmess", raw, "Invalid base64 encoding");
    }

    // Parse JSON
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      return invalidResult("vmess", raw, "Invalid JSON in VMess payload");
    }

    if (typeof obj !== "object" || obj === null) {
      return invalidResult("vmess", raw, "VMess payload is not a JSON object");
    }

    // Validate required fields
    if (typeof obj.id !== "string" || !obj.id) {
      return invalidResult("vmess", raw, "Missing or invalid 'id' (UUID) field");
    }
    if (typeof obj.add !== "string" || !obj.add) {
      return invalidResult("vmess", raw, "Missing or invalid 'add' (server) field");
    }
    if (obj.port === undefined || obj.port === null) {
      return invalidResult("vmess", raw, "Missing 'port' field");
    }

    const port = typeof obj.port === "number" ? obj.port : parseInt(String(obj.port), 10);
    if (!isValidPort(port)) {
      return invalidResult("vmess", raw, `Invalid port: ${obj.port}`);
    }

    // Build canonical object: remove display-only fields, sort keys
    const canonical = buildCanonical(obj);

    // Compute hash
    // We use a sync approach here since sha256hex is async.
    // The parse method is sync, so we compute hash separately.
    // Actually, let's make parse async-friendly by returning the canonical
    // and letting the caller hash. But per the interface, parse is sync.
    // Solution: we embed the hash computation inline using a cached approach.
    // For the actual hash, we'll use a synchronous-ish wrapper.
    const canonicalStr = JSON.stringify(canonical);

    const fragment = typeof obj.ps === "string" ? obj.ps : "";
    const location = detectLocation(fragment, String(obj.add));

    return {
      protocol: "vmess",
      raw,
      canonical: canonicalStr,
      configHash: "",  // Caller must compute hash of canonical
      isValid: true,
      server: String(obj.add).toLowerCase(),
      port,
      fragment: fragment || undefined,
      location,
    };
  }
}

// ─── Canonicalization ──────────────────────────────────────

/**
 * Build a canonical VMess object by:
 * 1. Removing display-only fields (ps, tag)
 * 2. Normalizing values (lowercase strings for identity)
 * 3. Sorting keys deterministically
 */
function buildCanonical(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip display-only fields
    if (DISPLAY_ONLY_FIELDS.has(key) || key === "tag") {
      continue;
    }

    // Normalize known identity fields
    if (key === "add" && typeof value === "string") {
      result[key] = value.toLowerCase().trim();
    } else if (key === "id" && typeof value === "string") {
      result[key] = value.toLowerCase().trim();
    } else if (key === "host" && typeof value === "string") {
      result[key] = value.toLowerCase().trim();
    } else if (key === "sni" && typeof value === "string") {
      result[key] = value.toLowerCase().trim();
    } else if (key === "net" && typeof value === "string") {
      result[key] = value.toLowerCase().trim();
    } else if (key === "tls" && typeof value === "string") {
      result[key] = value.toLowerCase().trim();
    } else if (key === "type" && typeof value === "string") {
      result[key] = value.toLowerCase().trim();
    } else if (key === "path" && typeof value === "string") {
      result[key] = value.trim();
    } else if (key === "scy" && typeof value === "string") {
      result[key] = value.toLowerCase().trim();
    } else if (key === "fp" && typeof value === "string") {
      result[key] = value.toLowerCase().trim();
    } else if (key === "alpn" && typeof value === "string") {
      result[key] = value.toLowerCase().trim();
    } else {
      result[key] = value;
    }
  }

  // Sort keys deterministically and rebuild object
  const sorted: Record<string, unknown> = {};
  const sortedKeys = Object.keys(result).sort();
  for (const key of sortedKeys) {
    sorted[key] = result[key];
  }

  return sorted;
}

// ─── Async Parse with Hash ─────────────────────────────────

/**
 * Parse a VMess config and compute its SHA-256 hash.
 * This is the preferred entry point for production use.
 */
export async function parseVMessWithHash(input: string): Promise<ParsedConfig> {
  const parser = new VMessParser();
  const result = parser.parse(input);

  if (!result.isValid) {
    return result;
  }

  const configHash = await sha256hex(result.canonical);
  return { ...result, configHash };
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Compute canonical JSON for a VMess config (exported for testing).
 */
export function canonicalizeVMess(input: string): string | null {
  const parser = new VMessParser();
  const result = parser.parse(input);
  if (!result.isValid) return null;
  return result.canonical;
}
