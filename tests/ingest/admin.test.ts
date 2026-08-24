/**
 * Tests — Admin Upload Orchestration
 *
 * Tests text upload, document upload, and operator selection flow.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { MockTelegramBotAPI } from "../../src/telegram/api";
import {
  handleTextUpload,
  handleDocumentUpload,
  handleOperatorSelection,
} from "../../src/ingest/admin";
import {
  getAdminState,
  clearAdminState,
} from "../../src/db/admin-states";
import { countConfigs } from "../../src/db/configs";
import type { TgMessage } from "../../src/telegram/types";

function makeAdminMessage(text: string): TgMessage {
  return {
    message_id: 1,
    from: { id: 111111, is_bot: false, first_name: "Admin" },
    date: Date.now(),
    chat: { id: 111111, type: "private" },
    text,
  };
}

function makeDocMessage(fileName: string, fileId: string, fileSize?: number): TgMessage {
  return {
    message_id: 2,
    from: { id: 111111, is_bot: false, first_name: "Admin" },
    date: Date.now(),
    chat: { id: 111111, type: "private" },
    document: {
      file_id: fileId,
      file_name: fileName,
      mime_type: "text/plain",
      file_size: fileSize,
    },
  };
}

describe("Admin Upload Orchestration", () => {
  let db: D1Database;
  let api: MockTelegramBotAPI;
  const adminUserIds = "111111,222222";

  beforeEach(() => {
    db = createTestDB();
    api = new MockTelegramBotAPI();
  });

  describe("handleTextUpload()", () => {
    it("should reject non-admin users", async () => {
      const message = makeAdminMessage("vless://test@server.com:443");
      message.from = { id: 999999, is_bot: false, first_name: "User" };

      await handleTextUpload(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });

    it("should create batch and ask for operator when configs found", async () => {
      const message = makeAdminMessage(
        "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443?security=tls#Test"
      );

      await handleTextUpload(message, db, api, adminUserIds);

      // Should send operator selection keyboard
      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Configs received");
      expect(api.sendMessageCalls[0].text).toContain("operator");
      expect(api.sendMessageCalls[0].reply_markup).toBeDefined();
      expect(api.sendMessageCalls[0].reply_markup!.inline_keyboard.length).toBe(3);

      // Should set admin state
      const state = await getAdminState(db, 111111);
      expect(state).not.toBeNull();
      expect(state!.state).toBe("awaiting_operator");
    });

    it("should inform admin when no configs found", async () => {
      const message = makeAdminMessage("Hello, no configs here!");

      await handleTextUpload(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("No supported configuration");
    });
  });

  describe("handleDocumentUpload()", () => {
    it("should reject non-admin users", async () => {
      const message = makeDocMessage("configs.txt", "file123");
      message.from = { id: 999999, is_bot: false, first_name: "User" };

      await handleDocumentUpload(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });

    it("should download and process document with configs", async () => {
      const message = makeDocMessage("configs.txt", "file123");

      // Mock file retrieval
      api.fileResults.set("file123", {
        file_id: "file123",
        file_unique_id: "unique123",
        file_size: 100,
        file_path: "documents/file123.txt",
      });
      api.fileContents.set(
        "documents/file123.txt",
        "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#Test"
      );

      await handleDocumentUpload(message, db, api, adminUserIds);

      // Should send operator selection
      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("File received");
      expect(api.sendMessageCalls[0].text).toContain("operator");
    });

    it("should reject oversized files", async () => {
      const message = makeDocMessage("huge.txt", "file456", 25 * 1024 * 1024);

      await handleDocumentUpload(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("too large");
    });

    it("should handle file download failure", async () => {
      const message = makeDocMessage("configs.txt", "file789");
      // Don't set up mock file — getFile will return null

      await handleDocumentUpload(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Failed to retrieve");
    });

    it("should handle file with no configs", async () => {
      const message = makeDocMessage("empty.txt", "file_empty");

      api.fileResults.set("file_empty", {
        file_id: "file_empty",
        file_unique_id: "unique_empty",
        file_size: 50,
        file_path: "documents/file_empty.txt",
      });
      api.fileContents.set("documents/file_empty.txt", "Just plain text, no configs here.");

      await handleDocumentUpload(message, db, api, adminUserIds);

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("No supported configuration");
    });
  });

  describe("handleOperatorSelection()", () => {
    it("should process batch with selected operator", async () => {
      // First, initiate an upload to create the state
      const uploadMsg = makeAdminMessage(
        "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#Test"
      );
      await handleTextUpload(uploadMsg, db, api, adminUserIds);

      // Reset API calls
      api.reset();

      // Select operator
      await handleOperatorSelection(
        "cb123",
        "irancell",
        111111,
        111111,
        db,
        api
      , adminUserIds);

      // Should acknowledge callback
      expect(api.answerCallbackQueryCalls.length).toBe(1);

      // Should send summary
      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Batch processed");
      expect(api.sendMessageCalls[0].text).toContain("irancell");
      expect(api.sendMessageCalls[0].text).toContain("New: 1");

      // Should clear admin state
      const state = await getAdminState(db, 111111);
      expect(state!.state).toBe("idle");

      // Should have stored the config
      expect(await countConfigs(db)).toBe(1);
    });

    it("should reject invalid operator", async () => {
      await handleOperatorSelection(
        "cb123",
        "invalid_operator",
        111111,
        111111,
        db,
        api
      , adminUserIds);

      expect(api.answerCallbackQueryCalls.length).toBe(1);
      expect(api.answerCallbackQueryCalls[0].text).toContain("Invalid operator");
    });

    it("should reject when no pending upload", async () => {
      await handleOperatorSelection(
        "cb123",
        "irancell",
        111111, // admin user with no pending state
        111111,
        db,
        api
      , adminUserIds);

      expect(api.answerCallbackQueryCalls.length).toBe(1);
      expect(api.answerCallbackQueryCalls[0].text).toContain("No pending upload");
    });

    it("should handle all valid operators", async () => {
      const validOps = ["irancell", "mci", "rightel", "mokhaberat", "other", "unknown"];

      for (const op of validOps) {
        // Create fresh state for each operator
        const msg = makeAdminMessage("vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#" + op);
        await handleTextUpload(msg, db, api, adminUserIds);
        api.reset();

        const state = await getAdminState(db, 111111);
        if (state?.state === "awaiting_operator") {
          await handleOperatorSelection("cb_" + op, op, 111111, 111111, db, api, adminUserIds);
          // Clear state for next iteration
          await clearAdminState(db, 111111);
        }
      }

      // All operators should have been processed
      expect(await countConfigs(db)).toBeGreaterThanOrEqual(1);
    });
  });
});
