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
    it("should acknowledge callback queries", async () => {
      const callbackQuery: TgCallbackQuery = {
        id: "cb123",
        from: { id: 111111, is_bot: false, first_name: "Admin" },
        data: "operator:irancell",
      };

      await processCallbackQuery(callbackQuery, db, api, adminUserIds);

      expect(api.answerCallbackQueryCalls.length).toBe(1);
      expect(api.answerCallbackQueryCalls[0].callback_query_id).toBe("cb123");
    });
  });
});
