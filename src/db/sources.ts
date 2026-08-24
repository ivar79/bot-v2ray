/**
 * Sources Table — D1 CRUD Operations
 *
 * Represents trusted ingestion sources (channels where bot is admin).
 * chat_id is UNIQUE per source.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { SourceRow, SourceInsert } from "./connection";
import { nowISO } from "./connection";

// ─── Insert ─────────────────────────────────────────────────

/**
 * Insert a new source. Returns the inserted row on success.
 * Throws if chat_id already exists (UNIQUE constraint).
 */
export async function insertSource(
  db: D1Database,
  data: SourceInsert
): Promise<SourceRow> {
  const result = await db
    .prepare(
      `INSERT INTO sources (type, chat_id, title, username, enabled, trusted)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.type ?? "trusted_channel",
      data.chat_id,
      data.title ?? null,
      data.username ?? null,
      data.enabled ?? 1,
      data.trusted ?? 0
    )
    .run();

  if (!result.success) {
    throw new Error(`Failed to insert source: ${JSON.stringify(result.error)}`);
  }

  const id = result.meta.last_row_id as number;
  const row = await getSourceById(db, id);
  if (!row) {
    throw new Error(`Failed to retrieve inserted source with id ${id}`);
  }
  return row;
}

// ─── Lookup ─────────────────────────────────────────────────

/** Get source by primary key. */
export async function getSourceById(
  db: D1Database,
  id: number
): Promise<SourceRow | null> {
  const row = await db
    .prepare("SELECT * FROM sources WHERE id = ?")
    .bind(id)
    .first<SourceRow>();
  return row ?? null;
}

/** Get source by Telegram chat_id. */
export async function getSourceByChatId(
  db: D1Database,
  chatId: number
): Promise<SourceRow | null> {
  const row = await db
    .prepare("SELECT * FROM sources WHERE chat_id = ?")
    .bind(chatId)
    .first<SourceRow>();
  return row ?? null;
}

/** Get all enabled sources. */
export async function getEnabledSources(db: D1Database): Promise<SourceRow[]> {
  const result = await db
    .prepare("SELECT * FROM sources WHERE enabled = 1 ORDER BY created_at")
    .all<SourceRow>();
  return result.results ?? [];
}

/** Get all enabled and trusted sources. */
export async function getTrustedSources(db: D1Database): Promise<SourceRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM sources WHERE enabled = 1 AND trusted = 1 ORDER BY created_at"
    )
    .all<SourceRow>();
  return result.results ?? [];
}

/** Get all sources (including disabled). */
export async function getAllSources(db: D1Database): Promise<SourceRow[]> {
  const result = await db
    .prepare("SELECT * FROM sources ORDER BY created_at")
    .all<SourceRow>();
  return result.results ?? [];
}

// ─── Update ─────────────────────────────────────────────────

/** Update a source by chat_id. Only provided fields are updated. */
export async function updateSource(
  db: D1Database,
  chatId: number,
  updates: {
    title?: string;
    username?: string;
    enabled?: number;
    trusted?: number;
  }
): Promise<SourceRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    sets.push("title = ?");
    values.push(updates.title);
  }
  if (updates.username !== undefined) {
    sets.push("username = ?");
    values.push(updates.username);
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(updates.enabled);
  }
  if (updates.trusted !== undefined) {
    sets.push("trusted = ?");
    values.push(updates.trusted);
  }

  if (sets.length === 0) {
    return getSourceByChatId(db, chatId);
  }

  sets.push("updated_at = ?");
  values.push(nowISO());
  values.push(chatId);

  await db
    .prepare(`UPDATE sources SET ${sets.join(", ")} WHERE chat_id = ?`)
    .bind(...values)
    .run();

  return getSourceByChatId(db, chatId);
}

/** Delete a source by chat_id. */
export async function deleteSource(
  db: D1Database,
  chatId: number
): Promise<void> {
  await db.prepare("DELETE FROM sources WHERE chat_id = ?").bind(chatId).run();
}

// ─── Queries ────────────────────────────────────────────────

/** Count total sources. */
export async function countSources(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM sources")
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/** Check if a chat_id is registered as an enabled source. */
export async function isSourceEnabled(
  db: D1Database,
  chatId: number
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM sources WHERE chat_id = ? AND enabled = 1")
    .bind(chatId)
    .first<{ "1": number }>();
  return row !== null;
}
