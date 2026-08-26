/**
 * Tests — Telegram Update Routing
 *
 * Tests message routing, command parsing, channel_post, and callback_query.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { MockTelegramBotAPI } from "../../src/telegram/api";
import {
  processMessage,
  processChannelPost,
  processCallbackQuery,
} from "../../src/telegram/routing";
import type { TgMessage, TgChannelPost, TgCallbackQuery } from "../../src/telegram/types";
import { registerFetch, isFetchActive, unregisterFetch, getFetchAbortSignal } from "../../src/ingest/subscription";
import { MENU_CB } from "../../src/telegram/keyboard";

function makeAdminMessage(text: string): TgMessage {
  return {
    message_id: 1,
    from: { id: 111111, is_bot: false, first_name: "Admin" },
    date: Date.now(),
    chat: { id: 111111, type: "private" },
    text,
  };
}

function makeNonAdminMessage(text: string): TgMessage {
  return {
    message_id: 1,
    from: { id: 999999, is_bot: false, first_name: "User" },
    date: Date.now(),
    chat: { id: 999999, type: "private" },
    text,
  };
}

describe("Telegram Update Routing", () => {
  let db: D1Database;
  let api: MockTelegramBotAPI;
  const adminUserIds = "111111,222222";

  beforeEach(() => {
    db = createTestDB();
    api = new MockTelegramBotAPI();
  });

  describe("processMessage()", () => {
    it("should route /start command to handler", async () => {
      const message = makeAdminMessage("/start");
      await processMessage(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("V2Ray Aggregator");
    });

    it("should route /help command to handler", async () => {
      const message = makeAdminMessage("/help");
      await processMessage(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Available Commands");
    });

    it("should route /status command to handler", async () => {
      const message = makeAdminMessage("/status");
      await processMessage(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("System Status");
    });

    it("should handle command with @botname", async () => {
      const message = makeAdminMessage("/start@v2raybot");
      await processMessage(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("V2Ray Aggregator");
    });

    it("should handle command with arguments (stripped)", async () => {
      const message = makeAdminMessage("/status extra arg");
      await processMessage(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("System Status");
    });

    it("should respond to unknown commands with help hint", async () => {
      const message = makeAdminMessage("/unknown");
      await processMessage(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Unknown command");
      expect(api.sendMessageCalls[0].text).toContain("/help");
    });

    it("should not respond to unknown commands in non-private chats", async () => {
      const message: TgMessage = {
        message_id: 1,
        from: { id: 111111, is_bot: false, first_name: "Admin" },
        date: Date.now(),
        chat: { id: -100123, type: "supergroup" },
        text: "/unknown",
      };
      await processMessage(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(0);
    });

    it("should silently ignore non-command messages", async () => {
      const message = makeAdminMessage("Hello, this is random text");
      await processMessage(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(0);
    });

    it("should reject commands from non-admin users", async () => {
      const message = makeNonAdminMessage("/status");
      await processMessage(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });

    it("should handle case-insensitive commands", async () => {
      const message = makeAdminMessage("/START");
      await processMessage(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("V2Ray Aggregator");
    });
  });

  describe("processChannelPost()", () => {
    it("should silently accept channel posts (Phase 6 placeholder)", async () => {
      const post: TgChannelPost = {
        message_id: 1,
        date: Date.now(),
        chat: { id: -100123, type: "channel", title: "Test Channel" },
        text: "vless://test@server.com:443#Config",
      };

      // Should not throw
      await processChannelPost(post, db, api, adminUserIds);

      // No API calls expected (Phase 6)
      expect(api.sendMessageCalls.length).toBe(0);
    });
  });

  describe("processCallbackQuery()", () => {
    it("should hint to open a fresh menu for unknown/stale callback data", async () => {
      const callbackQuery: TgCallbackQuery = {
        id: "cb123",
        from: { id: 111111, is_bot: false, first_name: "Admin" },
        data: "operator:irancell",
      };

      await processCallbackQuery(callbackQuery, db, api, adminUserIds);

      // Old operator-selection buttons ("operator:") are stale — the user
      // gets a visible hint instead of a silent acknowledgement.
      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("/menu");
      expect(api.answerCallbackQueryCalls.length).toBe(1);
      expect(api.answerCallbackQueryCalls[0].callback_query_id).toBe("cb123");
    });

    it("should hint for stale menu actions", async () => {
      const callbackQuery: TgCallbackQuery = {
        id: "cb-old-menu",
        from: { id: 111111, is_bot: false, first_name: "Admin" },
        message: {
          message_id: 99,
          chat: { id: 111111, type: "private" },
          date: Date.now(),
        },
        data: "menu:oldaction",
      };

      await processCallbackQuery(callbackQuery, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("قدیمی");
      expect(api.answerCallbackQueryCalls.length).toBe(1);
    });

    it("should route menu:help callback to help handler (admin)", async () => {
      const callbackQuery: TgCallbackQuery = {
        id: "cb-help",
        from: { id: 111111, is_bot: false, first_name: "Admin" },
        message: {
          message_id: 10,
          chat: { id: 111111, type: "private" },
          date: Date.now(),
        },
        data: "menu:help",
      };

      await processCallbackQuery(callbackQuery, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Available Commands");
      expect(api.sendMessageCalls[0].text).not.toContain("Access denied");
    });

    it("should deny menu callback from non-admin user", async () => {
      const callbackQuery: TgCallbackQuery = {
        id: "cb-deny",
        from: { id: 999999, is_bot: false, first_name: "Hacker" },
        message: {
          message_id: 11,
          chat: { id: 999999, type: "private" },
          date: Date.now(),
        },
        data: "menu:fetch",
      };

      await processCallbackQuery(callbackQuery, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });

    it("should include a cancellation button when starting fetch", async () => {
      const callbackQuery: TgCallbackQuery = {
        id: "cb-loading",
        from: { id: 222222, is_bot: false, first_name: "Admin2" },
        message: {
          message_id: 12,
          chat: { id: 222222, type: "private" },
          date: Date.now(),
        },
        data: "menu:fetch",
      };

      await processCallbackQuery(callbackQuery, db, api, adminUserIds);

      expect(api.sendMessageCalls[0].reply_markup?.inline_keyboard[0][0].callback_data)
        .toMatch(new RegExp("^" + MENU_CB.FETCH_CANCEL_PREFIX));
    });

    it("should accept the legacy fetch cancellation callback", async () => {
      const flowId = "legacy-flow";
      await registerFetch(flowId, 111111, 111111, db);

      await processCallbackQuery({
        id: "cb-legacy-cancel",
        from: { id: 111111, is_bot: false, first_name: "Admin" },
        message: {
          message_id: 13,
          chat: { id: 111111, type: "private" },
          date: Date.now(),
        },
        data: "fetch:cancel:" + flowId,
      }, db, api, adminUserIds);

      expect(api.answerCallbackQueryCalls.at(-1)?.text).toContain("لغو");
      await unregisterFetch(flowId, db, 111111, "cancelled");
    });

    it("should cancel an owned fetch callback", async () => {
      const flowId = "owned-flow";
      await registerFetch(flowId, 111111, 111111, db);
      expect(isFetchActive(flowId)).toBe(true);
      const abortSignal = getFetchAbortSignal(flowId)!;
      expect(abortSignal.aborted).toBe(false);

      await processCallbackQuery({
        id: "cb-cancel",
        from: { id: 111111, is_bot: false, first_name: "Admin" },
        message: {
          message_id: 13,
          chat: { id: 111111, type: "private" },
          date: Date.now(),
        },
        data: MENU_CB.FETCH_CANCEL_PREFIX + flowId,
      }, db, api, adminUserIds);

      expect(api.answerCallbackQueryCalls.at(-1)?.text).toContain("لغو");
      expect(abortSignal.aborted).toBe(true);
      expect(isFetchActive(flowId)).toBe(true);
      await unregisterFetch(flowId, db, 111111);
    });

    it("should not cancel a fetch owned by another user", async () => {
      const flowId = "foreign-flow";
      await registerFetch(flowId, 222222, 222222, db);

      await processCallbackQuery({
        id: "cb-foreign-cancel",
        from: { id: 111111, is_bot: false, first_name: "Admin" },
        message: {
          message_id: 14,
          chat: { id: 222222, type: "private" },
          date: Date.now(),
        },
        data: MENU_CB.FETCH_CANCEL_PREFIX + flowId,
      }, db, api, adminUserIds);

      expect(api.answerCallbackQueryCalls.at(-1)?.text).toContain("فعال نیست");
      await unregisterFetch(flowId, db, 222222, "failed");
    });

    it("should not start another fetch for a duplicate menu click", async () => {
      const flowId = "already-running";
      await registerFetch(flowId, 222222, 222222, db);
      await processCallbackQuery({
        id: "cb-duplicate-fetch",
        from: { id: 222222, is_bot: false, first_name: "Admin2" },
        message: {
          message_id: 15,
          chat: { id: 222222, type: "private" },
          date: Date.now(),
        },
        data: "menu:fetch",
      }, db, api, adminUserIds);

      expect(api.sendMessageCalls[0].text).toContain("در حال اجراست");
      await unregisterFetch(flowId, db, 222222, "failed");
    });

    it("should route menu:fetch callback to fetch handler (admin)", async () => {
      const callbackQuery: TgCallbackQuery = {
        id: "cb-fetch",
        from: { id: 222222, is_bot: false, first_name: "Admin2" },
        message: {
          message_id: 12,
          chat: { id: 222222, type: "private" },
          date: Date.now(),
        },
        data: "menu:fetch",
      };

      await processCallbackQuery(callbackQuery, db, api, adminUserIds);

      // Fetch sends 2 messages: loading + result
      expect(api.sendMessageCalls.length).toBe(2);
      expect(api.sendMessageCalls.some(m => m.text.includes("Access denied"))).toBe(false);
    });
  });
});
