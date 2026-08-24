/**
 * Base64 Utilities — UTF-8 safe encode/decode
 *
 * Standard base64 and base64url encoding/decoding with full UTF-8 support.
 * Used primarily by VMess (JSON payload) and Shadowsocks (method:password).
 */

/**
 * Decode a base64 string to UTF-8 text.
 * Handles both standard base64 and base64url encodings.
 * Returns null if the input is not valid base64.
 */
export function decodeBase64(input: string): string | null {
  try {
    // Normalize base64url to standard base64
    let b64 = input.replace(/-/g, "+").replace(/_/g, "/");

    // Add padding if missing
    const pad = b64.length % 4;
    if (pad === 2) b64 += "==";
    else if (pad === 3) b64 += "=";
    else if (pad !== 0) return null;

    // Use atob (available in Workers runtime)
    const binary = atob(b64);
    // Convert binary string to UTF-8
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Decode a base64 string to raw bytes.
 * Returns null if the input is not valid base64.
 */
export function decodeBase64Bytes(input: string): Uint8Array | null {
  try {
    let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad === 2) b64 += "==";
    else if (pad === 3) b64 += "=";
    else if (pad !== 0) return null;

    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Encode a UTF-8 string to standard base64.
 */
export function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/**
 * Check if a string looks like valid base64 (loose check).
 */
export function isLikelyBase64(input: string): boolean {
  return /^[A-Za-z0-9+/=_\-]+$/.test(input) && input.length % 4 === 0 || 
    /^[A-Za-z0-9+/=_\-]+$/.test(input);
}
