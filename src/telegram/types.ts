/**
 * Telegram Bot API Type Definitions
 *
 * Minimal type definitions for the Telegram Update objects
 * we need to handle. Only includes fields we actually use.
 *
 * Reference: https://core.telegram.org/bots/api#update
 */

// ─── Core Types ────────────────────────────────────────────

/** Telegram user object. */
export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/** Telegram chat object. */
export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

/** Telegram message object (subset of fields we use). */
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  date: number;
  chat: TgChat;
  text?: string;
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  caption?: string;
  reply_to_message?: TgMessage;
  new_chat_members?: TgUser[];
}

/** Telegram channel post (same structure as Message). */
export interface TgChannelPost {
  message_id: number;
  date: number;
  chat: TgChat;
  text?: string;
  document?: TgMessage["document"];
  caption?: string;
}

/** Telegram callback query. */
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
  chat_instance?: string;
}

/** Telegram update object. */
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgChannelPost;
  edited_channel_post?: TgChannelPost;
  callback_query?: TgCallbackQuery;
  // Other update types we don't handle yet
  inline_query?: unknown;
  chosen_inline_result?: unknown;
  shipping_query?: unknown;
  pre_checkout_query?: unknown;
  poll?: unknown;
  poll_answer?: unknown;
  my_chat_member?: unknown;
  chat_member?: unknown;
  chat_join_request?: unknown;
  chat_boost?: unknown;
  removed_chat_boost?: unknown;
  business_connection?: unknown;
  business_message?: TgMessage;
  edited_business_message?: TgMessage;
  deleted_business_messages?: unknown;
}

// ─── Inline Keyboard Types ─────────────────────────────────

/** Telegram inline keyboard button. */
export interface TgInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

/** Telegram inline keyboard markup. */
export interface TgInlineKeyboardMarkup {
  inline_keyboard: TgInlineKeyboardButton[][];
}

// ─── Telegram API Method Parameters ────────────────────────

/** Parameters for sendMessage API call. */
export interface SendMessageParams {
  chat_id: number | string;
  text: string;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  reply_markup?: TgInlineKeyboardMarkup;
}

/** Parameters for answerCallbackQuery API call. */
export interface AnswerCallbackQueryParams {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}

/** Parameters for sendDocument API call. */
export interface SendDocumentParams {
  chat_id: number | string;
  document: string | Blob;
  caption?: string;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Extract the text content from a Telegram message.
 * Handles both direct text and caption (for documents).
 */
export function getMessageText(message: TgMessage | TgChannelPost): string {
  return message.text ?? message.caption ?? "";
}

/**
 * Extract the user ID from a message's `from` field.
 * Returns null for channel posts (which don't have `from`).
 */
export function getMessageUserId(
  message: TgMessage | TgChannelPost
): number | null {
  if ("from" in message) {
    return message.from?.id ?? null;
  }
  return null;
}

/**
 * Determine if a message is from a private chat.
 */
export function isPrivateChat(chat: TgChat): boolean {
  return chat.type === "private";
}

/**
 * Determine if a message is from a channel.
 */
export function isChannelChat(chat: TgChat): boolean {
  return chat.type === "channel";
}
