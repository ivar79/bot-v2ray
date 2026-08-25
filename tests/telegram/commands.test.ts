/**
 * Tests — Command Handlers
 *
 * Tests /start, /help, /status and admin-only access.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { MockTelegramBotAPI } from "../../src/telegram/api";
import {
  handleStart,
  handleHelp,
  handleStatus,
  executeCommand,
  getRegisteredCommands,
} from "../../src/telegram/commands";
import type { CommandContext } from "../../src/telegram/commands";
import type { TgMessage } from "../../src/telegram/types";
import { insertConfig } from "../../src/db/configs";
import { insertSource } from "../../src/db/sources";

function makeMessage(overrides: Partial<TgMessage> = {}): TgMessage {
  return {
    message_id: 1,
    from: { id: 111111, is_bot: false, first_name: "Admin" },
    date: Date.now(),
    chat: { id: 111111, type: "private" },
    text: "/start",
    ...overrides,
  };
}

function makeCtx(
  db: D1Database,
  api: MockTelegramBotAPI,
  overrides: Partial<CommandContext> = {}
): CommandContext {
  return {
    db,
    api,
    adminUserIds: "111111,222222",
    message: makeMessage(),
    ...overrides,
  };
}

describe("Command Handlers", () => {
  let db: D1Database;
  let api: MockTelegramBotAPI;

  beforeEach(() => {
    db = createTestDB();
    api = new MockTelegramBotAPI();
  });

  describe("/start", () => {
    it("should send welcome message to admin", async () => {
      await handleStart(makeCtx(db, api));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("V2Ray Aggregator");
      expect(api.sendMessageCalls[0].parse_mode).toBe("HTML");
    });

    it("should reject non-admin users", async () => {
      const message = makeMessage({
        from: { id: 999999, is_bot: false, first_name: "User" },
      });
      await handleStart(makeCtx(db, api, { message }));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });

    it("should not auto-promote first user to admin", async () => {
      const message = makeMessage({
        from: { id: 333333, is_bot: false, first_name: "NewUser" },
      });
      await handleStart(makeCtx(db, api, { message, adminUserIds: undefined }));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });
  });

  describe("/help", () => {
    it("should send help message to admin", async () => {
      await handleHelp(makeCtx(db, api));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Available Commands");
      expect(api.sendMessageCalls[0].text).toContain("/start");
      expect(api.sendMessageCalls[0].text).toContain("/help");
      expect(api.sendMessageCalls[0].text).toContain("/status");
    });

    it("should reject non-admin users", async () => {
      const message = makeMessage({
        from: { id: 999999, is_bot: false, first_name: "User" },
      });
      await handleHelp(makeCtx(db, api, { message }));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });
  });

  describe("/status", () => {
    it("should send status with stats to admin", async () => {
      // Add some test data
      await insertConfig(db, {
        protocol: "vless",
        raw: "vless://test@server.com:443",
        canonical: "vless://test@server.com:443/",
        config_hash: "hash1",
      });
      await insertSource(db, { chat_id: -100111 });

      await handleStatus(makeCtx(db, api));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("System Status");
      expect(api.sendMessageCalls[0].text).toContain("Configurations: 1");
      expect(api.sendMessageCalls[0].text).toContain("Sources: 1");
    });

    it("should reject non-admin users", async () => {
      const message = makeMessage({
        from: { id: 999999, is_bot: false, first_name: "User" },
      });
      await handleStatus(makeCtx(db, api, { message }));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });

    it("should handle database errors gracefully", async () => {
      // Use a broken db mock that throws
      const brokenDb = {
        prepare: () => ({
          bind: () => ({
            first: () => { throw new Error("DB error"); },
          }),
        }),
      } as unknown as D1Database;

      await handleStatus(makeCtx(brokenDb, api));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Error");
    });
  });

  describe("executeCommand()", () => {
    it("should execute known commands", async () => {
      const result = await executeCommand("start", makeCtx(db, api));
      expect(result).toBe(true);
      expect(api.sendMessageCalls.length).toBe(1);
    });

    it("should return false for unknown commands", async () => {
      const result = await executeCommand("unknown", makeCtx(db, api));
      expect(result).toBe(false);
      expect(api.sendMessageCalls.length).toBe(0);
    });
  });

  describe("getRegisteredCommands()", () => {
    it("should return all registered commands", () => {
      const commands = getRegisteredCommands();
      expect(commands).toContain("start");
      expect(commands).toContain("help");
      expect(commands).toContain("status");
      expect(commands).toContain("upload");
      expect(commands).toContain("cancel");
      expect(commands).toContain("addsource");
      expect(commands).toContain("removesource");
      expect(commands).toContain("sources");
      expect(commands).toContain("generate");
      expect(commands).toContain("publish");
      expect(commands).toContain("setgithub");
      expect(commands).toContain("setoutput");
      expect(commands.length).toBe(13);
    });
  });
});
