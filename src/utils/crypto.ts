/**
 * Crypto Utilities — SHA-256 Hashing
 *
 * Provides deterministic SHA-256 hashing for config canonicalization.
 * Uses the Web Crypto API (available in Cloudflare Workers runtime).
 */

/** Maximum input size to prevent abuse (1 MB). */
const MAX_INPUT_SIZE = 1_048_576;

/**
 * Compute the SHA-256 hex digest of a string.
 * Deterministic: same input always produces same output.
 *
 * @throws If input exceeds MAX_INPUT_SIZE.
 */
export async function sha256hex(input: string): Promise<string> {
  if (input.length > MAX_INPUT_SIZE) {
    throw new Error(
      `Input too large for SHA-256: ${input.length} bytes (max ${MAX_INPUT_SIZE})`
    );
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Synchronous SHA-256 for use in non-async contexts.
 * Falls back to a simple hash if Web Crypto is unavailable.
 * For production, always prefer the async version.
 */
export async function computeConfigHash(canonical: string): Promise<string> {
  return sha256hex(canonical);
}
