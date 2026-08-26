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
  handleCancel,
  handleListSub,
  handleDeleteSub,
  handleAutoFetch,
  executeCommand,
  getRegisteredCommands,
} from "../../src/telegram/commands";
import type { CommandContext } from "../../src/telegram/commands";
import type { TgMessage } from "../../src/telegram/types";
import { insertConfig } from "../../src/db/configs";
import { insertSource, updateSource, getSourceByChatId } from "../../src/db/sources";
import { registerFetch, isFetchActive, unregisterFetch } from "../../src/ingest/subscription";
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

  describe("/cancel", () => {
    it("should cancel a running fetch before checking upload state", async () => {
      const flowId = "command-cancel-flow";
      await registerFetch(flowId, 111111, 111111, db);

      await handleCancel(makeCtx(db, api, {
        message: makeMessage({ text: "/cancel" }),
      }));

      expect(api.sendMessageCalls[0].text).toContain("لغو دریافت");
      expect(isFetchActive(flowId)).toBe(true);
      await unregisterFetch(flowId, db, 111111);
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
      expect(commands.length).toBe(20);
    });
  });
});

async function insertTestSub(db: D1Database, chatId: number, title: string, subUrl: string) {
  await insertSource(db, {
    chat_id: chatId,
    title,
    type: "subscription",
    enabled: 1,
    trusted: 1,
  });
  await updateSource(db, chatId, {
    sub_url: subUrl,
    sub_status: "active",
    auto_fetch: 1,
  });
}

describe("/listsub + delete subscription", () => {
  let db: D1Database;
  let api: MockTelegramBotAPI;

  beforeEach(() => {
    db = createTestDB();
    api = new MockTelegramBotAPI();
  });

  it("listsub shows one delete button per subscription", async () => {
    await insertTestSub(db, 12345, "My Sub", "https://example.com/sub");

    await handleListSub(makeCtx(db, api));

    const msg = api.sendMessageCalls[0];
    expect(msg.text).toContain("My Sub");
    const kb = msg.reply_markup as { inline_keyboard: { callback_data?: string }[][] };
    const flat = kb.inline_keyboard.flat();
    expect(flat.some((b) => b.callback_data === "del_sub:12345")).toBe(true);
  });

  it("handleDeleteSub removes the subscription", async () => {
    await insertTestSub(db, 777, "Temp Sub", "https://x.com/sub");

    await handleDeleteSub(777, makeCtx(db, api));

    expect(api.sendMessageCalls.length).toBe(1);
    expect(api.sendMessageCalls[0].text).toContain("حذف شد");
    expect(await getSourceByChatId(db, 777)).toBeNull();
  });

  it("handleDeleteSub reports a missing subscription", async () => {
    await handleDeleteSub(999999, makeCtx(db, api));

    expect(api.sendMessageCalls.length).toBe(1);
    expect(api.sendMessageCalls[0].text).toContain("وجود ندارد");
  });

  it("handleDeleteSub rejects non-admin users", async () => {
    const message = makeMessage({
      from: { id: 999999, is_bot: false, first_name: "User" },
    });

    await handleDeleteSub(123, makeCtx(db, api, { message }));

    expect(api.sendMessageCalls.length).toBe(1);
    expect(api.sendMessageCalls[0].text).toContain("Access denied");
  });

  describe("/autofetch", () => {
    it("shows settings when invoked from a menu button (callback), not the menu text", async () => {
      const message = makeMessage({
        text: "📱 منوی اصلی\n\nیکی از عملیات زیر را انتخاب کنید:",
      });
      await handleAutoFetch(makeCtx(db, api, { message, isCallback: true }));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("تنظیمات دریافت خودکار");
      expect(api.sendMessageCalls[0].text).not.toContain("ناشناخته");
    });

    it("shows settings when no arguments are given", async () => {
      await handleAutoFetch(makeCtx(db, api, { message: makeMessage({ text: "/autofetch" }) }));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("تنظیمات دریافت خودکار");
    });

    it("shows unknown-option hint for an unrecognized typed subcommand", async () => {
      await handleAutoFetch(makeCtx(db, api, { message: makeMessage({ text: "/autofetch bogus" }) }));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("گزینه ناشناخته");
    });
  });
});
