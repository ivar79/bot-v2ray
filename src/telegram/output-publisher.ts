/**
 * Telegram Channel Output Publisher
 *
 * Sends generated output files to a configured Telegram channel.
 * The output channel ID is stored in the settings table under
 * the key "output_channel_id".
 *
 * Per §21 / §22 of the Master Build Directive:
 * - Use sendDocument for file delivery
 * - Fail gracefully on Telegram API errors
 * - Do not expose internal errors to users
 * - The output channel is configured by admin via /setoutput
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { TelegramBotAPI } from "./api";
import { getSetting } from "../db/settings";
import { getConfigById } from "../db/configs";
import { applyRemarkToConfigs, DEFAULT_REMARK_TEMPLATE } from "../output/remark";
import { formatConfigCard } from "../output/config-card";
import type { ConfigRow } from "../db/connection";

// ─── Constants ─────────────────────────────────────────────

/** Maximum file size for Telegram sendDocument (50 MB). */
const MAX_TELEGRAM_FILE_SIZE = 50 * 1024 * 1024;

/** Delay between sends to avoid Telegram rate limits (100ms). */
const INTER_FILE_DELAY_MS = 100;

// ─── Types ─────────────────────────────────────────────────

/** Result of publishing to a Telegram output channel. */
export interface TelegramPublishResult {
  /** Whether at least one file was sent successfully. */
  success: boolean;
  /** Number of files sent successfully. */
  sentCount: number;
  /** Number of files that failed to send. */
  failedCount: number;
  /** Number of files skipped (too large or empty). */
  skippedCount: number;
  /** Total number of files attempted. */
  totalCount: number;
  /** Error message if the entire operation failed. */
  error?: string;
}

// ─── Core Function ─────────────────────────────────────────

/**
 * Publish generated output files to the configured Telegram channel.
 *
 * Flow:
 * 1. Read output_channel_id from settings
 * 2. Validate the channel ID is configured
 * 3. For each file in the manifest, send it as a document
 * 4. Track success/failure/skip counts
 * 5. Return summary
 *
 * @param db — D1 database to read output channel setting
 * @param api — Telegram Bot API client (injectable for testing)
 * @param manifest — Map of filename → content from generateAllOutputs()
 * @returns TelegramPublishResult with detailed reporting
 */
export async function publishToTelegramChannel(
  db: D1Database,
  api: TelegramBotAPI,
  manifest: Map<string, string>
): Promise<TelegramPublishResult> {
  // Step 1: Read the configured output channel ID
  const channelIdStr = await getSetting(db, "output_channel_id");

  if (!channelIdStr) {
    return {
      success: false,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      totalCount: manifest.size,
      error: "Output channel not configured. Use /setoutput to configure.",
    };
  }

  // Step 2: Validate channel ID is a number
  const channelId = parseInt(channelIdStr, 10);
  if (isNaN(channelId)) {
    return {
      success: false,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      totalCount: manifest.size,
      error: "Invalid output channel ID in settings.",
    };
  }

  // Step 3: Send each file
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  const files = Array.from(manifest.entries());

  for (let i = 0; i < files.length; i++) {
    const [filename, content] = files[i];

    // Skip empty files
    if (!content || content.length === 0) {
      skippedCount++;
      continue;
    }

    // Skip files that exceed Telegram's limit
    if (content.length > MAX_TELEGRAM_FILE_SIZE) {
      skippedCount++;
      continue;
    }

    // Build a display-friendly filename for the document
    const displayName = filename;

    try {
      const sent = await api.sendDocument({
        chat_id: channelId,
        document: content,
        caption: `📤 ${displayName}`,
      });

      if (sent) {
        sentCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }

    // Rate limit protection: small delay between sends
    // (skip delay after last file)
    if (i < files.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, INTER_FILE_DELAY_MS));
    }
  }

  return {
    success: sentCount > 0,
    sentCount,
    failedCount,
    skippedCount,
    totalCount: files.length,
  };
}

