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
  HELP:       "menu:help",
  BACK:       "menu:back",
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
