/**
 * Conversation State Machine
 *
 * Manages multi-step conversational flows for admin interactions.
 * Each state has a typed handler that processes user text input and returns
 * a result: complete, transition to next state, or retry.
 *
 * Centralized in this module for testability and reusability.
 * Uses the existing admin_states D1 table — no new tables needed.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { TelegramBotAPI } from "./api";
import type { TgMessage, TgInlineKeyboardMarkup } from "./types";
import { getMessageText } from "./types";
import { getAdminState, setAdminState, clearAdminState } from "../db/admin-states";
import { getSourceByChatId, insertSource, updateSource } from "../db/sources";
import { buildSubPromptKeyboard, buildBackKeyboard } from "./keyboard";

// ─── Types ─────────────────────────────────

/** Context passed to conversation state handlers. */
export interface ConversationCtx {
  db: D1Database;
  api: TelegramBotAPI;
  chatId: number;
  userId: number;
  context: Record<string, unknown> | null;
}

/** Result of processing user input in a conversation state. */
export type StateResult =
  | {
      action: "complete";
      reply: string;
      replyMarkup?: TgInlineKeyboardMarkup;
    }
  | {
      action: "transition";
      nextState: string;
      context?: Record<string, unknown>;
      reply: string;
      replyMarkup?: TgInlineKeyboardMarkup;
    }
  | {
      action: "retry";
      reply: string;
      replyMarkup?: TgInlineKeyboardMarkup;
    };

/** A registered conversation state with its handler. */
interface ConversationState {
  handleInput: (text: string, ctx: ConversationCtx) => Promise<StateResult>;
}

// ─── State Registry ─────────────────────────────

const CONVERSATION_STATES: Record<string, ConversationState> = {
  awaiting_sub_url: { handleInput: handleSubUrlInput },
  awaiting_sub_title: { handleInput: handleSubTitleInput },
};

// ─── State Timeout ────────────────────────────────

/** States expire after 1 hour of inactivity. */
const STATE_TIMEOUT_MS = 60 * 60 * 1000;

// ─── Dispatch ──────────────────────────────────

/**
 * Check and dispatch conversation state for a user.
 * Returns true if the message was handled as conversation input.
 * Returns false if the user has no active conversation state.
 */
export async function dispatchConversationState(
  message: TgMessage,
  db: D1Database,
  api: TelegramBotAPI,
  userId: number
): Promise<boolean> {
  const state = await getAdminState(db, userId);
  if (!state || state.state === "idle") return false;

  const chatId = message.chat.id;
  const stateAge = Date.now() - new Date(state.updated_at).getTime();

  // Expire stale states
  if (stateAge > STATE_TIMEOUT_MS) {
    await clearAdminState(db, userId);
    await api.sendMessage({
      chat_id: chatId,
      text: "\u23f0 \u0632\u0645\u0627\u0646 \u0627\u0646\u062a\u0638\u0627\u0631 \u0645\u0646\u0642\u0636\u06cc \u0634\u062f. \u062f\u0648\u0628\u0627\u0631\u0647 \u062a\u0644\u0627\u0634 \u06a9\u0646\u06cc\u062f",
      reply_markup: buildBackKeyboard(),
    });
    return true;
  }

  const handler = CONVERSATION_STATES[state.state];
  if (!handler) {
    // Unknown state -- clear and let normal routing handle the message
    await clearAdminState(db, userId);
    return false;
  }

  const context = state.context
    ? (JSON.parse(state.context) as Record<string, unknown>)
    : null;
  const text = getMessageText(message).trim();

  const result = await handler.handleInput(text, {
    db, api, chatId, userId, context,
  });

  switch (result.action) {
    case "complete":
      await clearAdminState(db, userId);
      await api.sendMessage({
        chat_id: chatId,
        text: result.reply, parse_mode: "HTML",
        reply_markup: result.replyMarkup ?? buildBackKeyboard(),
      });
      break;

    case "transition":
      await setAdminState(db, userId, result.nextState, result.context ?? null);
      await api.sendMessage({
        chat_id: chatId,
        text: result.reply, parse_mode: "HTML",
        reply_markup: result.replyMarkup ?? buildSubPromptKeyboard(),
      });
      break;

    case "retry":
      // State unchanged -- let user try again
      await api.sendMessage({
        chat_id: chatId,
        text: result.reply, parse_mode: "HTML",
        reply_markup: result.replyMarkup ?? buildSubPromptKeyboard(),
      });
      break;
  }
  return true;
}