// ─── Config Card Publishing ────────────────────────────────

/** Result of publishing config cards to a channel. */
export interface ConfigCardPublishResult {
  /** Whether at least one card was sent successfully. */
  success: boolean;
  /** Number of cards sent successfully. */
  sentCount: number;
  /** Number of cards that failed to send. */
  failedCount: number;
  /** Total number of cards attempted. */
  totalCount: number;
  /** Error message if the entire operation failed. */
  error?: string;
}

/** Delay between card sends to avoid rate limits (200ms). */
const INTER_CARD_DELAY_MS = 200;

/**
 * Publish individual config cards to a Telegram channel.
 * Each config is sent as a formatted text message (sendMessage),
 * not as a document.
 *
 * @param db — D1 database to read output channel setting
 * @param api — Telegram Bot API client
 * @param cards — Array of pre-formatted card strings from formatConfigCard()
 * @returns ConfigCardPublishResult with detailed reporting
 */
export async function sendConfigCards(
  db: D1Database,
  api: TelegramBotAPI,
  cards: string[]
): Promise<ConfigCardPublishResult> {
  const channelIdStr = await getSetting(db, "output_channel_id");

  if (!channelIdStr) {
    return {
      success: false,
      sentCount: 0,
      failedCount: 0,
      totalCount: cards.length,
      error: "Output channel not configured. Use /setoutput to configure.",
    };
  }

  const channelId = parseInt(channelIdStr, 10);
  if (isNaN(channelId)) {
    return {
      success: false,
      sentCount: 0,
      failedCount: 0,
      totalCount: cards.length,
      error: "Invalid output channel ID in settings.",
    };
  }

  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card || card.length === 0) {
      failedCount++;
      continue;
    }

    try {
      const sent = await api.sendMessage({
        chat_id: channelId,
        text: card,
      });

      if (sent) {
        sentCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }

    if (i < cards.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, INTER_CARD_DELAY_MS));
    }
  }

  return {
    success: sentCount > 0,
    sentCount,
    failedCount,
    totalCount: cards.length,
  };
}

// ─── Auto-Publish After Fetch ────────────────────────────

/** Max config cards to auto-publish in a single fetch cycle. */
export const MAX_AUTO_PUBLISH_CARDS = 30;

/** Result of automatically publishing newly fetched configs. */
export interface AutoPublishResult {
  /** False when no output channel is configured (silently skipped). */
  published: boolean;
  /** Number of cards sent successfully. */
  sentCount: number;
  /** Number of new configs that were eligible. */
  totalCount: number;
}

/**
 * Automatically publish newly collected configs to the output channel.
 * Called right after a successful subscription fetch — no manual /send
 * needed. Silently skips when the output channel is not configured.
 * The remark template (if set) is applied so configs carry our own name.
 */
export async function autoPublishConfigs(
  db: D1Database,
  api: TelegramBotAPI,
  configIds: number[]
): Promise<AutoPublishResult> {
  const totalCount = configIds.length;
  const channelIdStr = await getSetting(db, "output_channel_id");
  if (!channelIdStr || isNaN(parseInt(channelIdStr, 10)) || totalCount === 0) {
    return { published: false, sentCount: 0, totalCount };
  }

  const template = (await getSetting(db, "remark_template")) ?? DEFAULT_REMARK_TEMPLATE;

  // Load the config rows for the newly inserted IDs
  const configs: ConfigRow[] = [];
  for (const id of configIds.slice(0, MAX_AUTO_PUBLISH_CARDS)) {
    const row = await getConfigById(db, id);
    if (row && row.is_valid && row.active) configs.push(row);
  }
  if (configs.length === 0) {
    return { published: true, sentCount: 0, totalCount };
  }

  const uris = applyRemarkToConfigs(configs, template);
  const cards = configs.map((c, i) => formatConfigCard({ ...c, raw: uris[i] }));
  const result = await sendConfigCards(db, api, cards);

  return { published: true, sentCount: result.sentCount, totalCount };
}
