/**
 * Hysteria2 Protocol Parser
 *
 * URI formats:
 * - hysteria2://auth@host:port?params#remark
 * - hy2://auth@host:port?params#remark
 *
 * Both schemes map to the same protocol identity when parameters match.
 *
 * Hysteria2-specific parameters:
 * - auth (in userinfo or auth query param)
 * - obfs / obfs-password / obfs-type
 * - sni
 * - insecure (skip cert verify)
 * - pinSHA256
 * - mbbps / upmbps / downmbps (bandwidth — affects connection)
 *
 * Canonicalization:
 * - Remove fragment (display-only)
 * - Sort query parameters
 * - Normalize server
 * - Use "hysteria2" as canonical protocol name (both schemes normalize)
 * - Produce canonical: hysteria2://auth@host:port?sorted_params
 * - SHA-256
 */

import type { ProtocolParser, ParsedConfig } from "./base";
import { invalidResult, isValidPort, normalizeServer } from "./base";
import { sha256hex } from "../utils/crypto";

/** Display-only parameters. */
const DISPLAY_PARAMS = new Set(["name", "remark", "tag"]);

/**
 * Hysteria2 parser handles both hysteria2:// and hy2:// schemes.
 * Both normalize to the "hysteria2" protocol identity.
 */
export class Hysteria2Parser implements ProtocolParser {
  readonly protocol = "hysteria2";
  readonly schemes = ["hysteria2", "hy2"];

  detect(input: string): boolean {
    const lower = input.trim().toLowerCase();
    return lower.startsWith("hysteria2://") || lower.startsWith("hy2://");
  }

  parse(input: string): ParsedConfig {
    const raw = input.trim();
    const lower = raw.toLowerCase();

    // Determine which scheme was used
    let body: string;
    if (lower.startsWith("hysteria2://")) {
      body = raw.slice("hysteria2://".length);
    } else if (lower.startsWith("hy2://")) {
      body = raw.slice("hy2://".length);
    } else {
      return invalidResult("hysteria2", raw, "Invalid Hysteria2 scheme");
    }

    if (!body) {
      return invalidResult("hysteria2", raw, "Empty Hysteria2 payload");
    }

    // Split off fragment (remark)
    const fragmentIdx = body.indexOf("#");
    const withoutFragment = fragmentIdx >= 0 ? body.slice(0, fragmentIdx) : body;

    // Split query string
    const queryIdx = withoutFragment.indexOf("?");
    const queryString = queryIdx >= 0 ? withoutFragment.slice(queryIdx + 1) : "";
    const authority = queryIdx >= 0 ? withoutFragment.slice(0, queryIdx) : withoutFragment;

    // Parse authority: auth@host:port
    const atIdx = authority.indexOf("@");
    let auth: string;
    let hostPort: string;

    if (atIdx >= 0) {
      auth = authority.slice(0, atIdx);
      hostPort = authority.slice(atIdx + 1);
    } else {
      // No userinfo auth — check for auth= query param
      auth = "";
      hostPort = authority;
    }

    // Parse host:port — handle IPv6 [host]:port
    let host: string;
    let portStr: string;
    if (hostPort.startsWith("[")) {
      const closeBracket = hostPort.indexOf("]");
      if (closeBracket < 0) {
        return invalidResult("hysteria2", raw, "Unclosed IPv6 bracket");
      }
      host = hostPort.slice(1, closeBracket);
      portStr = hostPort.slice(closeBracket + 1).replace(/^:/, "");
    } else {
      const lastColon = hostPort.lastIndexOf(":");
      if (lastColon < 0) {
        return invalidResult("hysteria2", raw, "Missing port");
      }
      host = hostPort.slice(0, lastColon);
      portStr = hostPort.slice(lastColon + 1);
    }

    if (!host) {
      return invalidResult("hysteria2", raw, "Empty server host");
    }

    const port = parseInt(portStr, 10);
    if (!isValidPort(port)) {
      return invalidResult("hysteria2", raw, `Invalid port: ${portStr}`);
    }

    // Parse query parameters
    const params = parseQueryString(queryString);

    // If auth is empty but params has "auth", use that
    if (!auth && params.has("auth")) {
      auth = params.get("auth")!;
    }

    // Build canonical string
    const canonical = buildCanonical(auth, host, port, params);

    return {
      protocol: "hysteria2",
      raw,
      canonical,
      configHash: "",
      isValid: true,
      server: normalizeServer(host),
      port,
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────

function parseQueryString(qs: string): Map<string, string> {
  const params = new Map<string, string>();
  if (!qs) return params;

  for (const pair of qs.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx >= 0) {
      const key = decodeURIComponent(pair.slice(0, eqIdx));
      const value = decodeURIComponent(pair.slice(eqIdx + 1));
      params.set(key, value);
    } else if (pair) {
      params.set(decodeURIComponent(pair), "");
    }
  }
  return params;
}

function buildCanonical(
  auth: string,
  host: string,
  port: number,
  params: Map<string, string>
): string {
  const server = host.toLowerCase().trim();

  // Filter display-only params, sort remaining
  const identityParams: Array<[string, string]> = [];
  for (const [key, value] of params) {
    if (!DISPLAY_PARAMS.has(key.toLowerCase()) && key !== "auth") {
      identityParams.push([key, value]);
    }
  }
  identityParams.sort((a, b) => a[0].localeCompare(b[0]));

  const queryString = identityParams
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  // Canonical scheme is always "hysteria2" regardless of input scheme
  const base = `hysteria2://${auth}@${server}:${port}`;
  return queryString ? `${base}?${queryString}` : base;
}

// ─── Async Parse with Hash ─────────────────────────────────

export async function parseHysteria2WithHash(
  input: string
): Promise<ParsedConfig> {
  const parser = new Hysteria2Parser();
  const result = parser.parse(input);
  if (!result.isValid) return result;

  const configHash = await sha256hex(result.canonical);
  return { ...result, configHash };
}