// ─── State Handlers ────────────────────────────

/**
 * Handle user input while in "awaiting_sub_url" state.
 * Validates the URL, checks for duplicates, then transitions to title step.
 */
async function handleSubUrlInput(
  text: string, ctx: ConversationCtx
): Promise<StateResult> {
  let url: URL;
  try { url = new URL(text); } catch {
    return { action: "retry", reply: "\u26a0\ufe0f \u0644\u06cc\u0646\u06a9 \u0645\u0639\u062a\u0628\u0631 \u0646\u06cc\u0633\u062a. \u0644\u0637\u0641\u0627\u064b \u06cc\u06a9 URL \u0635\u062d\u06cc\u062d \u0627\u0631\u0633\u0627\u0644 \u06a9\u0646\u06cc\u062f.", replyMarkup: buildSubPromptKeyboard() };
  }

  // Check for duplicate subscription
  const urlHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.href));
  const hashHex = Array.from(new Uint8Array(urlHash)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  const sourceChatId = parseInt(hashHex, 16);

  const existing = await getSourceByChatId(ctx.db, sourceChatId);
  if (existing) {
    return { action: "complete", reply: "\u2139\ufe0f \u0627\u06cc\u0646 \u0627\u0634\u062a\u0631\u0627\u06a9 \u0642\u0628\u0644\u0627\u064b \u0627\u0636\u0627\u0641\u0647 \u0634\u062f\u0647 \u0627\u0633\u062a.", replyMarkup: buildBackKeyboard() };
  }

  // URL is valid and unique — transition to title step
  return {
    action: "transition", nextState: "awaiting_sub_title",
    context: { url: url.href },
    reply: [
      "\u2705 \u0644\u06cc\u0646\u06a9 \u062f\u0631\u06cc\u0627\u0641\u062a \u0634\u062f!",
      "",
      "\ud83d\udccc \u0646\u0627\u0645 \u0627\u062e\u062a\u0635\u0627\u0635\u06cc (\u0627\u062e\u062a\u06cc\u0627\u0631\u06cc):",
      "\u06cc\u06a9 \u0646\u0627\u0645 \u0627\u0631\u0633\u0627\u0644 \u06a9\u0646\u06cc\u062f \u06cc\u0627 /skip \u0628\u0632\u0646\u06cc\u062f",
    ].join("\n"),
    replyMarkup: buildSubPromptKeyboard(),
  };
}

/**
 * Handle user input while in "awaiting_sub_title" state.
 * Accepts a title string or /skip to skip, then creates the source.
 */
async function handleSubTitleInput(
  text: string, ctx: ConversationCtx
): Promise<StateResult> {
  const url = ctx.context?.url as string | undefined;
  if (!url) {
    return { action: "complete", reply: "\u26a0\ufe0f \u062e\u0637\u0627. /addsub \u062f\u0648\u0628\u0627\u0631\u0647 \u062a\u0644\u0627\u0634 \u06a9\u0646\u06cc\u062f.", replyMarkup: buildBackKeyboard() };
  }

  const title = text === "/skip" ? undefined : text || undefined;

  try {
    const urlHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
    const hashHex = Array.from(new Uint8Array(urlHash)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
    const sourceChatId = parseInt(hashHex, 16);

    await insertSource(ctx.db, {
      chat_id: sourceChatId, title, type: "subscription", enabled: 1, trusted: 1,
    });
    await updateSource(ctx.db, sourceChatId, {
      sub_url: url, sub_status: "active", auto_fetch: 1,
    });

    const displayTitle = title || url.substring(0, 40);
    return {
      action: "complete",
      reply: [
        "\u2705 \u0627\u0634\u062a\u0631\u0627\u06a9 \u0627\u0636\u0627\u0641\u0647 \u0634\u062f!",
        "",
        "\ud83d\udccc " + displayTitle,
        "\ud83d\udd17 " + url,
        "",
        "\u26a1 \u062f\u0631\u06cc\u0627\u0641\u062a \u062e\u0648\u062f\u06a9\u0627\u0631: \u0641\u0639\u0627\u0644",
      ].join("\n"),
      replyMarkup: buildBackKeyboard(),
    };
  } catch {
    return { action: "complete", reply: "\u26a0\ufe0f \u062e\u0637\u0627 \u062f\u0631 \u0627\u0636\u0627\u0641\u0647.", replyMarkup: buildBackKeyboard() };
  }
}
