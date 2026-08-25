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
import { getAdminState, setAdminState, clearAdminState } from "../db/admin-states";
import { buildAutoFetchKeyboard, buildSubPromptKeyboard, buildBackKeyboard } from "./keyboard";
import { getAllSources, updateSource, getSourceByChatId, insertSource } from "../db/sources";
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
      const handled = await handleConversationState(message, db, api, uid);
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
    const ctx = { db, api, adminUserIds, message: callbackQuery.message!, userId: callbackQuery.from.id };
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


// ─── Conversation State Handling ─────────────────────────

async function handleConversationState(
  message: TgMessage, db: D1Database, api: TelegramBotAPI, userId: number
): Promise<boolean> {
  const state = await getAdminState(db, userId);
  if (!state || state.state === "idle") return false;
  const chatId = message.chat.id;
  const text = getMessageText(message).trim();
  const stateAge = Date.now() - new Date(state.updated_at).getTime();
  if (stateAge > 3600000) {
    await clearAdminState(db, userId);
    await api.sendMessage({ chat_id: chatId,
      text: "\u23F0 \u0632\u0645\u0627\u0646 \u0627\u0646\u062A\u0638\u0627\u0631 \u0645\u0646\u0642\u0636\u06CC \u0634\u062F. \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.",
      reply_markup: buildBackKeyboard(), });
    return true;
  }
  switch (state.state) {
    case "awaiting_sub_url":
      return await handleSubUrlInput(text, db, api, chatId, userId);
    case "awaiting_sub_title":
      return await handleSubTitleInput(text, db, api, chatId, userId, state.context);
    default: await clearAdminState(db, userId); return false;
  }
}

async function handleSubUrlInput(
  text: string, db: D1Database, api: TelegramBotAPI, chatId: number, userId: number
): Promise<boolean> {
  let url: URL;
  try { url = new URL(text); } catch {
    await api.sendMessage({ chat_id: chatId,
      text: "\u26A0\uFE0F \u0644\u06CC\u0646\u06A9 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u06CC\u06A9 URL \u0635\u062D\u06CC\u062D \u0627\u0631\u0633\u0627\u0644 \u06A9\u0646\u06CC\u062F.",
      reply_markup: buildSubPromptKeyboard(), });
    return true;
  }
  const urlHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.href));
  const hashHex = Array.from(new Uint8Array(urlHash)).slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
  const sourceChatId = parseInt(hashHex, 16);
  const existing = await getSourceByChatId(db, sourceChatId);
  if (existing) {
    await clearAdminState(db, userId);
    await api.sendMessage({ chat_id: chatId,
      text: "\u2139\uFE0F \u0627\u06CC\u0646 \u0627\u0634\u062A\u0631\u0627\u06A9 \u0642\u0628\u0644\u0627\u064B \u0627\u0636\u0627\u0641\u0647 \u0634\u062F\u0647 \u0627\u0633\u062A.",
      reply_markup: buildBackKeyboard(), });
    return true;
  }
  await setAdminState(db, userId, "awaiting_sub_title", { url: url.href });
  await api.sendMessage({ chat_id: chatId,
    text: ["\u2705 \u0644\u06CC\u0646\u06A9 \u062F\u0631\u06CC\u0627\u0641\u062A \u0634\u062F!", "", "\uD83D\uDCCC \u0646\u0627\u0645 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC (\u0627\u062E\u062A\u06CC\u0627\u0631\u06CC):", "\u06CC\u06A9 \u0646\u0627\u0645 \u0627\u0631\u0633\u0627\u0644 \u06A9\u0646\u06CC\u062F \u06CC\u0627 /skip \u0628\u0632\u0646\u06CC\u062F"].join("\n"),
    reply_markup: buildSubPromptKeyboard(), });
  return true;
}

async function handleSubTitleInput(
  text: string, db: D1Database, api: TelegramBotAPI, chatId: number, userId: number, context: string | null
): Promise<boolean> {
  const ctx = context ? JSON.parse(context) : {};
  const url: string = ctx.url;
  if (!url) {
    await clearAdminState(db, userId);
    await api.sendMessage({ chat_id: chatId, text: "\u26A0\uFE0F \u062E\u0637\u0627. /addsub \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.", reply_markup: buildBackKeyboard() });
    return true;
  }
  const title = text === "/skip" ? undefined : text;
  try {
    const urlHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
    const hashHex = Array.from(new Uint8Array(urlHash)).slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
    const sourceChatId = parseInt(hashHex, 16);
    await insertSource(db, { chat_id: sourceChatId, title, type: "subscription", enabled: 1, trusted: 1 });
    await updateSource(db, sourceChatId, { sub_url: url, sub_status: "active", auto_fetch: 1 });
    await clearAdminState(db, userId);
    const displayTitle = title || url.substring(0, 40);
    await api.sendMessage({ chat_id: chatId,
      text: ["\u2705 \u0627\u0634\u062A\u0631\u0627\u06A9 \u0627\u0636\u0627\u0641\u0647 \u0634\u062F!", "", "\uD83D\uDCCB " + displayTitle, "\uD83D\uDD17 " + url, "", "\u26A1 \u062F\u0631\u06CC\u0627\u0641\u062A \u062E\u0648\u062F\u06A9\u0627\u0631: \u0641\u0639\u0627\u0644"].join("\n"),
      reply_markup: buildBackKeyboard(), });
  } catch {
    await clearAdminState(db, userId);
    await api.sendMessage({ chat_id: chatId, text: "\u26A0\uFE0F \u062E\u0637\u0627 \u062F\u0631 \u0627\u0636\u0627\u0641\u0647.", reply_markup: buildBackKeyboard() });
  }
  return true;
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
