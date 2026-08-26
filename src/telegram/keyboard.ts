/**
 * Telegram Inline Keyboard Menu
 *
 * Builds inline keyboard layouts for mobile-friendly bot interaction.
 * Pure functions — no side effects, no database calls.
 */

import type { TgInlineKeyboardMarkup } from "./types";

// ─── Callback Data Constants ───────────────────────────────

/**
 * Callback data prefixes for menu button presses.
 * All values are < 20 bytes (well under Telegram's 64-byte limit).
 */
export const MENU_CB = {
  ADD_SUB:    "menu:addsub",
  LIST_SUBS:  "menu:listsub",
  FETCH_NOW:  "menu:fetch",
  AUTO_FETCH: "menu:autofetch",
  SEND:       "menu:send",
  SET_REMARK: "menu:setremark",
  SET_WELCOME: "menu:setwelcome",
  HELP:       "menu:help",
  BACK:       "menu:back",
  // Send-to-channel actions
  SEND_FILES:   "send:files",
  SEND_RECENT:  "send:recent",
  SEND_ALL:     "send:all",
  SEND_CANCEL:  "send:cancel",
  // Autofetch sub-actions
  AF_ON:      "autofetch:on",
  AF_OFF:     "autofetch:off",
  AF_INT_6:   "autofetch:interval:6",
  AF_INT_12:  "autofetch:interval:12",
  AF_INT_24:  "autofetch:interval:24",
  // Sub flow
  SUB_CANCEL: "sub:cancel",
  FETCH_CANCEL_PREFIX: "menu:fetchcancel:",
} as const;

// ─── Keyboard Builders ────────────────────────────────────

/**
 * Build the main menu inline keyboard.
 *
 * Layout (2-column, mobile-friendly):
 * [➕ افزودن اشتراک]  [📋 لیست اشتراک‌ها]
 * [🔄 دریافت الآن]    [⚙️ تنظیمات خودکار]
 * [❓ راهنما]
 */
export function buildMainMenuKeyboard(): TgInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "➕ افزودن اشتراک", callback_data: MENU_CB.ADD_SUB },
        { text: "📋 لیست اشتراک‌ها", callback_data: MENU_CB.LIST_SUBS },
      ],
      [
        { text: "🔄 دریافت الآن", callback_data: MENU_CB.FETCH_NOW },
        { text: "⚙️ تنظیمات خودکار", callback_data: MENU_CB.AUTO_FETCH },
      ],
      [
        { text: "📤 ارسال به کانال", callback_data: MENU_CB.SEND },
        { text: "🏷️ قالب نام", callback_data: MENU_CB.SET_REMARK },
      ],
      [
        { text: "👋 پیام خوش‌آمد", callback_data: MENU_CB.SET_WELCOME },
        { text: "❓ راهنما", callback_data: MENU_CB.HELP },
      ],
    ],
  };
}

/**
 * Build a "back to menu" keyboard.
 * Shown after sub-actions to allow navigation back.
 */
export function buildBackKeyboard(): TgInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "◀️ بازگشت به منو", callback_data: MENU_CB.BACK }],
    ],
  };
}

// ─── Auto Fetch Settings Keyboard ─────────────────────────

/**
 * Build the auto-fetch settings inline keyboard.
 * Shown when user taps ⚙️ button (no typing required).
 */
export function buildAutoFetchKeyboard(): TgInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ فعال کردن", callback_data: MENU_CB.AF_ON },
        { text: "❌ غیرفعال کردن", callback_data: MENU_CB.AF_OFF },
      ],
      [
        { text: "⏱️ ۶ ساعت", callback_data: MENU_CB.AF_INT_6 },
        { text: "⏱️ ۱۲ ساعت", callback_data: MENU_CB.AF_INT_12 },
        { text: "⏱️ ۲۴ ساعت", callback_data: MENU_CB.AF_INT_24 },
      ],
      [
        { text: "◀️ بازگشت به منو", callback_data: MENU_CB.BACK },
      ],
    ],
  };
}

// ─── Sub Cancel Keyboard ──────────────────────────────────

/**
 * Build a cancel keyboard for sub conversation flow.
 */
export function buildFetchLoadingKeyboard(flowId: string): TgInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "❌ لغو دریافت", callback_data: MENU_CB.FETCH_CANCEL_PREFIX + flowId }],
    ],
  };
}

export function buildSubPromptKeyboard(): TgInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "❌ لغو", callback_data: MENU_CB.SUB_CANCEL }],
    ],
  };
}

// ─── Send-to-Channel Keyboard ─────────────────────────────

/**
 * Build the send-to-channel inline keyboard.
 * Shown when admin taps 📤 button or uses /send.
 */
export function buildSendKeyboard(): TgInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "📄 ارسال فایل‌ها", callback_data: MENU_CB.SEND_FILES },
        { text: "🆕 کانفیگ‌های اخیر", callback_data: MENU_CB.SEND_RECENT },
      ],
      [
        { text: "🗂️ همه کانفیگ‌ها", callback_data: MENU_CB.SEND_ALL },
        { text: "❌ لغو", callback_data: MENU_CB.SEND_CANCEL },
      ],
      [
        { text: "◀️ بازگشت به منو", callback_data: MENU_CB.BACK },
      ],
    ],
  };
}
