/**
 * Trusted Channel Ingestion
 *
 * Processes channel_post updates from configured trusted sources.
 *
 * Flow (per FINAL Implementation Plan §14):
 * 1. Receive channel_post update
 * 2. Check: is source configured? is it enabled? is it trusted?
 * 3. If yes → extract → parse → validate → normalize → hash → dedup → store occurrence
 * 4. If no → ignore safely
 *
 * Security rules:
 * - Authorization is based on chat_id from the sources table, NOT username/title
 * - Source must be both enabled AND trusted
 * - No operator metadata inferred from channel content (operator = "unknown" for channels)
 * - Full source traceability preserved via batch + occurrence records
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { TelegramBotAPI } from "../telegram/api";
import type { TgChannelPost } from "../telegram/types";
import { getMessageText } from "../telegram/types";
import { getSourceByChatId } from "../db/sources";
import { createBatch, completeBatchRun, failBatchRun } from "./batch";
import { runPipeline } from "./pipeline";

// ─── Channel Post Processing ───────────────────────────────

/**
 * Process a channel_post update.
 *
 * Security checks:
 * 1. Look up source by chat_id (NOT username or title)
 * 2. Verify source exists AND is enabled AND is trusted
 * 3. If any check fails → silently ignore (do not leak source existence)
 *
 * Processing:
 * 1. Create batch with source_type="trusted_channel"
 * 2. Run the shared ingestion pipeline
 * 3. Complete the collection run
 *
 * Idempotency:
 * - Same update_id is handled by processed_updates in webhook handler
 * - Same config across different channel posts → dedup by config_hash
 * - Each occurrence is separately recorded for traceability
 */
export async function handleChannelPost(
  post: TgChannelPost,
  db: D1Database,
  _api: TelegramBotAPI
): Promise<void> {
  const chatId = post.chat.id;

  // ── Step 1: Source validation ──
  // Look up source by chat_id — NOT by username or title
  const source = await getSourceByChatId(db, chatId);

  if (!source) {
    // Source not configured — silently ignore
    return;
  }

  if (!source.enabled) {
    // Source is disabled — silently ignore
    return;
  }

  if (!source.trusted) {
    // Source is not trusted — silently ignore
    return;
  }

  // ── Step 2: Extract text content ──
  const text = getMessageText(post);
  if (!text) {
    // No text content — nothing to process
    return;
  }

  // ── Step 3: Check for config links ──
  const configPattern =
    /(?:vmess|vless|trojan|ss|hysteria2|hy2|hysteria):\/\//gi;
  if (!configPattern.test(text)) {
    // No supported config links — nothing to process
    return;
  }

  // ── Step 4: Create batch ──
  // Channel batches have operator="unknown" (no admin-provided metadata)
  const batch = await createBatch({
    db,
    sourceType: "trusted_channel",
    sourceChatId: chatId,
    sourceMessageId: post.message_id,
    operator: "unknown",
  });

  // ── Step 5: Run pipeline ──
  try {
    const result = await runPipeline(text, {
      db,
      batchId: batch.batchId,
      sourceType: "trusted_channel",
      sourceChatId: chatId,
      sourceMessageId: post.message_id,
    });

    // Complete the collection run
    await completeBatchRun(db, batch.collectionRunId, result);
  } catch {
    // Pipeline error — mark collection run as failed
    // Do NOT send error messages to the channel (it's not our channel)
    await failBatchRun(
      db,
      batch.collectionRunId,
      "Channel ingestion pipeline error"
    );
  }
}

// ─── Source Management ─────────────────────────────────────

/**
 * Add a trusted source by chat_id.
 * Used by admin command /addsource.
 */
export async function addTrustedSource(
  db: D1Database,
  chatId: number,
  title?: string,
  username?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const existing = await getSourceByChatId(db, chatId);
    if (existing) {
      // Source already exists — update it if needed
      const { updateSource } = await import("../db/sources");
      const updates: { title?: string; username?: string; enabled?: number; trusted?: number } = {};
      if (title) updates.title = title;
      if (username) updates.username = username;
      updates.enabled = 1;
      updates.trusted = 1;

      if (Object.keys(updates).length > 0) {
        await updateSource(db, chatId, updates);
      }

      return {
        success: true,
        message: `Source <b>updated</b>: ${formatSourceId(title, username, chatId)}`,
      };
    }

    const { insertSource } = await import("../db/sources");
    await insertSource(db, {
      type: "trusted_channel",
      chat_id: chatId,
      title,
      username,
      enabled: 1,
      trusted: 1,
    });

    return {
      success: true,
      message: `✅ Source <b>added</b>: ${formatSourceId(title, username, chatId)}`,
    };
  } catch {
    return {
      success: false,
      message: "⚠️ Failed to add source. Please try again.",
    };
  }
}

/**
 * Remove a trusted source by chat_id.
 * Used by admin command /removesource.
 */
export async function removeTrustedSource(
  db: D1Database,
  chatId: number
): Promise<{ success: boolean; message: string }> {
  try {
    const existing = await getSourceByChatId(db, chatId);
    if (!existing) {
      return {
        success: false,
        message: `Source with chat_id <code>${chatId}</code> not found.`,
      };
    }

    const { deleteSource } = await import("../db/sources");
    await deleteSource(db, chatId);

    return {
      success: true,
      message: `✅ Source <b>removed</b>: ${formatSourceId(existing.title, existing.username, chatId)}`,
    };
  } catch {
    return {
      success: false,
      message: "⚠️ Failed to remove source. Please try again.",
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Format a source identifier for display.
 */
function formatSourceId(
  title: string | null | undefined,
  username: string | null | undefined,
  chatId: number
): string {
  if (username) return `@${username}`;
  if (title) return `${title} (<code>${chatId}</code>)`;
  return `<code>${chatId}</code>`;
}
