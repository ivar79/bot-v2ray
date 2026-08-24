/**
 * Shadowsocks Protocol Parser
 *
 * Supports two formats:
 *
 * 1. SIP002 URI: ss://base64(method:password)@host:port#remark
 *    Or: ss://base64(method:password@host:port)#remark
 *
 * 2. SIP002 with OTP-style: ss://base64(method:password)@host:port?params#remark
 *
 * 3. Legacy format: ss://base64(method:password:hostname:port)
 *    (less common, preserved for compatibility)
 *
 * Canonicalization:
 * - Parse method, password, host, port
 * - Normalize method to standard names
 * - Produce canonical: ss://method:password@host:port
 * - SHA-256 of that string
 */

import type { ProtocolParser, ParsedConfig } from "./base";
import { invalidResult, isValidPort, normalizeServer } from "./base";
import { decodeBase64 } from "../utils/base64";
import { sha256hex } from "../utils/crypto";

/** Known Shadowsocks AEAD methods (lowercase). */
const KNOWN_METHODS = new Set([
  "aes-128-gcm",
  "aes-192-gcm",
  "aes-256-gcm",
  "aes-128-cfb",
  "aes-192-cfb",
  "aes-256-cfb",
  "aes-128-ctr",
  "aes-192-ctr",
  "aes-256-ctr",
  "aes-128-ofb",
  "aes-192-ofb",
  "aes-256-ofb",
  "rc4-md5",
  "chacha20-ietf",
  "chacha20-ietf-poly1305",
  "xchacha20-ietf-poly1305",
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
]);

export class ShadowsocksParser implements ProtocolParser {
  readonly protocol = "ss";
  readonly schemes = ["ss"];

  detect(input: string): boolean {
    return input.trim().toLowerCase().startsWith("ss://");
  }

  parse(input: string): ParsedConfig {
    const raw = input.trim();
    const body = raw.slice("ss://".length);

    if (!body) {
      return invalidResult("ss", raw, "Empty Shadowsocks payload");
    }

    // Split off fragment (remark)
    const fragmentIdx = body.indexOf("#");
    const withoutFragment = fragmentIdx >= 0 ? body.slice(0, fragmentIdx) : body;

    // Try SIP002 format first: base64part@host:port?params
    const sip002Result = tryParseSIP002(withoutFragment, raw);
    if (sip002Result) return sip002Result;

    // Try SIP002 alternate: base64part (decodes to method:password@host:port)
    const sip002AltResult = tryParseSIP002Alt(body, withoutFragment, raw);
    if (sip002AltResult) return sip002AltResult;

    // Try legacy format
    const legacyResult = tryParseLegacy(withoutFragment, raw);
    if (legacyResult) return legacyResult;

    return invalidResult("ss", raw, "Unrecognized Shadowsocks format");
  }
}

// ─── SIP002 Format ─────────────────────────────────────────

/**
 * SIP002: ss://base64(method:password)@host:port?params
 */
function tryParseSIP002(
  withoutFragment: string,
  raw: string
): ParsedConfig | null {
  const atIdx = withoutFragment.indexOf("@");
  if (atIdx < 0) return null;

  const b64Part = withoutFragment.slice(0, atIdx);
  const hostPort = withoutFragment.slice(atIdx + 1);

  // The base64 part decodes to method:password
  const decoded = decodeBase64(b64Part);
  if (decoded === null) return null;

  const colonIdx = decoded.indexOf(":");
  if (colonIdx < 0) return null;

  const method = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  if (!method || !password) return null;

  // Parse host:port
  const { host, port, portStr } = parseHostPort(hostPort);
  if (host === null) return null;
  if (port === null || !isValidPort(port)) {
    return invalidResult("ss", raw, `Invalid port: ${portStr}`);
  }

  const canonical = buildCanonical(method, password, host, port);

  return {
    protocol: "ss",
    raw,
    canonical,
    configHash: "",
    isValid: true,
    server: normalizeServer(host),
    port,
  };
}

/**
 * SIP002 alternate: base64(method:password@host:port)
 * Entire payload after ss:// is base64-encoded.
 */
function tryParseSIP002Alt(
  body: string,
  _withoutFragment: string,
  raw: string
): ParsedConfig | null {
  // Check if the body (before #) decodes cleanly
  const decoded = decodeBase64(body);
  if (decoded === null) return null;

  // Decoded should be: method:password@host:port
  const atIdx = decoded.indexOf("@");
  if (atIdx < 0) return null;

  const methodPassword = decoded.slice(0, atIdx);
  const hostPort = decoded.slice(atIdx + 1);

  const colonIdx = methodPassword.indexOf(":");
  if (colonIdx < 0) return null;

  const method = methodPassword.slice(0, colonIdx);
  const password = methodPassword.slice(colonIdx + 1);

  if (!method || !password) return null;

  const { host, port, portStr } = parseHostPort(hostPort);
  if (host === null) return null;
  if (port === null || !isValidPort(port)) {
    return invalidResult("ss", raw, `Invalid port: ${portStr}`);
  }

  const canonical = buildCanonical(method, password, host, port);

  return {
    protocol: "ss",
    raw,
    canonical,
    configHash: "",
    isValid: true,
    server: normalizeServer(host),
    port,
  };
}

// ─── Legacy Format ─────────────────────────────────────────

/**
 * Legacy: base64(method:password:hostname:port)
 */
function tryParseLegacy(
  withoutFragment: string,
  raw: string
): ParsedConfig | null {
  const decoded = decodeBase64(withoutFragment);
  if (decoded === null) return null;

  const parts = decoded.split(":");
  if (parts.length < 4) return null;

  const method = parts[0];
  // Password may contain colons (rare but possible), so take method, then
  // everything except last two parts is password, last two are host:port
  const port = parseInt(parts[parts.length - 1], 10);
  const host = parts[parts.length - 2];
  const password = parts.slice(1, parts.length - 2).join(":");

  if (!method || !password || !host || !isValidPort(port)) {
    return null;
  }

  const canonical = buildCanonical(method, password, host, port);

  return {
    protocol: "ss",
    raw,
    canonical,
    configHash: "",
    isValid: true,
    server: normalizeServer(host),
    port,
  };
}

// ─── Helpers ───────────────────────────────────────────────

function parseHostPort(hostPort: string): {
  host: string | null;
  port: number | null;
  portStr: string;
} {
  // Handle IPv6 [host]:port
  if (hostPort.startsWith("[")) {
    const closeBracket = hostPort.indexOf("]");
    if (closeBracket < 0) {
      return { host: null, port: null, portStr: "" };
    }
    const host = hostPort.slice(1, closeBracket);
    const portStr = hostPort.slice(closeBracket + 1).replace(/^:/, "");
    const port = parseInt(portStr, 10);
    return { host, port, portStr };
  }

  const lastColon = hostPort.lastIndexOf(":");
  if (lastColon < 0) {
    return { host: null, port: null, portStr: "" };
  }
  const host = hostPort.slice(0, lastColon);
  const portStr = hostPort.slice(lastColon + 1);
  const port = parseInt(portStr, 10);
  return { host, port, portStr };
}

function buildCanonical(
  method: string,
  password: string,
  host: string,
  port: number
): string {
  return `ss://${method.toLowerCase()}:${password}@${host.toLowerCase()}:${port}`;
}

// ─── Async Parse with Hash ─────────────────────────────────

export async function parseShadowsocksWithHash(
  input: string
): Promise<ParsedConfig> {
  const parser = new ShadowsocksParser();
  const result = parser.parse(input);
  if (!result.isValid) return result;

  const configHash = await sha256hex(result.canonical);
  return { ...result, configHash };
}
