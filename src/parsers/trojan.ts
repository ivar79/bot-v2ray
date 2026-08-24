/**
 * Trojan Protocol Parser
 *
 * URI format: trojan://password@host:port?parameters#remark
 *
 * Connection-identity fields: password, host, port, security/transport params
 * Display-only: fragment (remark/name after #)
 *
 * Canonicalization:
 * - Parse URI components
 * - Remove fragment (display-only)
 * - Sort query parameters deterministically
 * - Normalize server to lowercase
 * - Produce canonical: trojan://password@host:port?sorted_params
 * - SHA-256 of that string
 */

import type { ProtocolParser, ParsedConfig } from "./base";
import { invalidResult, isValidPort, normalizeServer } from "./base";
import { sha256hex } from "../utils/crypto";

/** Query parameters that are display-only. */
const DISPLAY_PARAMS = new Set(["name", "remark", "tag"]);

/** Query parameters that affect connection identity. */
const IDENTITY_PARAMS = new Set([
  "security",    // tls, none
  "type",        // tcp, kcp, ws, grpc
  "host",        // ws host
  "path",        // ws/grpc path
  "sni",         // TLS SNI
  "fp",          // TLS fingerprint
  "alpn",        // ALPN
  "peer",        // legacy SNI (some Trojan implementations)
  "serviceName", // grpc service
  "headerType",  // header type
  "encryption",  // encryption (usually "none")
  "mode",        // grpc mode
  "allowInsecure", // skip-cert-verify
]);

export class TrojanParser implements ProtocolParser {
  readonly protocol = "trojan";
  readonly schemes = ["trojan"];

  detect(input: string): boolean {
    return input.trim().toLowerCase().startsWith("trojan://");
  }

  parse(input: string): ParsedConfig {
    const raw = input.trim();
    const body = raw.slice("trojan://".length);

    if (!body) {
      return invalidResult("trojan", raw, "Empty Trojan payload");
    }

    // Split off fragment (remark)
    const fragmentIdx = body.indexOf("#");
    const withoutFragment = fragmentIdx >= 0 ? body.slice(0, fragmentIdx) : body;

    // Split query string
    const queryIdx = withoutFragment.indexOf("?");
    const queryString = queryIdx >= 0 ? withoutFragment.slice(queryIdx + 1) : "";
    const authority = queryIdx >= 0 ? withoutFragment.slice(0, queryIdx) : withoutFragment;

    // Parse authority: password@host:port
    const atIdx = authority.indexOf("@");
    if (atIdx < 0) {
      return invalidResult("trojan", raw, "Missing '@' separator (expected password@host:port)");
    }

    const password = authority.slice(0, atIdx);
    const hostPort = authority.slice(atIdx + 1);

    if (!password) {
      return invalidResult("trojan", raw, "Empty password");
    }

    // Parse host:port — handle IPv6 [host]:port
    let host: string;
    let portStr: string;
    if (hostPort.startsWith("[")) {
      const closeBracket = hostPort.indexOf("]");
      if (closeBracket < 0) {
        return invalidResult("trojan", raw, "Unclosed IPv6 bracket");
      }
      host = hostPort.slice(1, closeBracket);
      portStr = hostPort.slice(closeBracket + 1).replace(/^:/, "");
    } else {
      const lastColon = hostPort.lastIndexOf(":");
      if (lastColon < 0) {
        return invalidResult("trojan", raw, "Missing port");
      }
      host = hostPort.slice(0, lastColon);
      portStr = hostPort.slice(lastColon + 1);
    }

    if (!host) {
      return invalidResult("trojan", raw, "Empty server host");
    }

    const port = parseInt(portStr, 10);
    if (!isValidPort(port)) {
      return invalidResult("trojan", raw, `Invalid port: ${portStr}`);
    }

    // Parse query parameters
    const params = parseQueryString(queryString);

    // Build canonical string
    const canonical = buildCanonical(password, host, port, params);

    return {
      protocol: "trojan",
      raw,
      canonical,
      configHash: "",
      isValid: true,
      server: normalizeServer(host),
      port,
    };
  }
}

// ─── Query String Parser ───────────────────────────────────

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

// ─── Canonical Form ────────────────────────────────────────

function buildCanonical(
  password: string,
  host: string,
  port: number,
  params: Map<string, string>
): string {
  const server = host.toLowerCase().trim();

  // Filter out display-only params, sort remaining
  const identityParams: Array<[string, string]> = [];
  for (const [key, value] of params) {
    if (!DISPLAY_PARAMS.has(key.toLowerCase())) {
      identityParams.push([key, value]);
    }
  }
  identityParams.sort((a, b) => a[0].localeCompare(b[0]));

  const queryString = identityParams
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const base = `trojan://${password}@${server}:${port}`;
  return queryString ? `${base}?${queryString}` : base;
}

// ─── Async Parse with Hash ─────────────────────────────────

export async function parseTrojanWithHash(input: string): Promise<ParsedConfig> {
  const parser = new TrojanParser();
  const result = parser.parse(input);
  if (!result.isValid) return result;

  const configHash = await sha256hex(result.canonical);
  return { ...result, configHash };
}
