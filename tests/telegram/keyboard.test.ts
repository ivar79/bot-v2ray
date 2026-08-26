/**
 * Tests — Telegram Inline Keyboard Menu
 */

import { describe, it, expect } from "vitest";
import {
  buildMainMenuKeyboard,
  buildBackKeyboard,
  buildSendKeyboard,
  MENU_CB,
} from "../../src/telegram/keyboard";

describe("Telegram Keyboard", () => {
  describe("MENU_CB constants", () => {
    it("should have all required callback data keys", () => {
      expect(MENU_CB.ADD_SUB).toBeDefined();
      expect(MENU_CB.LIST_SUBS).toBeDefined();
      expect(MENU_CB.FETCH_NOW).toBeDefined();
      expect(MENU_CB.AUTO_FETCH).toBeDefined();
      expect(MENU_CB.HELP).toBeDefined();
      expect(MENU_CB.BACK).toBeDefined();
    });

    it("should have all callback_data values under 64 bytes", () => {
      const values = Object.values(MENU_CB);
      for (const val of values) {
        expect(new TextEncoder().encode(val).length).toBeLessThanOrEqual(64);
      }
    });

    it("should have unique callback_data values", () => {
      const values = Object.values(MENU_CB);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });

    it("should all start with menu: prefix", () => {
      const values = Object.values(MENU_CB);
      for (const val of values) {
        expect(val).toMatch(/^(menu|autofetch|sub|send):/);
      }
    });
  });

  describe("buildMainMenuKeyboard()", () => {
    it("should return a valid inline keyboard structure", () => {
      const kb = buildMainMenuKeyboard();
      expect(kb).toHaveProperty("inline_keyboard");
      expect(Array.isArray(kb.inline_keyboard)).toBe(true);
    });

    it("should have 4 rows of buttons", () => {
      const kb = buildMainMenuKeyboard();
      expect(kb.inline_keyboard.length).toBe(4);
    });

    it("should have 2 columns in every row", () => {
      const kb = buildMainMenuKeyboard();
      for (const row of kb.inline_keyboard) {
        expect(row.length).toBe(2);
      }
    });

    it("should have 8 buttons total", () => {
      const kb = buildMainMenuKeyboard();
      let count = 0;
      for (const row of kb.inline_keyboard) {
        count += row.length;
      }
      expect(count).toBe(8);
    });

    it("should have correct callback_data for each button", () => {
      const kb = buildMainMenuKeyboard();
      expect(kb.inline_keyboard[0][0].callback_data).toBe(MENU_CB.ADD_SUB);
      expect(kb.inline_keyboard[0][1].callback_data).toBe(MENU_CB.LIST_SUBS);
      expect(kb.inline_keyboard[1][0].callback_data).toBe(MENU_CB.FETCH_NOW);
      expect(kb.inline_keyboard[1][1].callback_data).toBe(MENU_CB.AUTO_FETCH);
      expect(kb.inline_keyboard[2][0].callback_data).toBe(MENU_CB.SEND);
      expect(kb.inline_keyboard[2][1].callback_data).toBe(MENU_CB.SET_REMARK);
      expect(kb.inline_keyboard[3][0].callback_data).toBe(MENU_CB.SET_WELCOME);
      expect(kb.inline_keyboard[3][1].callback_data).toBe(MENU_CB.HELP);
    });

    it("should have Persian text labels", () => {
      const kb = buildMainMenuKeyboard();
      const allText = kb.inline_keyboard.flat().map(b => b.text).join(" ");
      expect(allText).toContain("افزودن");
      expect(allText).toContain("لیست");
      expect(allText).toContain("دریافت");
      expect(allText).toContain("تنظیمات");
      expect(allText).toContain("راهنما");
      expect(allText).toContain("ارسال");
      expect(allText).toContain("قالب");
      expect(allText).toContain("خوش");
    });

    it("should have emoji prefixes on buttons", () => {
      const kb = buildMainMenuKeyboard();
      const allText = kb.inline_keyboard.flat().map(b => b.text).join(" ");
      expect(allText).toContain("➕");
      expect(allText).toContain("📋");
      expect(allText).toContain("🔄");
      expect(allText).toContain("⚙️");
      expect(allText).toContain("❓");
      expect(allText).toContain("📤");
      expect(allText).toContain("🏷️");
      expect(allText).toContain("👋");
    });
  });

  describe("buildBackKeyboard()", () => {
    it("should return a valid inline keyboard", () => {
      const kb = buildBackKeyboard();
      expect(kb).toHaveProperty("inline_keyboard");
      expect(kb.inline_keyboard.length).toBe(1);
    });

    it("should have 1 button with back callback", () => {
      const kb = buildBackKeyboard();
      expect(kb.inline_keyboard[0].length).toBe(1);
      expect(kb.inline_keyboard[0][0].callback_data).toBe(MENU_CB.BACK);
    });

    it("should have Persian back label", () => {
      const kb = buildBackKeyboard();
      expect(kb.inline_keyboard[0][0].text).toContain("بازگشت");
    });
  });

  describe("buildSendKeyboard()", () => {
    it("should return a valid inline keyboard", () => {
      const kb = buildSendKeyboard();
      expect(kb).toHaveProperty("inline_keyboard");
      expect(kb.inline_keyboard.length).toBe(3);
    });

    it("should have files, recent, all and cancel actions", () => {
      const kb = buildSendKeyboard();
      const flat = kb.inline_keyboard.flat().map((b) => b.callback_data);
      expect(flat).toContain(MENU_CB.SEND_FILES);
      expect(flat).toContain(MENU_CB.SEND_RECENT);
      expect(flat).toContain(MENU_CB.SEND_ALL);
      expect(flat).toContain(MENU_CB.SEND_CANCEL);
    });

    it("should have a back-to-menu button", () => {
      const kb = buildSendKeyboard();
      const flat = kb.inline_keyboard.flat().map((b) => b.callback_data);
      expect(flat).toContain(MENU_CB.BACK);
    });
  });
});
