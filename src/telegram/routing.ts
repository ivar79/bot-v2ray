/**
 * Telegram Update Routing
 *
 * Routes incoming Telegram updates to the appropriate handlers:
 * - message → command parsing or text/config processing
 * - channel_post → trusted source config ingestion
 * - callback_query → inline button response handling
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { TgMessage, TgChannelPost, TgCallbackQuery } from "./types";
import { getMessageText, isPrivateChat, isChannelChat } from "./types";
import type { TelegramBotAPI } from "./api";
import { executeCommand, handleMenuAction, type CommandContext } from "./commands";
import { isAdmin } from "./auth";
import { handleTextUpload, handleDocumentUpload, handleOperatorSelection } from "../ingest/admin";
import { handleChannelPost } from "../ingest/channel";
import { dispatchConversationState } from "./conversations";
import { clearAdminState } from "../db/admin-states";
import { buildAutoFetchKeyboard } from "./keyboard";
import { getAllSources, updateSource } from "../db/sources";
import type { GitHubAPI } from "../github/api";

// ─── Message Processing ────────────────────────────────────

/**
 * Process an incoming message update.
 *
 * Flow:
 * 1. Check if it's a command → route to command handler
 * 2. Check if it's from a private chat (admin upload, Phase 5)
 * 3. Otherwise, ignore (we don't process random messages)
 */
export async function processMessage(
  message: TgMessage,
  db: D1Database,
  api: TelegramBotAPI,
  adminUserIds: string,
  githubToken?: string,
  githubApi?: GitHubAPI
): Promise<void> {
  const text = getMessageText(message);
  const userId = message.from?.id;
  const chatId = message.chat.id;
  console.log("[routing] message received: userId=" + userId + " chatId=" + chatId + " text=" + (text || "(empty)").substring(0, 80));

  // Check for commands
  if (text.startsWith("/")) {
    await handleCommand(text, message, db, api, adminUserIds, githubToken, githubApi);
    return;
  }

  // Non-command messages in private chat - check conversation state first
  if (isPrivateChat(message.chat)) {
    const uid = message.from?.id;
    if (uid && isAdmin(uid, adminUserIds)) {
      const handled = await dispatchConversationState(message, db, api, uid);
      if (handled) return;
    }
  }

  // Non-command messages in private chat — check for admin upload
  if (isPrivateChat(message.chat)) {
    const userId = message.from?.id;
    if (userId && isAdmin(userId, adminUserIds)) {
      // Check if there are config links in the text
      const configPattern = /(?:vmess|vless|trojan|ss|hysteria2|hy2|hysteria):\/\//gi;
      if (text && configPattern.test(text)) {
        await handleTextUpload(message, db, api, adminUserIds);
        return;
      }

      // Check if there's a document attached
      if (message.document) {
        await handleDocumentUpload(message, db, api, adminUserIds);
        return;
      }
    }
  }
}

// ─── Channel Post Processing ───────────────────────────────

/**
 * Process a channel_post update.
 *
 * Delegates to channel ingestion which handles:
 * - Source validation (chat_id lookup, enabled, trusted checks)
 * - Config extraction and parsing
 * - Dedup via config_hash
 * - Batch + occurrence storage
 * - Collection run tracking
 *
 * Untrusted or unconfigured channels are silently ignored.
 */
export async function processChannelPost(
  post: TgChannelPost,
  db: D1Database,
  api: TelegramBotAPI,
  _adminUserIds: string
): Promise<void> {
  await handleChannelPost(post, db, api);
}

// ─── Callback Query Processing ─────────────────────────────

/**
 * Process a callback_query update.
 *
 * Handles inline keyboard button presses.
 * This is a placeholder for Phase 5 (operator selection buttons).
 */
export async function processCallbackQuery(
  callbackQuery: TgCallbackQuery,
  db: D1Database,
  api: TelegramBotAPI,
  adminUserIds: string
): Promise<void> {
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;

  if (!data) return;

  // Handle menu button presses (menu:action)
  if (data.startsWith("menu:")) {
    const action = data.slice(5); // Remove "menu:" prefix
    const ctx = {
      db,
      api,
      adminUserIds,
      message: callbackQuery.message!,
      userId: callbackQuery.from.id,
      isCallback: true,
    };
    await handleMenuAction(action, ctx);
    await api.answerCallbackQuery({ callback_query_id: callbackQuery.id });
    return;
  }

    // Handle operator selection callbacks (op:operator_name)
  if (data.startsWith("op:")) {
    const operator = data.slice(3); // Remove "op:" prefix
    const chatId = callbackQuery.message?.chat?.id ?? callbackQuery.from.id;
    await handleOperatorSelection(
      callbackQuery.id,
      operator,
      userId,
      chatId,
      db,
      api,
      adminUserIds
    );
    return;
  }

  // Handle autofetch settings callbacks
  if (data.startsWith("autofetch:")) {
    const afAction = data.slice(10);
    const ctx = { db, api, adminUserIds, message: callbackQuery.message!, userId: callbackQuery.from.id, isCallback: true };
    await handleAutoFetchAction(afAction, ctx);
    await api.answerCallbackQuery({ callback_query_id: callbackQuery.id });
    return;
  }
  // Handle sub cancel callback
  if (data === "sub:cancel") {
    await clearAdminState(db, callbackQuery.from.id);
    const chatId = callbackQuery.message?.chat?.id ?? callbackQuery.from.id;
    await api.sendMessage({ chat_id: chatId, text: "❌ عملیات لغو شد." });
    await api.answerCallbackQuery({ callback_query_id: callbackQuery.id });
    return;
  }
  // Other callback types — acknowledge
  await api.answerCallbackQuery({
    callback_query_id: callbackQuery.id,
  });
}


