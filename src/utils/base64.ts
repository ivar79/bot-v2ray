/**
 * Base64 Utilities
 *
 * Tolerant base64 decoding for real-world subscription payloads:
 * - Standard and URL-safe alphabets (-, _)
 * - Whitespace / newlines anywhere in the input
 * - Missing or incorrect padding
 * - UTF-8 safe encode/decode (for vmess JSON remarks)
 */

// ─── Normalization ─────────────────────────────────────────

/**
 * Normalize a base64 string so it can be decoded by atob():
 * 1. Strip all whitespace/newlines/tabs
 * 2. Convert URL-safe alphabet to standard
 * 3. Fix missing/incorrect padding
 *
 * Returns null if the input cannot be a valid base64 payload
 * (e.g. length % 4 === 1 after cleanup).
 */
export function normalizeBase64(input: string): string | null {
  if (!input) return null;
  // Strip all whitespace characters (newlines, spaces, tabs, CR)
  let b64 = input.replace(/\s+/g, "");
  if (!b64) return null;

  // URL-safe → standard alphabet
  b64 = b64.replace(/-/g, "+").replace(/_/g, "/");

  // Remove any existing padding first, then re-pad correctly
  b64 = b64.replace(/=+$/, "");

  const rem = b64.length % 4;
  if (rem === 1) return null; // Impossible base64 length
  if (rem === 2) b64 += "==";
  else if (rem === 3) b64 += "=";

  return b64;
}

/**
 * Attempt to decode a possibly-malformed base64 payload.
 * Tries multiple strategies in order:
 * 1. Normalized (whitespace-stripped, URL-safe converted, re-padded)
 * 2. Raw trimmed input as-is (already valid standard base64)
 *
 * Returns the decoded UTF-8 text, or null if all attempts fail.
 */
export function tryDecodeBase64(input: string): string | null {
  if (!input || !input.trim()) return null;

  const candidates = new Set<string>();
  const normalized = normalizeBase64(input);
  if (normalized) candidates.add(normalized);
  candidates.add(input.trim());

  for (const candidate of candidates) {
    try {
      const binary = atob(candidate);
      if (!binary) continue;
      return binaryToUtf8(binary);
    } catch {
      // Try next strategy
    }
  }
  return null;
}

// ─── UTF-8 Safe Conversions ────────────────────────────────

/** Decode an atob() binary string (latin1) into proper UTF-8 text. */
export function binaryToUtf8(binary: string): string {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** Encode a UTF-8 string to base64 (safe for non-ASCII content like Persian remarks). */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─── Backwards-compatible Aliases ──────────────────────────

/** Alias for utf8ToBase64 — kept for existing parser/test call sites. */
export const encodeBase64 = utf8ToBase64;

/** Alias for tryDecodeBase64 — tolerant decode returning null on failure. */
export const decodeBase64 = tryDecodeBase64;
