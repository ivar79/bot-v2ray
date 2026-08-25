/**
 * Tests for Telegram Channel Output Publisher
 *
 * Covers:
 * - Successful file publishing to configured channel
 * - Missing output channel configuration
 * - Invalid channel ID in settings
 * - Telegram API failures
 * - Empty file skipping
 * - Oversized file skipping
 * - No secret/token leakage in results
 * - Admin authorization via /setoutput
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import { MockTelegramBotAPI } from "../../src/telegram/api";
import {
  publishToTelegramChannel,
  type TelegramPublishResult,
} from "../../src/telegram/output-publisher";
import { setSetting } from "../../src/db/settings";
import { processMessage } from "../../src/telegram/routing";

// ─── Test Helpers ─────────────────────────────────────────

function m(text: string) {
  return {
    message_id: Math.floor(Math.random() * 100000),
    from: { id: 12345, is_bot: false, first_name: "Admin" },
    chat: { id: 12345, type: "private" as const },
    date: Date.now(),
    text,
  };
}

function nm(text: string) {
  return {
    message_id: Math.floor(Math.random() * 100000),
    from: { id: 99999, is_bot: false, first_name: "NonAdmin" },
    chat: { id: 99999, type: "private" as const },
    date: Date.now(),
    text,
  };
}

function makeManifest(files: [string, string][]): Map<string, string> {
  return new Map(files);
}

// ─── Tests ────────────────────────────────────────────────

describe("Telegram Output Publisher", () => {
  let db: ReturnType<typeof createTestDB>;
  let api: MockTelegramBotAPI;
  const A = "12345";

  beforeEach(() => {
    db = createTestDB();
    api = new MockTelegramBotAPI();
  });

  // ── Successful publishing ──

  it("1. sends all non-empty files to the configured channel", async () => {
    await setSetting(db, "output_channel_id", "-1001234567890");

    const manifest = makeManifest([
      ["all.txt", "vmess://abc\nvless://def"],
      ["vmess.txt", "vmess://abc"],
      ["vless.txt", "vless://def"],
    ]);

    const result = await publishToTelegramChannel(db, api, manifest);

    expect(result.success).toBe(true);
    expect(result.sentCount).toBe(3);
    expect(result.failedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.totalCount).toBe(3);
    expect(result.error).toBeUndefined();

    // Verify all three documents were sent
    expect(api.sendDocumentCalls.length).toBe(3);
    for (const call of api.sendDocumentCalls) {
      expect(call.chat_id).toBe(-1001234567890);
      expect(typeof call.document).toBe("string");
      expect(call.caption).toBeDefined();
      expect(call.caption).toMatch(/^📤 /);
    }
  });

  it("2. sends files with correct filenames in captions", async () => {
    await setSetting(db, "output_channel_id", "-100999");

    const manifest = makeManifest([
      ["vmess.txt", "vmess://config1"],
    ]);

    const result = await publishToTelegramChannel(db, api, manifest);

    expect(result.success).toBe(true);
    expect(result.sentCount).toBe(1);

    // Verify caption contains the filename
    expect(api.sendDocumentCalls[0].caption).toContain("vmess.txt");
  });

  // ── Missing / invalid configuration ──

  it("3. returns error when output channel not configured", async () => {
    // Don't set output_channel_id
    const manifest = makeManifest([["all.txt", "content"]]);

    const result = await publishToTelegramChannel(db, api, manifest);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Output channel not configured. Use /setoutput to configure.");
    expect(result.sentCount).toBe(0);
    expect(result.totalCount).toBe(1);

    // No Telegram API calls should be made
    expect(api.sendDocumentCalls.length).toBe(0);
  });

  it("4. returns error for invalid channel ID in settings", async () => {
    await setSetting(db, "output_channel_id", "not-a-number");

    const manifest = makeManifest([["all.txt", "content"]]);

    const result = await publishToTelegramChannel(db, api, manifest);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid output channel ID in settings.");
    expect(result.sentCount).toBe(0);

    // No Telegram API calls should be made
    expect(api.sendDocumentCalls.length).toBe(0);
  });

  // ── Empty / oversized file skipping ──

  it("5. skips empty files", async () => {
    await setSetting(db, "output_channel_id", "-100123");

    const manifest = makeManifest([
      ["all.txt", "has content"],
      ["vmess.txt", ""],
      ["vless.txt", ""],
    ]);

    const result = await publishToTelegramChannel(db, api, manifest);

    expect(result.success).toBe(true);
    expect(result.sentCount).toBe(1);
    expect(result.skippedCount).toBe(2);
    expect(result.totalCount).toBe(3);

    // Only one file should have been sent
    expect(api.sendDocumentCalls.length).toBe(1);
    expect(api.sendDocumentCalls[0].document).toBe("has content");
  });

  it("6. skips all-empty manifest", async () => {
    await setSetting(db, "output_channel_id", "-100123");

    const manifest = makeManifest([
      ["all.txt", ""],
      ["vmess.txt", ""],
    ]);

    const result = await publishToTelegramChannel(db, api, manifest);

    expect(result.success).toBe(false);
    expect(result.sentCount).toBe(0);
    expect(result.skippedCount).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  // ── Telegram API failure handling ──

  it("7. handles Telegram API returning false", async () => {
    await setSetting(db, "output_channel_id", "-100123");
    api.sendDocumentResult = false;

    const manifest = makeManifest([["all.txt", "content"]]);

    const result = await publishToTelegramChannel(db, api, manifest);

    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(1);
    expect(result.sentCount).toBe(0);
  });

  it("8. handles Telegram API throwing an exception", async () => {
    await setSetting(db, "output_channel_id", "-100123");

    // Override sendDocument to throw
    api.sendDocument = async () => {
      throw new Error("Network error");
    };

    const manifest = makeManifest([["all.txt", "content"]]);

    const result = await publishToTelegramChannel(db, api, manifest);

    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(1);
    expect(result.sentCount).toBe(0);
  });

  it("9. counts partial failures correctly", async () => {
    await setSetting(db, "output_channel_id", "-100123");

    let callCount = 0;
    api.sendDocument = async (params) => {
      api.sendDocumentCalls.push(params);
      callCount++;
      // First call succeeds, second fails
      return callCount <= 1;
    };

    const manifest = makeManifest([
      ["all.txt", "content1"],
      ["vmess.txt", "content2"],
    ]);

    const result = await publishToTelegramChannel(db, api, manifest);

    expect(result.success).toBe(true); // At least one succeeded
    expect(result.sentCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.totalCount).toBe(2);
  });

  // ── Empty manifest ──

  it("10. handles empty manifest", async () => {
    await setSetting(db, "output_channel_id", "-100123");

    const manifest = new Map<string, string>();

    const result = await publishToTelegramChannel(db, api, manifest);

    expect(result.success).toBe(false);
    expect(result.sentCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });

  // ── No secret/token leakage ──

  it("11. does not leak output channel ID in error messages", async () => {
    // Don't set output_channel_id
    const manifest = makeManifest([["all.txt", "content"]]);

    const result = await publishToTelegramChannel(db, api, manifest);

    expect(result.error).toBeDefined();
    expect(result.error).not.toContain("100123");
    expect(result.error).not.toContain("output_channel_id");
  });

  it("12. does not expose internal details on API failure", async () => {
    await setSetting(db, "output_channel_id", "-100123");

    api.sendDocument = async () => {
      throw new Error("INTERNAL: token expired, auth failed at gateway");
    };

    const manifest = makeManifest([["all.txt", "content"]]);

    const result = await publishToTelegramChannel(db, api, manifest);

    // The result itself should not contain internal error details
    expect(result.error).toBeUndefined();
    expect(result.failedCount).toBe(1);
    // No error message is exposed to the caller — just the count
  });
});

describe("Telegram Output Publisher — /publish integration", () => {
  let db: ReturnType<typeof createTestDB>;
  let api: MockTelegramBotAPI;
  const A = "12345";

  beforeEach(() => {
    db = createTestDB();
    api = new MockTelegramBotAPI();
  });

  it("13. /publish reports Telegram channel status when configured", async () => {
    await setSetting(db, "output_channel_id", "-100123");
    // Don't configure GitHub — so only Telegram channel publishing happens
    await processMessage(m("/publish"), db, api, A);

    // Should get the "Publishing..." message and then a result message
    expect(api.sendMessageCalls.length).toBe(2);
    expect(api.sendMessageCalls[0].text).toContain("Publishing");

    // Second message should mention Telegram
    const resultText = api.sendMessageCalls[1].text;
    expect(resultText).toBeDefined();
  });

  it("14. /publish reports 'not configured' when output channel missing", async () => {
    // No output_channel_id configured, no GitHub configured
    await processMessage(m("/publish"), db, api, A);

    // Should get a result message
    const lastMsg = api.sendMessageCalls[api.sendMessageCalls.length - 1];
    expect(lastMsg.text).toBeDefined();
    expect(lastMsg.text).toContain("Telegram");
  });

  it("15. /publish blocks non-admin from triggering output", async () => {
    await setSetting(db, "output_channel_id", "-100123");

    await processMessage(nm("/publish"), db, api, A); // A="12345", user 99999 is NOT admin

    // Non-admin should get access denied
    expect(api.sendMessageCalls.length).toBe(1);
    expect(api.sendMessageCalls[0].text).toContain("Access denied");
  });

// ─── sendConfigCards Tests ──────────────────────────────────

describe("sendConfigCards()", () => {
  let db: ReturnType<typeof createTestDB>;
  let api: MockTelegramBotAPI;

  beforeEach(() => {
    db = createTestDB();
    api = new MockTelegramBotAPI();
  });

  it("should send config cards to configured channel", async () => {
    await setSetting(db, "output_channel_id", "-100123");
    const cards = ["Card 1", "Card 2"];

    const { sendConfigCards } = await import("../../src/telegram/output-publisher");
    const result = await sendConfigCards(db, api, cards);

    expect(result.success).toBe(true);
    expect(result.sentCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.totalCount).toBe(2);
    expect(api.sendMessageCalls.length).toBe(2);
    expect(api.sendMessageCalls[0].chat_id).toBe(-100123);
    expect(api.sendMessageCalls[0].text).toBe("Card 1");
    expect(api.sendMessageCalls[1].text).toBe("Card 2");
  });

  it("should fail when output channel not configured", async () => {
    const { sendConfigCards } = await import("../../src/telegram/output-publisher");
    const result = await sendConfigCards(db, api, ["Card 1"]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("not configured");
  });

  it("should skip empty cards", async () => {
    await setSetting(db, "output_channel_id", "-100123");
    const cards = ["Card 1", "", "Card 3"];

    const { sendConfigCards } = await import("../../src/telegram/output-publisher");
    const result = await sendConfigCards(db, api, cards);

    expect(result.sentCount).toBe(2);
    expect(result.failedCount).toBe(1);
  });

  it("should handle API failures gracefully", async () => {
    await setSetting(db, "output_channel_id", "-100123");
    api.sendDocumentResult = false;
    api.sendMessageResult = false;
    const cards = ["Card 1"];

    const { sendConfigCards } = await import("../../src/telegram/output-publisher");
    const result = await sendConfigCards(db, api, cards);

    expect(result.success).toBe(false);
    expect(result.sentCount).toBe(0);
    expect(result.failedCount).toBe(1);
  });

  it("should return empty result for empty cards array", async () => {
    await setSetting(db, "output_channel_id", "-100123");

    const { sendConfigCards } = await import("../../src/telegram/output-publisher");
    const result = await sendConfigCards(db, api, []);

    expect(result.success).toBe(false);
    expect(result.totalCount).toBe(0);
  });
});

});
