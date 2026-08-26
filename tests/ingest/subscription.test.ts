/**
 * Tests — Subscription Fetcher MVP
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import {
  detectFormat,
  extractConfigs,
  isActiveSubscription,
  fetchWithLimits,
  fetchSingleSubscription,
  fetchAllSubscriptions,
  registerFetch,
  cancelFetch,
  getFetchCancellation,
  unregisterFetch,
  type SubFormat,
} from "../../src/ingest/subscription";
import { insertSource } from "../../src/db/sources";
import { getFetchRun } from "../../src/db/fetch-runs";

describe("Subscription Fetcher", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  describe("detectFormat()", () => {
    it("should detect plain text configs", () => {
      const text = "vless://uuid@server:443?security=tls#Config";
      expect(detectFormat(text)).toBe("plain");
    });

    it("should detect base64 encoded configs", () => {
      const raw = "vmess://uuid@server:443?security=tls#Config";
      const b64 = btoa(raw);
      expect(detectFormat(b64)).toBe("base64");
    });

    it("should return unknown for non-config content", () => {
      expect(detectFormat("hello world")).toBe("unknown");
    });

    it("should return unknown for empty content", () => {
      expect(detectFormat("")).toBe("unknown");
      expect(detectFormat("   ")).toBe("unknown");
    });

    it("should handle base64 with padding", () => {
      const raw = "trojan://uuid@server:443#Config";
      const b64 = btoa(raw);
      expect(detectFormat(b64)).toBe("base64");
    });
  });

  describe("extractConfigs()", () => {
    it("should extract plain text configs", () => {
      const lines = [
        "vless://uuid@server1:443?security=tls#C1",
        "vless://uuid@server2:443?security=tls#C2",
      ];
      const text = lines.join(String.fromCharCode(10));
      const result = extractConfigs(text, "plain");
      expect(result.length).toBe(2);
    });

    it("should extract base64 configs", () => {
      const lines = [
        "vmess://uuid@server1:443?security=tls#C1",
        "vmess://uuid@server2:443?security=tls#C2",
      ];
      const raw = lines.join(String.fromCharCode(10));
      const b64 = btoa(raw);
      const result = extractConfigs(b64, "base64");
      expect(result.length).toBe(2);
    });

    it("should deduplicate configs", () => {
      const lines = [
        "vless://uuid@server:443?security=tls#C1",
        "vless://uuid@server:443?security=tls#C1",
      ];
      const text = lines.join(String.fromCharCode(10));
      const result = extractConfigs(text, "plain");
      expect(result.length).toBe(1);
    });

    it("should return empty for empty content", () => {
      expect(extractConfigs("", "plain")).toEqual([]);
    });

    it("should handle mixed protocols", () => {
      const lines = [
        "vless://uuid@server1:443?security=tls#C1",
        "trojan://pass@server2:443?security=tls#C2",
        "vmess://uuid@server3:443?security=tls#C3",
      ];
      const text = lines.join(String.fromCharCode(10));
      const result = extractConfigs(text, "plain");
      expect(result.length).toBe(3);
    });

    it("should handle hysteria2 and hy2 schemes", () => {
      const lines = [
        "hysteria2://password@server1:443#C1",
        "hy2://password@server2:443#C2",
      ];
      const text = lines.join(String.fromCharCode(10));
      const result = extractConfigs(text, "plain");
      expect(result.length).toBe(2);
    });
  });

  describe("isActiveSubscription()", () => {
    it("should return true for active status", () => {
      expect(isActiveSubscription({ sub_status: "active" } as any)).toBe(true);
    });

    it("should return false for inactive status", () => {
      expect(isActiveSubscription({ sub_status: "inactive" } as any)).toBe(false);
    });

    it("should return false for error status", () => {
      expect(isActiveSubscription({ sub_status: "error" } as any)).toBe(false);
    });
  });

  describe("fetchWithLimits()", () => {
    it("should handle invalid URL", async () => {
      const result = await fetchWithLimits("http://localhost:99999/bad");
      expect(result.success).toBe(false);
    });
  });

  describe("fetchSingleSubscription()", () => {
    it("should handle source with no URL", async () => {
      const sub = {
        chat_id: 1001,
        title: "Test Sub",
        sub_url: null,
        sub_status: "active",
        consecutive_failures: 0,
      } as any;
      const result = await fetchSingleSubscription(db, sub);
      expect(result.success).toBe(false);
      expect(result.error).toBe("No URL");
    });
  });

  describe("fetchAllSubscriptions()", () => {
    it("should return zero results when no subscriptions exist", async () => {
      const result = await fetchAllSubscriptions(db);
      expect(result.totalProcessed).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failCount).toBe(0);
    });

    it("should persist cancellation so another request context can observe it", async () => {
      const flowId = "persistent-cancel-flow";
      await registerFetch(flowId, 7002, 7002, db);

      // Simulate the callback request: the original request's isolate-local Map is gone.
      await unregisterFetch(flowId);
      await cancelFetch(flowId, 7002, 7002, db);
      // The orphaned run is finished as 'cancelled' so it stops blocking new
      // fetches immediately and the cancellation is observable from any context.
      expect((await getFetchRun(db, flowId))?.status).toBe("cancelled");

      await unregisterFetch(flowId, db, 7002, "cancelled");
      expect((await getFetchRun(db, flowId))?.status).toBe("cancelled");
    });

    it("should stop before processing when cancellation is already requested", async () => {
      await insertSource(db, {
        chat_id: 7001,
        title: "Cancelled source",
        type: "subscription",
        enabled: 1,
        trusted: 1,
      });
      await db
        .prepare("UPDATE sources SET sub_url = ?, sub_status = ?, auto_fetch = 1 WHERE chat_id = ?")
        .bind("http://localhost:99999/should-not-fetch", "active", 7001)
        .run();

      const result = await fetchAllSubscriptions(db, undefined, undefined, {
        isCancelled: () => true,
      });

      expect(result.cancelled).toBe(true);
      expect(result.totalProcessed).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failCount).toBe(0);
    });
  });
});
