/**
 * Admin Authorization
 *
 * Controls who can use admin-only commands.
 * Authorization is based on Telegram numeric user ID.
 *
 * SECURITY RULES:
 * - Admin identity is NEVER based on username, first_name, or chat title
 * - Admin identity is based ONLY on Telegram numeric user ID
 * - If ADMIN_USER_IDS is not set or empty, NOBODY is authorized
 * - The first /start user is NEVER automatically made admin
 */

// ─── Core Functions ────────────────────────────────────────

/**
 * Parse the ADMIN_USER_IDS secret into a Set of numeric IDs.
 * Expected format: comma-separated Telegram user IDs (e.g., "123456,789012")
 * Returns an empty set if the input is empty or invalid.
 */
export function parseAdminUserIds(adminIdsStr: string | undefined): Set<number> {
  const ids = new Set<number>();

  if (!adminIdsStr || adminIdsStr.trim() === "") {
    return ids;
  }

  const parts = adminIdsStr.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === "") continue;

    const id = parseInt(trimmed, 10);
    if (!isNaN(id) && id > 0) {
      ids.add(id);
    }
  }

  return ids;
}

/**
 * Check if a user is authorized as admin.
 *
 * Returns true only if:
 * 1. ADMIN_USER_IDS is configured and non-empty
 * 2. The user's numeric ID is in the list
 *
 * If ADMIN_USER_IDS is not set or empty, returns false for everyone.
 */
export function isAdmin(userId: number, adminIdsStr: string | undefined): boolean {
  const adminIds = parseAdminUserIds(adminIdsStr);

  // If no admin IDs configured, nobody is admin
  if (adminIds.size === 0) {
    return false;
  }

  return adminIds.has(userId);
}

/**
 * Get the list of configured admin IDs.
 * Useful for /status output.
 */
export function getAdminIds(adminIdsStr: string | undefined): number[] {
  return Array.from(parseAdminUserIds(adminIdsStr));
}
