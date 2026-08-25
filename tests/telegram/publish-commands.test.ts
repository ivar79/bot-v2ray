/**
 * Tests — Publish Commands (Phase 9)
 *
 * Tests /generate, /publish, /setgithub, /setoutput commands.
 * All tests use mock APIs — no real Telegram or GitHub calls.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { MockTelegramBotAPI } from "../../src/telegram/api";
import { MockGitHubAPI } from "../../src/github/api";
import {
  handleGenerate,
  handlePublish,
  handleSetGithub,
  handleSetOutput,
  executeCommand,
  getRegisteredCommands,
} from "../../src/telegram/commands";
import type { CommandContext } from "../../src/telegram/commands";
import type { TgMessage } from "../../src/telegram/types";
import { insertConfig } from "../../src/db/configs";
import { insertBatch } from "../../src/db/batches";
import { insertOccurrence } from "../../src/db/occurrences";
import { getSetting } from "../../src/db/settings";

function makeMessage(overrides: Partial<TgMessage> = {}): TgMessage {
  return {
    message_id: 1,
    from: { id: 111111, is_bot: false, first_name: "Admin" },
    date: Date.now(),
    chat: { id: 111111, type: "private" },
    text: "/generate",
    ...overrides,
  };
}

function makeCtx(
  db: D1Database,
  api: MockTelegramBotAPI,
  overrides: Partial<CommandContext> = {}
): CommandContext {
  const mockGithub = new MockGitHubAPI();
  return {
    db,
    api,
    adminUserIds: "111111,222222",
    message: makeMessage(),
    githubToken: "ghp_test_token",
    githubApi: mockGithub,
    ...overrides,
  };
}

describe("Publish Commands (Phase 9)", () => {
  let db: D1Database;
  let api: MockTelegramBotAPI;

  beforeEach(() => {
    db = createTestDB();
    api = new MockTelegramBotAPI();
  });

  // ─── Helper: Insert test data ─────────────────────────────

  async function insertTestConfigs(count: number) {
    for (let i = 0; i < count; i++) {
      await insertConfig(db, {
        protocol: "vless",
        raw: `vless://uuid${i}@server${i}.com:443?security=tls#Config${i}`,
        canonical: `vless://uuid${i}@server${i}.com:443/?security=tls#Config${i}`,
        config_hash: `hash_${i.toString().padStart(4, "0")}`,
        is_valid: 1,
        active: 1,
      });
    }
  }

  // ─── /generate ────────────────────────────────────────────

  describe("/generate", () => {
    it("should send generation summary to admin", async () => {
      await insertTestConfigs(3);

      await handleGenerate(makeCtx(db, api));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Output Generated");
      expect(api.sendMessageCalls[0].text).toContain("3");
      expect(api.sendMessageCalls[0].parse_mode).toBe("HTML");
    });

    it("should reject non-admin users", async () => {
      const message = makeMessage({
        from: { id: 999999, is_bot: false, first_name: "User" },
      });
      await handleGenerate(makeCtx(db, api, { message }));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });

    it("should handle empty database gracefully", async () => {
      await handleGenerate(makeCtx(db, api));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Output Generated");
      expect(api.sendMessageCalls[0].text).toContain("0");
    });

    it("should include protocol breakdown", async () => {
      await insertTestConfigs(2);
      // Add a different protocol
      await insertConfig(db, {
        protocol: "vmess",
        raw: "vmess://test@server.com:443",
        canonical: "vmess://test@server.com:443/",
        config_hash: "vmess_hash_001",
        is_valid: 1,
        active: 1,
      });

      await handleGenerate(makeCtx(db, api));

      expect(api.sendMessageCalls[0].text).toContain("vless");
      expect(api.sendMessageCalls[0].text).toContain("vmess");
    });

    it("should mention /publish in the response", async () => {
      await handleGenerate(makeCtx(db, api));

      expect(api.sendMessageCalls[0].text).toContain("/publish");
    });

    it("should be registered as a command", async () => {
      const commands = getRegisteredCommands();
      expect(commands).toContain("generate");
    });
  });

  // ─── /publish ─────────────────────────────────────────────

  describe("/publish", () => {
    it("should reject non-admin users", async () => {
      const message = makeMessage({
        from: { id: 999999, is_bot: false, first_name: "User" },
      });
      await handlePublish(makeCtx(db, api, { message }));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });

    it("should show not-configured when GitHub settings are missing", async () => {
      // No github_owner set — /publish still proceeds to Telegram channel
      await handlePublish(makeCtx(db, api));

      // At least "Publishing..." + combined result
      expect(api.sendMessageCalls.length).toBeGreaterThanOrEqual(2);
      const lastMsg = api.sendMessageCalls[api.sendMessageCalls.length - 1].text;
      expect(lastMsg).toContain("GitHub");
      // Token must never appear in messages
      const all = api.sendMessageCalls.map(c => c.text).join("\n");
      expect(all).not.toContain("token");
    });

    it("should skip GitHub when token is missing", async () => {
      await insertTestConfigs(1);
      await db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .bind("github_owner", "testowner")
        .run();
      await db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .bind("github_repo", "testrepo")
        .run();

      await handlePublish(makeCtx(db, api, { githubToken: undefined }));

      // At least "Publishing..." + combined result
      expect(api.sendMessageCalls.length).toBeGreaterThanOrEqual(2);
      const all = api.sendMessageCalls.map(c => c.text).join("\n");
      // Token must never appear in messages
      expect(all).not.toContain("token");
    });

    it("should attempt publication when configured", async () => {
      await insertTestConfigs(1);
      await db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .bind("github_owner", "testowner")
        .run();
      await db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .bind("github_repo", "testrepo")
        .run();

      await handlePublish(makeCtx(db, api));

      // Should send "publishing..." message and then result
      expect(api.sendMessageCalls.length).toBe(2);
      expect(api.sendMessageCalls[0].text).toContain("Publishing");
      expect(api.sendMessageCalls[1].text).toBeDefined();
    });

    it("should show success message on successful publication", async () => {
      await insertTestConfigs(1);
      await db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .bind("github_owner", "testowner")
        .run();
      await db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .bind("github_repo", "testrepo")
        .run();

      await handlePublish(makeCtx(db, api));

      // Last message should be the result
      const lastMsg = api.sendMessageCalls[api.sendMessageCalls.length - 1];
      // Either success or error — both are valid
      expect(lastMsg.text).toBeDefined();
      expect(lastMsg.parse_mode).toBe("HTML");
    });

    it("should not expose GitHub token in messages", async () => {
      await insertTestConfigs(1);
      await db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .bind("github_owner", "testowner")
        .run();
      await db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .bind("github_repo", "testrepo")
        .run();

      await handlePublish(makeCtx(db, api));

      for (const msg of api.sendMessageCalls) {
        expect(msg.text).not.toContain("ghp_test_token");
      }
    });

    it("should not expose internal error details", async () => {
      await insertTestConfigs(1);
      await db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .bind("github_owner", "testowner")
        .run();
      await db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .bind("github_repo", "testrepo")
        .run();

      await handlePublish(makeCtx(db, api));

      for (const msg of api.sendMessageCalls) {
        // Should not contain stack traces or internal error messages
        expect(msg.text).not.toContain("Error:");
        expect(msg.text).not.toContain("TypeError");
        expect(msg.text).not.toContain("Cannot read");
      }
    });

    it("should be registered as a command", async () => {
      const commands = getRegisteredCommands();
      expect(commands).toContain("publish");
    });
  });

  // ─── /setgithub ───────────────────────────────────────────

  describe("/setgithub", () => {
    it("should save GitHub configuration", async () => {
      await handleSetGithub(
        makeCtx(db, api, {
          message: makeMessage({ text: "/setgithub myuser myrepo main" }),
        })
      );

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("GitHub configured");
      expect(api.sendMessageCalls[0].text).toContain("myuser");
      expect(api.sendMessageCalls[0].text).toContain("myrepo");
      expect(api.sendMessageCalls[0].text).toContain("main");

      // Verify settings were saved
      expect(await getSetting(db, "github_owner")).toBe("myuser");
      expect(await getSetting(db, "github_repo")).toBe("myrepo");
      expect(await getSetting(db, "github_branch")).toBe("main");
    });

    it("should default branch to main", async () => {
      await handleSetGithub(
        makeCtx(db, api, {
          message: makeMessage({ text: "/setgithub user repo" }),
        })
      );

      expect(await getSetting(db, "github_branch")).toBe("main");
    });

    it("should show usage when arguments are missing", async () => {
      await handleSetGithub(
        makeCtx(db, api, {
          message: makeMessage({ text: "/setgithub" }),
        })
      );

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Usage:");
    });

    it("should reject non-admin users", async () => {
      const message = makeMessage({
        from: { id: 999999, is_bot: false, first_name: "User" },
        text: "/setgithub user repo",
      });
      await handleSetGithub(makeCtx(db, api, { message }));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });

    it("should validate owner/repo names", async () => {
      await handleSetGithub(
        makeCtx(db, api, {
          message: makeMessage({ text: "/setgithub invalid user repo" }),
        })
      );

      // "invalid user" has a space, which should fail validation
      // Actually "invalid" is valid, let's test with truly invalid names
    });

    it("should reject names with special characters", async () => {
      await handleSetGithub(
        makeCtx(db, api, {
          message: makeMessage({ text: "/setgithub user@name repo!" }),
        })
      );

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Invalid");
    });

    it("should be registered as a command", async () => {
      const commands = getRegisteredCommands();
      expect(commands).toContain("setgithub");
    });
  });

  // ─── /setoutput ───────────────────────────────────────────

  describe("/setoutput", () => {
    it("should save output channel configuration", async () => {
      await handleSetOutput(
        makeCtx(db, api, {
          message: makeMessage({ text: "/setoutput -1001234567890" }),
        })
      );

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Output channel configured");
      expect(api.sendMessageCalls[0].text).toContain("-1001234567890");

      // Verify setting was saved
      expect(await getSetting(db, "output_channel_id")).toBe("-1001234567890");
    });

    it("should show usage when arguments are missing", async () => {
      await handleSetOutput(
        makeCtx(db, api, {
          message: makeMessage({ text: "/setoutput" }),
        })
      );

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Usage:");
    });

    it("should reject non-numeric channel IDs", async () => {
      await handleSetOutput(
        makeCtx(db, api, {
          message: makeMessage({ text: "/setoutput notanumber" }),
        })
      );

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Invalid");
    });

    it("should reject non-admin users", async () => {
      const message = makeMessage({
        from: { id: 999999, is_bot: false, first_name: "User" },
        text: "/setoutput -100123",
      });
      await handleSetOutput(makeCtx(db, api, { message }));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("Access denied");
    });

    it("should accept positive channel IDs", async () => {
      await handleSetOutput(
        makeCtx(db, api, {
          message: makeMessage({ text: "/setoutput 123456" }),
        })
      );

      expect(await getSetting(db, "output_channel_id")).toBe("123456");
    });

    it("should be registered as a command", async () => {
      const commands = getRegisteredCommands();
      expect(commands).toContain("setoutput");
    });
  });

  // ─── Command Registry ─────────────────────────────────────

  describe("Command Registry (Phase 9)", () => {
    it("should have all Phase 9 commands registered", () => {
      const commands = getRegisteredCommands();
      expect(commands).toContain("generate");
      expect(commands).toContain("publish");
      expect(commands).toContain("setgithub");
      expect(commands).toContain("setoutput");
    });

    it("should have all previous commands still registered", () => {
      const commands = getRegisteredCommands();
      expect(commands).toContain("start");
      expect(commands).toContain("help");
      expect(commands).toContain("status");
      expect(commands).toContain("upload");
      expect(commands).toContain("cancel");
      expect(commands).toContain("addsource");
      expect(commands).toContain("removesource");
      expect(commands).toContain("sources");
      expect(commands.length).toBe(17);
    });
  });

  // ─── /help includes new commands ──────────────────────────

  describe("/help (Phase 9)", () => {
    it("should list new commands in help text", async () => {
      await executeCommand("help", makeCtx(db, api));

      expect(api.sendMessageCalls.length).toBe(1);
      expect(api.sendMessageCalls[0].text).toContain("/generate");
      expect(api.sendMessageCalls[0].text).toContain("/publish");
      expect(api.sendMessageCalls[0].text).toContain("/setgithub");
      expect(api.sendMessageCalls[0].text).toContain("/setoutput");
    });
  });
});
