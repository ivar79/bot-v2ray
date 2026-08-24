/**
 * Telegram Webhook Handler
 *
 * Handles incoming Telegram webhook requests:
 * 1. Verifies X-Telegram-Bot-Secret-Token header
 * 2. Parses the Telegram Update
 * 3. Routes to the appropriate handler
 * 4. Handles idempotency via processed_updates
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { TgUpdate } from "./types";
import { getMessageText, isPrivateChat } from "./types";
import type { TelegramBotAPI } from "./api";
import { createTelegramBotAPI } from "./api";
import { isUpdateProcessed, markUpdateProcessed } from "../db/updates";
import { processMessage, processChannelPost, processCallbackQuery } from "./routing";

// ─── Constants ─────────────────────────────────────────────

/** Maximum Update payload size (1 MB). */
const MAX_UPDATE_SIZE = 1_048_576;

/** Error message for invalid webhook secret. */
const SECRET_ERROR = "Invalid webhook secret";

// ─── Webhook Processing ────────────────────────────────────

/**
 * Process an incoming Telegram webhook request.
 *
 * Flow:
 * 1. Verify secret token
 * 2. Parse JSON body
 * 3. Check idempotency
 * 4. Route to appropriate handler
 * 5. Mark as processed
 *
 * Returns an HTTP Response to send back to Telegram.
 * Telegram expects 200 OK for successful processing.
 */
export async function handleWebhookRequest(
  request: Request,
  env: {
    DB: D1Database;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_WEBHOOK_SECRET: string;
    ADMIN_USER_IDS: string;
    GITHUB_TOKEN?: string;
  },
  /** Optional API override for testing. If omitted, creates a real client. */
  apiOverride?: TelegramBotAPI
): Promise<Response> {
  // ── Step 1: Verify webhook secret ──
  const secretToken = request.headers.get("X-Telegram-Bot-Secret-Token");
  if (!secretToken || secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
    console.error("[webhook] secret validation failed: header=" + (secretToken ? "present" : "missing"));
    return new Response(SECRET_ERROR, { status: 403 });
  }
  console.log("[webhook] secret validated OK");

  // ── Step 2: Read and parse body ──
  let bodyText: string;
  try {
    // Check content length before reading
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_UPDATE_SIZE) {
      return new Response("Payload too large", { status: 413 });
    }

    bodyText = await request.text();

    if (bodyText.length > MAX_UPDATE_SIZE) {
      return new Response("Payload too large", { status: 413 });
    }
  } catch {
    return new Response("Failed to read request body", { status: 400 });
  }

  let update: TgUpdate;
  try {
    update = JSON.parse(bodyText) as TgUpdate;
  } catch {
    console.error("[webhook] JSON parse failed, body length=" + bodyText.length);
    return new Response("Invalid JSON", { status: 400 });
  }

  // Validate basic structure
  if (typeof update.update_id !== "number") {
    console.error("[webhook] invalid update structure: missing update_id");
    return new Response("Invalid update structure", { status: 400 });
  }

  console.log("[webhook] update parsed: id=" + update.update_id
    + " hasMessage=" + !!update.message
    + " hasChannelPost=" + !!update.channel_post
    + " hasCallbackQuery=" + !!update.callback_query);

  // ── Step 3: Check idempotency ──
  const alreadyProcessed = await isUpdateProcessed(env.DB, update.update_id);
  if (alreadyProcessed) {
    console.log("[webhook] update " + update.update_id + " already processed, skipping");
    // Return 200 so Telegram doesn't retry
    return new Response("OK", { status: 200 });
  }

  // ── Step 4: Route the update ──
  try {
    const api = apiOverride ?? createTelegramBotAPI(env.TELEGRAM_BOT_TOKEN);
    await routeUpdate(update, env.DB, api, env.ADMIN_USER_IDS, env.GITHUB_TOKEN, undefined);
  } catch {
    // Don't expose internal errors to Telegram
    // Still return 200 to prevent retries for processing errors
  }

  // ── Step 5: Mark as processed ──
  // Mark even if routing failed to prevent infinite retries
  // of the same malformed update
  await markUpdateProcessed(env.DB, update.update_id);
  console.log("[webhook] update " + update.update_id + " marked as processed");

  return new Response("OK", { status: 200 });
}

// ─── Update Routing ────────────────────────────────────────

/**
 * Route a Telegram update to the appropriate handler.
 */
async function routeUpdate(
  update: TgUpdate,
  db: D1Database,
  api: TelegramBotAPI,
  adminUserIds: string,
  githubToken?: string,
  githubApi?: import("../github/api").GitHubAPI
): Promise<void> {
  // Priority: message > channel_post > callback_query
  // Ignore: edited_message, inline_query, etc.

  if (update.message) {
    await processMessage(update.message, db, api, adminUserIds, githubToken, githubApi);
    return;
  }

  if (update.channel_post) {
    await processChannelPost(update.channel_post, db, api, adminUserIds);
    return;
  }

  if (update.callback_query) {
    await processCallbackQuery(update.callback_query, db, api, adminUserIds);
    return;
  }

  // Other update types are silently ignored (not an error)
}

// ─── Re-exports ────────────────────────────────────────────

export { processMessage, processChannelPost, processCallbackQuery } from "./routing";
