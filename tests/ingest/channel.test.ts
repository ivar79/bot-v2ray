/**
 * Tests — Trusted Channel Ingestion
 *
 * Tests channel_post processing, source validation, and source management.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { MockTelegramBotAPI } from "../../src/telegram/api";
import {
  handleChannelPost,
  addTrustedSource,
  removeTrustedSource,
} from "../../src/ingest/channel";
import { insertSource } from "../../src/db/sources";
import { countConfigs } from "../../src/db/configs";
import { countBatches } from "../../src/db/batches";
import { countOccurrences } from "../../src/db/occurrences";
import type { TgChannelPost } from "../../src/telegram/types";

function makeChannelPost(
  chatId: number,
  text: string,
  messageId: number = 1
): TgChannelPost {
  return {
    message_id: messageId,
    date: Date.now(),
    chat: { id: chatId, type: "channel", title: "Test Channel" },
    text,
  };
}

describe("Trusted Channel Ingestion", () => {
  let db: D1Database;
  let api: MockTelegramBotAPI;

  beforeEach(() => {
    db = createTestDB();
    api = new MockTelegramBotAPI();
  });

  describe("handleChannelPost()", () => {
    it("should process configs from trusted enabled source", async () => {
      // Add a trusted source
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1001111111111,
        title: "Trusted Channel",
        enabled: 1,
        trusted: 1,
      });

      const post = makeChannelPost(
        -1001111111111,
        "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443?security=tls#Config"
      );

      await handleChannelPost(post, db, api);

      // Should have created a batch and stored configs
      expect(await countConfigs(db)).toBe(1);
      expect(await countBatches(db)).toBe(1);
      expect(await countOccurrences(db)).toBe(1);
    });

    it("should silently ignore unconfigured sources", async () => {
      // No source configured
      const post = makeChannelPost(
        -1009999999999,
        "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#Config"
      );

      await handleChannelPost(post, db, api);

      // Nothing should be stored
      expect(await countConfigs(db)).toBe(0);
      expect(await countBatches(db)).toBe(0);
    });

    it("should silently ignore disabled sources", async () => {
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1002222222222,
        title: "Disabled Channel",
        enabled: 0,
        trusted: 1,
      });

      const post = makeChannelPost(
        -1002222222222,
        "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#Config"
      );

      await handleChannelPost(post, db, api);

      expect(await countConfigs(db)).toBe(0);
    });

    it("should silently ignore untrusted sources", async () => {
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1003333333333,
        title: "Untrusted Channel",
        enabled: 1,
        trusted: 0,
      });

      const post = makeChannelPost(
        -1003333333333,
        "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#Config"
      );

      await handleChannelPost(post, db, api);

      expect(await countConfigs(db)).toBe(0);
    });

    it("should silently ignore posts with no config links", async () => {
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1004444444444,
        title: "Config Channel",
        enabled: 1,
        trusted: 1,
      });

      const post = makeChannelPost(
        -1004444444444,
        "This is just a regular channel post with no configs."
      );

      await handleChannelPost(post, db, api);

      expect(await countConfigs(db)).toBe(0);
      expect(await countBatches(db)).toBe(0);
    });

    it("should silently ignore posts with no text", async () => {
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1005555555555,
        title: "Photo Channel",
        enabled: 1,
        trusted: 1,
      });

      const post: TgChannelPost = {
        message_id: 1,
        date: Date.now(),
        chat: { id: -1005555555555, type: "channel", title: "Photo Channel" },
        // No text, no caption
      };

      await handleChannelPost(post, db, api);

      expect(await countConfigs(db)).toBe(0);
    });

    it("should set operator to unknown for channel configs", async () => {
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1006666666666,
        title: "Test Channel",
        enabled: 1,
        trusted: 1,
      });

      const post = makeChannelPost(
        -1006666666666,
        "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#C1"
      );

      await handleChannelPost(post, db, api);

      // Check batch operator
      const batch = await db
        .prepare("SELECT operator FROM batches LIMIT 1")
        .first<{ operator: string }>();

      expect(batch).not.toBeNull();
      expect(batch!.operator).toBe("unknown");
    });

    it("should deduplicate configs across channels", async () => {
      // Add two sources
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1007777777771,
        title: "Channel A",
        enabled: 1,
        trusted: 1,
      });
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1007777777772,
        title: "Channel B",
        enabled: 1,
        trusted: 1,
      });

      const config = "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#SameConfig";

      // Same config from Channel A
      await handleChannelPost(
        makeChannelPost(-1007777777771, config, 1),
        db,
        api
      );
      expect(await countConfigs(db)).toBe(1);

      // Same config from Channel B
      await handleChannelPost(
        makeChannelPost(-1007777777772, config, 2),
        db,
        api
      );

      // Still only 1 config, but 2 occurrences and 2 batches
      expect(await countConfigs(db)).toBe(1);
      expect(await countBatches(db)).toBe(2);
      expect(await countOccurrences(db)).toBe(2);
    });

    it("should preserve source traceability via batch", async () => {
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1008888888888,
        title: "Trace Channel",
        enabled: 1,
        trusted: 1,
      });

      const post = makeChannelPost(
        -1008888888888,
        "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#Trace",
        42
      );

      await handleChannelPost(post, db, api);

      // Check occurrence has correct source info
      const occ = await db
        .prepare("SELECT * FROM occurrences LIMIT 1")
        .first<{
          source_type: string;
          source_chat_id: number;
          source_message_id: number;
        }>();

      expect(occ).not.toBeNull();
      expect(occ!.source_type).toBe("trusted_channel");
      expect(occ!.source_chat_id).toBe(-1008888888888);
      expect(occ!.source_message_id).toBe(42);
    });

    it("should process multiple configs in one channel post", async () => {
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1009999999999,
        title: "Multi Config",
        enabled: 1,
        trusted: 1,
      });

      const text = `vless://a3482e88-686a-4a58-8126-99c9034e4b09@server1.com:443#C1
vless://b3482e88-686a-4a58-8126-99c9034e4b09@server2.com:443#C2
trojan://pass@server3.com:443#C3`;

      await handleChannelPost(
        makeChannelPost(-1009999999999, text),
        db,
        api
      );

      expect(await countConfigs(db)).toBe(3);
      expect(await countOccurrences(db)).toBe(3);
    });
  });

  describe("addTrustedSource()", () => {
    it("should add a new source", async () => {
      const result = await addTrustedSource(
        db,
        -1001111111111,
        "Test Channel",
        "testchannel"
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("added");
    });

    it("should update existing source", async () => {
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1002222222222,
        title: "Old Title",
        enabled: 1,
        trusted: 1,
      });

      const result = await addTrustedSource(
        db,
        -1002222222222,
        "New Title",
        "newchannel"
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("updated");
    });
  });

  describe("removeTrustedSource()", () => {
    it("should remove an existing source", async () => {
      await insertSource(db, {
        type: "trusted_channel",
        chat_id: -1003333333333,
        title: "To Remove",
        enabled: 1,
        trusted: 1,
      });

      const result = await removeTrustedSource(db, -1003333333333);
      expect(result.success).toBe(true);
      expect(result.message).toContain("removed");
    });

    it("should return error for non-existent source", async () => {
      const result = await removeTrustedSource(db, -1009999999999);
      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });
  });
});
