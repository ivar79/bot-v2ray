/**
 * Admin States Table — D1 CRUD Operations
 *
 * Manages conversation flow for multi-step admin interactions.
 * Each admin user has one active state row (keyed by user_id).
 * The state field tracks the current conversation step.
 * The context field stores serialized JSON for step-specific data.
 *
 * Example flow:
 *   idle → awaiting_operator → processing_batch → idle
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { AdminStateRow } from "./connection";
import { nowISO } from "./connection";

// ─── Get/Set ────────────────────────────────────────────────

/**
 * Get the admin state for a user. Returns null if no state row exists.
 */
export async function getAdminState(
  db: D1Database,
  userId: number
): Promise<AdminStateRow | null> {
  const row = await db
    .prepare("SELECT * FROM admin_states WHERE user_id = ?")
    .bind(userId)
    .first<AdminStateRow>();
  return row ?? null;
}

/**
 * Get just the current state name for a user, or 'idle' if none.
 */
export async function getAdminStateName(
  db: D1Database,
  userId: number
): Promise<string> {
  const row = await getAdminState(db, userId);
  return row?.state ?? "idle";
}

/**
 * Set (upsert) the admin state for a user.
 */
export async function setAdminState(
  db: D1Database,
  userId: number,
  state: string,
  context?: Record<string, unknown> | null
): Promise<void> {
  const ctxJson = context != null ? JSON.stringify(context) : null;
  await db
    .prepare(
      `INSERT INTO admin_states (user_id, state, context, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE
       SET state = ?, context = ?, updated_at = ?`
    )
    .bind(userId, state, ctxJson, nowISO(), state, ctxJson, nowISO())
    .run();
}

/**
 * Clear admin state back to idle (removes the context).
 */
export async function clearAdminState(
  db: D1Database,
  userId: number
): Promise<void> {
  await setAdminState(db, userId, "idle", null);
}

// ─── Queries ────────────────────────────────────────────────

/**
 * Get all admin states (useful for admin introspection).
 */
export async function getAllAdminStates(
  db: D1Database
): Promise<AdminStateRow[]> {
  const result = await db
    .prepare("SELECT * FROM admin_states ORDER BY updated_at DESC")
    .all<AdminStateRow>();
  return result.results ?? [];
}

/**
 * Get admin states that are not idle (active conversations).
 */
export async function getActiveAdminStates(
  db: D1Database
): Promise<AdminStateRow[]> {
  const result = await db
    .prepare("SELECT * FROM admin_states WHERE state != 'idle'")
    .all<AdminStateRow>();
  return result.results ?? [];
}

/**
 * Delete an admin state row (full cleanup).
 */
export async function deleteAdminState(
  db: D1Database,
  userId: number
): Promise<void> {
  await db
    .prepare("DELETE FROM admin_states WHERE user_id = ?")
    .bind(userId)
    .run();
}
