/**
 * Tests -- Conversation State Machine
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { MockTelegramBotAPI } from "../../src/telegram/api";
import { dispatchConversationState } from "../../src/telegram/conversations";
import { setAdminState, getAdminState } from "../../src/db/admin-states";
import { insertSource } from "../../src/db/sources";
import type { TgMessage } from "../../src/telegram/types";

function makeMessage(text: string): TgMessage {
  return {
    message_id: 1,
    from: { id: 111111, is_bot: false, first_name: "Admin" },
    date: Date.now(),
    chat: { id: 111111, type: "private" },
    text,
  };
}

describe("Conversation State Machine", () => {
  let db: D1Database;
  let api: MockTelegramBotAPI;

  beforeEach(() => {
    db = createTestDB();
    api = new MockTelegramBotAPI();
  });

  describe("dispatchConversationState()", () => {
    it("should return false when user has no active state", async () => {
      const msg = makeMessage("hello");
      const result = await dispatchConversationState(msg, db, api, 111111);
      expect(result).toBe(false);
      expect(api.sendMessageCalls.length).toBe(0);
    });

    it("should return false for idle state", async () => {
      await setAdminState(db, 111111, "idle");
      const msg = makeMessage("hello");
      const result = await dispatchConversationState(msg, db, api, 111111);
      expect(result).toBe(false);
    });

    it("should return false for unknown state and clear it", async () => {
      await setAdminState(db, 111111, "unknown_state_name");
      const msg = makeMessage("hello");
      const result = await dispatchConversationState(msg, db, api, 111111);
      expect(result).toBe(false);
      const state = await getAdminState(db, 111111);
      expect(state?.state).toBe("idle");
    });

    it("should handle missing updated_at gracefully", async () => {
      // Edge case: state exists but updated_at is unexpected format
      await db.prepare("INSERT INTO admin_states (user_id, state, context, updated_at) VALUES (?, ?, ?, ?)").bind(222222, "awaiting_sub_url", "{\"flow\":\"test\"}", "bad-date").run();
      const msg = makeMessage("hello");
      // Should not crash
      const result = await dispatchConversationState(msg, db, api, 222222);
      expect(typeof result).toBe("boolean");
    });
  });

  describe("awaiting_sub_url state", () => {
    beforeEach(async () => {
      await setAdminState(db, 111111, "awaiting_sub_url", { flow: "addsub" });
    });

    it("should retry with error on invalid URL", async () => {
      const msg = makeMessage("not-a-url");
      const result = await dispatchConversationState(msg, db, api, 111111);
      expect(result).toBe(true);
      expect(api.sendMessageCalls[0].text).toContain("URL");
      const state = await getAdminState(db, 111111);
      expect(state?.state).toBe("awaiting_sub_url");
    });

    it("should transition to awaiting_sub_title on valid URL", async () => {
      const msg = makeMessage("https://example.com/sub.txt");
      const result = await dispatchConversationState(msg, db, api, 111111);
      expect(result).toBe(true);
      const state = await getAdminState(db, 111111);
      expect(state?.state).toBe("awaiting_sub_title");
      const ctx = JSON.parse(state!.context!);
      expect(ctx.url).toBe("https://example.com/sub.txt");
    });

    it("should complete with error for duplicate subscription", async () => {
      const urlHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("https://example.com/dup.txt"));
      const hashHex = Array.from(new Uint8Array(urlHash)).slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
      const sourceChatId = parseInt(hashHex, 16);
      await insertSource(db, { chat_id: sourceChatId, type: "subscription", enabled: 1, trusted: 1 });

      const msg = makeMessage("https://example.com/dup.txt");
      const result = await dispatchConversationState(msg, db, api, 111111);
      expect(result).toBe(true);
      const state = await getAdminState(db, 111111);
      expect(state?.state).toBe("idle");
    });
  });

  describe("awaiting_sub_title state", () => {
    beforeEach(async () => {
      await setAdminState(db, 111111, "awaiting_sub_title", { url: "https://example.com/new.txt" });
    });

    it("should create source with provided title", async () => {
      const msg = makeMessage("My Subscription");
      const result = await dispatchConversationState(msg, db, api, 111111);
      expect(result).toBe(true);
      expect(api.sendMessageCalls[0].text).toContain("My Subscription");
      const state = await getAdminState(db, 111111);
      expect(state?.state).toBe("idle");
    });

    it("should create source without title on /skip", async () => {
      const msg = makeMessage("/skip");
      const result = await dispatchConversationState(msg, db, api, 111111);
      expect(result).toBe(true);
      const state = await getAdminState(db, 111111);
      expect(state?.state).toBe("idle");
    });

    it("should clear state and warn if context is missing", async () => {
      await setAdminState(db, 111111, "awaiting_sub_title", {});
      const msg = makeMessage("Some title");
      const result = await dispatchConversationState(msg, db, api, 111111);
      expect(result).toBe(true);
      const state = await getAdminState(db, 111111);
      expect(state?.state).toBe("idle");
    });
  });
});
