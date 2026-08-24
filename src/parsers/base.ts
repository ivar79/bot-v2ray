/**
 * Parser Base Types and Interfaces
 *
 * Defines the contract that all protocol parsers must implement.
 * Also contains version constants for tracking canonicalization changes.
 */

// ─── Version Constants ─────────────────────────────────────

/** Parser version — bumped when parsing logic changes. */
export const PARSER_VERSION = "1.0";

/** Canonicalization version — bumped when canonical form changes. */
export const CANONICAL_VERSION = "1.0";

// ─── Result Type ───────────────────────────────────────────

/**
 * The result of parsing a configuration string.
 * A single structured type for all protocols.
 */
export interface ParsedConfig {
  /** Protocol identifier (vless, vmess, trojan, ss, hysteria, hysteria2). */
  protocol: string;

  /** The original raw input string. */
  raw: string;

  /** The deterministic canonical representation for hashing. */
  canonical: string;

  /** SHA-256 hex digest of the canonical representation. */
  configHash: string;

  /** Whether the configuration was successfully parsed and valid. */
  isValid: boolean;

  /** Human-readable error message when isValid is false. */
  parseError?: string;

  /** Server hostname or IP (extracted for metadata). */
  server?: string;

  /** Server port (extracted for metadata). */
  port?: number;

  /** Optional normalized URI for database storage. */
  normalizedUri?: string;
}

// ─── Parser Interface ──────────────────────────────────────

/**
 * Protocol parser interface.
 * Each protocol implements this interface.
 */
export interface ProtocolParser {
  /** Protocol identifier. */
  readonly protocol: string;

  /** URI schemes this parser handles (lowercase, without "://"). */
  readonly schemes: string[];

  /**
   * Quick detection: does this input look like this protocol's config?
   * Should be fast and not throw.
   */
  detect(input: string): boolean;

  /**
   * Parse the input into a ParsedConfig.
   * Should never throw — return isValid: false for malformed input.
   */
  parse(input: string): ParsedConfig;
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Create a standardized invalid result.
 */
export function invalidResult(
  protocol: string,
  raw: string,
  error: string
): ParsedConfig {
  return {
    protocol,
    raw,
    canonical: "",
    configHash: "",
    isValid: false,
    parseError: error,
  };
}

/**
 * Validate that a port number is within valid range.
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Normalize a server string (trim, lowercase for IP addresses).
 */
export function normalizeServer(server: string): string {
  return server.trim().toLowerCase();
}
