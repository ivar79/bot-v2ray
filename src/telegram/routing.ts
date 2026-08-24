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
import { executeCommand } from "./commands";
import { isAdmin } from "./auth";
import { handleTextUpload, handleDocumentUpload, handleOperatorSelection } from "../ingest/admin";
import { handleChannelPost } from "../ingest/channel";
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

  // Other callback types — acknowledge
  await api.answerCallbackQuery({
    callback_query_id: callbackQuery.id,
  });
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
