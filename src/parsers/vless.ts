/**
 * VLESS Protocol Parser
 *
 * URI format: vless://uuid@host:port?parameters#remark
 *
 * Connection-identity fields: uuid, host, port, security params, transport params
 * Display-only: fragment (remark/name after #)
 *
 * Canonicalization:
 * - Parse URI components
 * - Remove fragment (display-only remark)
 * - Sort query parameters deterministically
 * - Normalize server to lowercase
 * - Produce canonical string: vless://uuid@host:port?sorted_params
 * - SHA-256 of that string
 */

import type { ProtocolParser, ParsedConfig } from "./base";
import { invalidResult, isValidPort, normalizeServer } from "./base";

/** Query parameters that are display-only / non-identity. */
const DISPLAY_PARAMS = new Set(["name", "remark", "tag"]);

/** Query parameters that affect connection identity. */
const IDENTITY_PARAMS = new Set([
  "security",    // tls, reality, none, etc.
  "type",        // tcp, kcp, ws, grpc, http
  "host",        // ws/http host
  "path",        // ws/grpc path
  "flow",        // xtls flow
  "sni",         // TLS SNI
  "fp",          // TLS fingerprint
  "pbk",         // reality public key
  "sid",         // reality short ID
  "spx",         // reality spx
  "alpn",        // ALPN protocols
  "encryption",  // encryption method (usually "none")
  "mode",        // grpc mode
  "serviceName", // grpc service name
  "headerType",  // header type
  "seed",        // kcp seed
]);

export class VLESSParser implements ProtocolParser {
  readonly protocol = "vless";
  readonly schemes = ["vless"];

  detect(input: string): boolean {
    return input.trim().toLowerCase().startsWith("vless://");
  }

  parse(input: string): ParsedConfig {
    const raw = input.trim();
    const body = raw.slice("vless://".length);

    if (!body) {
      return invalidResult("vless", raw, "Empty VLESS payload");
    }

    // Split off fragment (remark)
    const fragmentIdx = body.indexOf("#");
    const fragment = fragmentIdx >= 0 ? body.slice(fragmentIdx + 1) : "";
    const withoutFragment = fragmentIdx >= 0 ? body.slice(0, fragmentIdx) : body;

    // Split query string
    const queryIdx = withoutFragment.indexOf("?");
    const queryString = queryIdx >= 0 ? withoutFragment.slice(queryIdx + 1) : "";
    const authority = queryIdx >= 0 ? withoutFragment.slice(0, queryIdx) : withoutFragment;

    // Parse authority: uuid@host:port
    const atIdx = authority.indexOf("@");
    if (atIdx < 0) {
      return invalidResult("vless", raw, "Missing '@' separator (expected uuid@host:port)");
    }

    const uuid = authority.slice(0, atIdx);
    const hostPort = authority.slice(atIdx + 1);

    if (!uuid) {
      return invalidResult("vless", raw, "Empty UUID");
    }

    // Parse host:port — handle IPv6 [host]:port
    let host: string;
    let portStr: string;
    if (hostPort.startsWith("[")) {
      const closeBracket = hostPort.indexOf("]");
      if (closeBracket < 0) {
        return invalidResult("vless", raw, "Unclosed IPv6 bracket");
      }
      host = hostPort.slice(1, closeBracket);
      portStr = hostPort.slice(closeBracket + 1).replace(/^:/, "");
    } else {
      const lastColon = hostPort.lastIndexOf(":");
      if (lastColon < 0) {
        return invalidResult("vless", raw, "Missing port");
      }
      host = hostPort.slice(0, lastColon);
      portStr = hostPort.slice(lastColon + 1);
    }

    if (!host) {
      return invalidResult("vless", raw, "Empty server host");
    }

    const port = parseInt(portStr, 10);
    if (!isValidPort(port)) {
      return invalidResult("vless", raw, `Invalid port: ${portStr}`);
    }

    // Parse query parameters
    const params = parseQueryString(queryString);

    // Build canonical string
    const canonical = buildCanonical(uuid, host, port, params);

    return {
      protocol: "vless",
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
  uuid: string,
  host: string,
  port: number,
  params: Map<string, string>
): string {
  const server = host.toLowerCase().trim();

  // Filter out display-only params, sort remaining deterministically
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

  const base = `vless://${uuid.toLowerCase()}@${server}:${port}`;
  return queryString ? `${base}?${queryString}` : base;
}

// ─── Async Parse with Hash ─────────────────────────────────

import { sha256hex } from "../utils/crypto";

export async function parseVLESSWithHash(input: string): Promise<ParsedConfig> {
  const parser = new VLESSParser();
  const result = parser.parse(input);
  if (!result.isValid) return result;

  const configHash = await sha256hex(result.canonical);
  return { ...result, configHash };
}
