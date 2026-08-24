/**
 * Tests — Output Engine: Stats Generator
 *
 * Tests stats.json generation:
 * - Aggregate counts
 * - Protocol breakdown
 * - Operator breakdown
 * - Source and batch counts
 * - No private ID exposure
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { generateStats } from "../../src/output/stats";
import { insertConfig, deactivateConfig } from "../../src/db/configs";
import { insertBatch } from "../../src/db/batches";
import { insertOccurrence } from "../../src/db/occurrences";
import { insertSource } from "../../src/db/sources";

describe("Output Engine — Stats Generator", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  describe("generateStats()", () => {
    it("should return zero counts for empty database", async () => {
      const stats = await generateStats(db);

      expect(stats.total_active_valid).toBe(0);
      expect(stats.protocols).toEqual({});
      expect(stats.operators).toEqual({});
      expect(stats.total_sources).toBe(0);
      expect(stats.total_batches).toBe(0);
      expect(stats.supported_protocols).toBeDefined();
      expect(stats.supported_operators).toBeDefined();
    });

    it("should include generated_at as ISO timestamp", async () => {
      const stats = await generateStats(db);
      expect(stats.generated_at).toBeDefined();
      expect(new Date(stats.generated_at).toISOString()).toBe(stats.generated_at);
    });

    it("should count active, valid configs correctly", async () => {
      await insertConfig(db, {
        protocol: "vless",
        raw: "vless://h1@x.com:443",
        canonical: "vless://h1@x.com:443/",
        config_hash: "h1",
        is_valid: 1,
        active: 1,
      });
      await insertConfig(db, {
        protocol: "vmess",
        raw: "vmess://h2@x.com:443",
        canonical: "vmess://h2@x.com:443/",
        config_hash: "h2",
        is_valid: 1,
        active: 1,
      });

      const stats = await generateStats(db);
      expect(stats.total_active_valid).toBe(2);
    });

    it("should exclude invalid configs from count", async () => {
      await insertConfig(db, {
        protocol: "vless",
        raw: "vless://h1@x.com:443",
        canonical: "vless://h1@x.com:443/",
        config_hash: "h1",
        is_valid: 1,
        active: 1,
      });
      await insertConfig(db, {
        protocol: "vless",
        raw: "vless://h2@x.com:443",
        canonical: "vless://h2@x.com:443/",
        config_hash: "h2",
        is_valid: 0,
        active: 1,
      });

      const stats = await generateStats(db);
      expect(stats.total_active_valid).toBe(1);
    });

    it("should exclude inactive configs from count", async () => {
      const c = await insertConfig(db, {
        protocol: "vless",
        raw: "vless://h1@x.com:443",
        canonical: "vless://h1@x.com:443/",
        config_hash: "h1",
        is_valid: 1,
        active: 1,
      });
      await deactivateConfig(db, c.id);

      const stats = await generateStats(db);
      expect(stats.total_active_valid).toBe(0);
    });

    it("should break down counts by protocol", async () => {
      await insertConfig(db, {
        protocol: "vless", raw: "vless://h1@x.com:443",
        canonical: "vless://h1@x.com:443/", config_hash: "h1",
      });
      await insertConfig(db, {
        protocol: "vmess", raw: "vmess://h2@x.com:443",
        canonical: "vmess://h2@x.com:443/", config_hash: "h2",
      });
      await insertConfig(db, {
        protocol: "vmess", raw: "vmess://h3@x.com:443",
        canonical: "vmess://h3@x.com:443/", config_hash: "h3",
      });

      const stats = await generateStats(db);
      expect(stats.protocols.vless).toBe(1);
      expect(stats.protocols.vmess).toBe(2);
    });

    it("should break down counts by operator via occurrences", async () => {
      // Insert configs
      const c1 = await insertConfig(db, {
        protocol: "vless", raw: "vless://h1@x.com:443",
        canonical: "vless://h1@x.com:443/", config_hash: "h1",
      });
      const c2 = await insertConfig(db, {
        protocol: "vmess", raw: "vmess://h2@x.com:443",
        canonical: "vmess://h2@x.com:443/", config_hash: "h2",
      });

      // Insert batches with different operators
      const b1 = await insertBatch(db, {
        source_type: "admin", source_chat_id: 111, operator: "irancell",
      });
      const b2 = await insertBatch(db, {
        source_type: "admin", source_chat_id: 222, operator: "mci",
      });

      // Link configs to batches
      await insertOccurrence(db, { config_id: c1.id, source_type: "admin", batch_id: b1.id });
      await insertOccurrence(db, { config_id: c2.id, source_type: "admin", batch_id: b2.id });

      const stats = await generateStats(db);
      expect(stats.operators.irancell).toBe(1);
      expect(stats.operators.mci).toBe(1);
    });

    it("should count sources and batches", async () => {
      await insertSource(db, { chat_id: 1001 });
      await insertSource(db, { chat_id: 1002 });
      await insertBatch(db, { source_type: "admin", source_chat_id: 111 });

      const stats = await generateStats(db);
      expect(stats.total_sources).toBe(2);
      expect(stats.total_batches).toBe(1);
    });

    it("should include supported protocols and operators lists", async () => {
      const stats = await generateStats(db);
      expect(stats.supported_protocols).toContain("vless");
      expect(stats.supported_protocols).toContain("vmess");
      expect(stats.supported_protocols).toContain("trojan");
      expect(stats.supported_protocols).toContain("shadowsocks");
      expect(stats.supported_protocols).toContain("hysteria");
      expect(stats.supported_protocols).toContain("hysteria2");

      expect(stats.supported_operators).toContain("irancell");
      expect(stats.supported_operators).toContain("mci");
      expect(stats.supported_operators).toContain("rightel");
      expect(stats.supported_operators).toContain("mokhaberat");
      expect(stats.supported_operators).toContain("other");
      expect(stats.supported_operators).toContain("unknown");
    });

    it("should not contain private Telegram IDs", async () => {
      // Insert source with a real-looking chat_id
      await insertSource(db, { chat_id: -1001234567890 });
      await insertBatch(db, {
        source_type: "admin",
        source_chat_id: 123456789,
        verified_by: 987654321,
      });

      const stats = await generateStats(db);
      const statsStr = JSON.stringify(stats);

      // The stats object should only have aggregate counts,
      // not individual IDs
      expect(statsStr).not.toContain("123456789");
      expect(statsStr).not.toContain("987654321");
      expect(statsStr).not.toContain("-1001234567890");
    });
  });
});