async function handleAutoFetchAction(action: string, ctx: CommandContext): Promise<void> {
  const { db, api, message } = ctx;
  const chatId = message.chat.id;
  const sources = await getAllSources(db);
  const subs = sources.filter(s => s.sub_url);
  if (action === "on") {
    let count = 0;
    for (const sub of subs) { if (!sub.auto_fetch) { await updateSource(db, sub.chat_id, { auto_fetch: 1 }); count++; } }
    await api.sendMessage({ chat_id: chatId, text: "\u2705 \u062F\u0631\u06CC\u0627\u0641\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u0628\u0631\u0627\u06CC " + count + " \u0627\u0634\u062A\u0631\u0627\u06A9 \u0641\u0639\u0627\u0644 \u0634\u062F.", reply_markup: buildAutoFetchKeyboard() });
  } else if (action === "off") {
    let count = 0;
    for (const sub of subs) { if (sub.auto_fetch) { await updateSource(db, sub.chat_id, { auto_fetch: 0 }); count++; } }
    await api.sendMessage({ chat_id: chatId, text: "\u274C \u062F\u0631\u06CC\u0627\u0641\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u0628\u0631\u0627\u06CC " + count + " \u0627\u0634\u062A\u0631\u0627\u06A9 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u0634\u062F.", reply_markup: buildAutoFetchKeyboard() });
  } else if (action.startsWith("interval:")) {
    const hours = parseInt(action.split(":")[1], 10);
    if (isNaN(hours) || hours < 1 || hours > 168) return;
    for (const sub of subs) { await db.prepare("UPDATE sources SET fetch_interval_hours = ? WHERE chat_id = ?").bind(hours, sub.chat_id).run(); }
    await api.sendMessage({ chat_id: chatId, text: "\u23F1\uFE0F \u0628\u0632\u0645\u0627\u0646 \u062F\u0631\u06CC\u0627\u0641\u062A \u0628\u0647 " + hours + " \u0633\u0627\u0639\u062F \u062A\u063A\u06CC\u06CC\u0631 \u06A9\u0631\u062F.", reply_markup: buildAutoFetchKeyboard() });
  }
}


// ─── Command Parsing ───────────────────────────────────────

/**
 * Parse and execute a command from message text.
 *
 * Handles:
 * /command — basic command
 * /command@botname — command with bot mention (stripped)
 * /command args — command with arguments (stripped)
 */
async function handleCommand(
  text: string,
  message: TgMessage,
  db: D1Database,
  api: TelegramBotAPI,
  adminUserIds: string,
  githubToken?: string,
  githubApi?: GitHubAPI
): Promise<void> {
  // Parse the command
  const commandStr = text.trim();
  const parts = commandStr.split(/\s+/);
  const fullCommand = parts[0]; // e.g., "/start@mybot" or "/start"

  // Remove leading /
  let command = fullCommand.slice(1);
  if (!command) return;

  // Remove @botname if present
  const atIdx = command.indexOf("@");
  if (atIdx >= 0) {
    command = command.slice(0, atIdx);
  }

  // Normalize to lowercase
  command = command.toLowerCase();

  if (!command) return;

  const userId = message.from?.id;
  console.log("[routing] command detected: /" + command + " from userId=" + userId);

  // Execute the command
  const ctx = {
    db,
    api,
    adminUserIds,
    message,
    githubToken,
    githubApi,
  };

  const executed = await executeCommand(command, ctx);

  if (!executed) {
    console.log("[routing] unknown command: /" + command);
    // Unknown command — send help hint (only for private chats)
    if (isPrivateChat(message.chat)) {
      await api.sendMessage({
        chat_id: message.chat.id,
        text: "❓ Unknown command. Use /help to see available commands.",
      });
    }
  }
}
