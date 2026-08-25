/**
 * Hysteria v1 Protocol Parser
 *
 * URI format: hysteria://auth@host:port?params#remark
 *
 * Hysteria 1 uses:
 * - Auth token (string)
 * - obfs parameter
 * - obfs-type parameter
 * - sni parameter
 * - peer parameter (legacy SNI alias)
 * - insecure parameter (skip cert verify)
 * - upmbps/downmbps (bandwidth, may affect connection behavior)
 *
 * Canonicalization:
 * - Remove fragment (display-only)
 * - Sort query parameters
 * - Normalize server
 * - Produce canonical: hysteria://auth@host:port?sorted_params
 * - SHA-256
 */

import type { ProtocolParser, ParsedConfig } from "./base";
import { detectLocation } from "../utils/location";
import { invalidResult, isValidPort, normalizeServer } from "./base";
import { sha256hex } from "../utils/crypto";

/** Display-only parameters. */
const DISPLAY_PARAMS = new Set(["name", "remark", "tag"]);

export class HysteriaParser implements ProtocolParser {
  readonly protocol = "hysteria";
  readonly schemes = ["hysteria"];

  detect(input: string): boolean {
    return input.trim().toLowerCase().startsWith("hysteria://");
  }

  parse(input: string): ParsedConfig {
    const raw = input.trim();
    const body = raw.slice("hysteria://".length);

    if (!body) {
      return invalidResult("hysteria", raw, "Empty Hysteria payload");
    }

    // Split off fragment
    const fragmentIdx = body.indexOf("#");
    const fragment = fragmentIdx >= 0 ? body.slice(fragmentIdx + 1) : "";
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
      // No auth — might be just host:port
      auth = "";
      hostPort = authority;
    }

    // Parse host:port
    let host: string;
    let portStr: string;
    if (hostPort.startsWith("[")) {
      const closeBracket = hostPort.indexOf("]");
      if (closeBracket < 0) {
        return invalidResult("hysteria", raw, "Unclosed IPv6 bracket");
      }
      host = hostPort.slice(1, closeBracket);
      portStr = hostPort.slice(closeBracket + 1).replace(/^:/, "");
    } else {
      const lastColon = hostPort.lastIndexOf(":");
      if (lastColon < 0) {
        return invalidResult("hysteria", raw, "Missing port");
      }
      host = hostPort.slice(0, lastColon);
      portStr = hostPort.slice(lastColon + 1);
    }

    if (!host) {
      return invalidResult("hysteria", raw, "Empty server host");
    }

    const port = parseInt(portStr, 10);
    if (!isValidPort(port)) {
      return invalidResult("hysteria", raw, `Invalid port: ${portStr}`);
    }

    // Parse query parameters
    const params = parseQueryString(queryString);

    // Build canonical string
    const canonical = buildCanonical(auth, host, port, params);

    // Detect location from fragment and hostname
    const location = detectLocation(fragment, host);

    return {
      protocol: "hysteria",
      raw,
      canonical,
      configHash: "",
      isValid: true,
      server: normalizeServer(host),
      port,
      fragment: fragment || undefined,
      location,
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

  // Sort all identity-affecting params (exclude display-only)
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

  const base = `hysteria://${auth}@${server}:${port}`;
  return queryString ? `${base}?${queryString}` : base;
}

// ─── Async Parse with Hash ─────────────────────────────────

export async function parseHysteriaWithHash(
  input: string
): Promise<ParsedConfig> {
  const parser = new HysteriaParser();
  const result = parser.parse(input);
  if (!result.isValid) return result;

  const configHash = await sha256hex(result.canonical);
  return { ...result, configHash };
}
