/**
 * Tests — Output Engine: Generator
 *
 * Tests the core output generation:
 * - all.txt generation
 * - Protocol-specific file generation
 * - Operator-specific file generation
 * - Deterministic sorting
 * - Inclusion/exclusion rules
 * - Operator membership via occurrence/batch metadata
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import {
  generateAllTxt,
  generateProtocolTxt,
  generateOperatorTxt,
  generateAllOutputs,
  configsToTxt,
  getPopulatedOperators,
  getPopulatedProtocols,
} from "../../src/output/generator";
import { insertConfig } from "../../src/db/configs";
import { insertBatch } from "../../src/db/batches";
import { insertOccurrence } from "../../src/db/occurrences";
import type { ConfigRow } from "../../src/db/connection";

describe("Output Engine — Generator", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  // ─── Helper: Insert test data ─────────────────────────────

  async function insertTestConfig(overrides: Partial<{
    protocol: string;
    raw: string;
    canonical: string;
    config_hash: string;
    is_valid: number;
    active: number;
  }> = {}) {
    const defaults = {
      protocol: "vless",
      raw: `vless://${overrides.config_hash ?? "default"}@example.com:443#test`,
      canonical: `vless://${overrides.config_hash ?? "default"}@example.com:443/#test`,
      config_hash: `hash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      is_valid: 1,
      active: 1,
    };
    return insertConfig(db, { ...defaults, ...overrides });
  }

  async function insertTestBatch(
    operator: string,
    sourceType = "admin",
    sourceChatId = 123456
  ) {
    return insertBatch(db, {
      source_type: sourceType,
      source_chat_id: sourceChatId,
      operator,
    });
  }

  // ─── configsToTxt() ──────────────────────────────────────

  describe("configsToTxt()", () => {
    it("should convert configs to newline-separated raw strings", () => {
      const configs = [
        { raw: "vless://abc@example.com:443" },
        { raw: "vmess://def@example.com:443" },
      ] as ConfigRow[];

      const result = configsToTxt(configs);
      expect(result).toBe("vless://abc@example.com:443\nvmess://def@example.com:443\n");
    });

    it("should return empty string for empty array", () => {
      const result = configsToTxt([]);
      expect(result).toBe("");
    });

    it("should handle single config", () => {
      const configs = [
        { raw: "trojan://pass@server.com:443" },
      ] as ConfigRow[];

      const result = configsToTxt(configs);
      expect(result).toBe("trojan://pass@server.com:443\n");
    });
  });

  // ─── generateAllTxt() ────────────────────────────────────

  describe("generateAllTxt()", () => {
    it("should return empty string when no configs exist", async () => {
      const result = await generateAllTxt(db);
      expect(result).toBe("");
    });

    it("should include all valid, active configs", async () => {
      await insertTestConfig({ config_hash: "hash1", protocol: "vless", raw: "vless://hash1@x.com:443" });
      await insertTestConfig({ config_hash: "hash2", protocol: "vmess", raw: "vmess://hash2@x.com:443" });

      const result = await generateAllTxt(db);
      const lines = result.trim().split("\n");
      expect(lines.length).toBe(2);
    });

    it("should exclude invalid configs", async () => {
      await insertTestConfig({ config_hash: "hash_valid", is_valid: 1 });
      await insertTestConfig({ config_hash: "hash_invalid", is_valid: 0 });

      const result = await generateAllTxt(db);
      const lines = result.trim().split("\n");
      expect(lines.length).toBe(1);
    });

    it("should exclude inactive configs", async () => {
      await insertTestConfig({ config_hash: "hash_active", active: 1 });
      await insertTestConfig({ config_hash: "hash_inactive", active: 0 });

      const result = await generateAllTxt(db);
      const lines = result.trim().split("\n");
      expect(lines.length).toBe(1);
    });

    it("should sort by protocol then config_hash", async () => {
      // Insert out of order
      await insertTestConfig({ config_hash: "zzz_hash", protocol: "vless", raw: "vless://zzz@x.com" });
      await insertTestConfig({ config_hash: "aaa_hash", protocol: "vmess", raw: "vmess://aaa@x.com" });
      await insertTestConfig({ config_hash: "mmm_hash", protocol: "trojan", raw: "trojan://mmm@x.com" });

      const result = await generateAllTxt(db);
      const lines = result.trim().split("\n");
      // Should be sorted: trojan (aaa_hash < mmm_hash), then vless, then vmess
      expect(lines[0]).toContain("trojan://");
      expect(lines[1]).toContain("vless://");
      expect(lines[2]).toContain("vmess://");
    });
  });

  // ─── generateProtocolTxt() ───────────────────────────────

  describe("generateProtocolTxt()", () => {
    it("should return empty string for protocol with no configs", async () => {
      const result = await generateProtocolTxt(db, "vmess");
      expect(result).toBe("");
    });

    it("should include only configs matching the protocol", async () => {
      await insertTestConfig({ config_hash: "h1", protocol: "vless", raw: "vless://h1@x.com" });
      await insertTestConfig({ config_hash: "h2", protocol: "vmess", raw: "vmess://h2@x.com" });
      await insertTestConfig({ config_hash: "h3", protocol: "vless", raw: "vless://h3@x.com" });

      const result = await generateProtocolTxt(db, "vless");
      const lines = result.trim().split("\n");
      expect(lines.length).toBe(2);
      expect(lines.every((l) => l.startsWith("vless://"))).toBe(true);
    });

    it("should sort configs by config_hash within protocol", async () => {
      await insertTestConfig({ config_hash: "zzz", protocol: "vless", raw: "vless://zzz@x.com" });
      await insertTestConfig({ config_hash: "aaa", protocol: "vless", raw: "vless://aaa@x.com" });

      const result = await generateProtocolTxt(db, "vless");
      const lines = result.trim().split("\n");
      expect(lines[0]).toContain("aaa");
      expect(lines[1]).toContain("zzz");
    });
  });

  // ─── generateOperatorTxt() ───────────────────────────────

  describe("generateOperatorTxt()", () => {
    it("should return empty string when no batches exist", async () => {
      const result = await generateOperatorTxt(db, "irancell");
      expect(result).toBe("");
    });

    it("should include configs from batches with matching operator", async () => {
      // Insert configs
      const c1 = await insertTestConfig({ config_hash: "h1", protocol: "vless", raw: "vless://h1@x.com" });
      const c2 = await insertTestConfig({ config_hash: "h2", protocol: "vmess", raw: "vmess://h2@x.com" });

      // Insert batch with operator "irancell"
      const batch = await insertTestBatch("irancell");

      // Link c1 to the irancell batch
      await insertOccurrence(db, {
        config_id: c1.id,
        source_type: "admin",
        batch_id: batch.id,
      });

      const result = await generateOperatorTxt(db, "irancell");
      const lines = result.trim().split("\n");
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("h1");
    });

    it("should exclude configs not linked to any batch with matching operator", async () => {
      const c1 = await insertTestConfig({ config_hash: "h1", protocol: "vless", raw: "vless://h1@x.com" });

      // Batch with different operator
      const batch = await insertTestBatch("mci");
      await insertOccurrence(db, {
        config_id: c1.id,
        source_type: "admin",
        batch_id: batch.id,
      });

      const result = await generateOperatorTxt(db, "irancell");
      expect(result).toBe("");
    });

    it("should include a config in multiple operator files if it has occurrences in both", async () => {
      const c1 = await insertTestConfig({ config_hash: "shared", protocol: "vless", raw: "vless://shared@x.com" });

      const batch1 = await insertTestBatch("irancell");
      const batch2 = await insertTestBatch("mci");

      await insertOccurrence(db, {
        config_id: c1.id,
        source_type: "admin",
        batch_id: batch1.id,
      });
      await insertOccurrence(db, {
        config_id: c1.id,
        source_type: "admin",
        batch_id: batch2.id,
      });

      const irancellResult = await generateOperatorTxt(db, "irancell");
      const mciResult = await generateOperatorTxt(db, "mci");

      expect(irancellResult.trim()).toContain("shared");
      expect(mciResult.trim()).toContain("shared");
    });

    it("should exclude invalid or inactive configs from operator files", async () => {
      const c1 = await insertTestConfig({ config_hash: "valid", protocol: "vless", raw: "vless://valid@x.com", is_valid: 1 });
      await insertTestConfig({ config_hash: "invalid", protocol: "vless", raw: "vless://invalid@x.com", is_valid: 0 });

      const batch = await insertTestBatch("irancell");
      await insertOccurrence(db, { config_id: c1.id, source_type: "admin", batch_id: batch.id });

      const result = await generateOperatorTxt(db, "irancell");
      const lines = result.trim().split("\n");
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("valid");
    });
  });

  // ─── generateAllOutputs() ────────────────────────────────

  describe("generateAllOutputs()", () => {
    it("should return a map with all expected file keys", async () => {
      const manifest = await generateAllOutputs(db);

      // all.txt
      expect(manifest.has("all.txt")).toBe(true);

      // Protocol files
      expect(manifest.has("vmess.txt")).toBe(true);
      expect(manifest.has("vless.txt")).toBe(true);
      expect(manifest.has("trojan.txt")).toBe(true);
      expect(manifest.has("shadowsocks.txt")).toBe(true);
      expect(manifest.has("hysteria.txt")).toBe(true);
      expect(manifest.has("hysteria2.txt")).toBe(true);

      // Operator files
      expect(manifest.has("irancell.txt")).toBe(true);
      expect(manifest.has("mci.txt")).toBe(true);
      expect(manifest.has("rightel.txt")).toBe(true);
      expect(manifest.has("mokhaberat.txt")).toBe(true);
      expect(manifest.has("other.txt")).toBe(true);
      expect(manifest.has("unknown.txt")).toBe(true);

      // Metadata files
      expect(manifest.has("stats.json")).toBe(true);
      expect(manifest.has("README.md")).toBe(true);
    });

    it("should contain valid JSON in stats.json", async () => {
      const manifest = await generateAllOutputs(db);
      const statsContent = manifest.get("stats.json")!;

      // Should parse without throwing
      const stats = JSON.parse(statsContent);
      expect(stats).toHaveProperty("generated_at");
      expect(stats).toHaveProperty("total_active_valid");
      expect(stats).toHaveProperty("protocols");
      expect(stats).toHaveProperty("operators");
      expect(stats).toHaveProperty("supported_protocols");
      expect(stats).toHaveProperty("supported_operators");
    });

    it("should contain valid markdown in README.md", async () => {
      const manifest = await generateAllOutputs(db);
      const readmeContent = manifest.get("README.md")!;

      expect(readmeContent).toContain("# V2Ray Configuration Aggregator");
      expect(readmeContent).toContain("Operator classification is based on administrator-provided verification.");
      expect(readmeContent).not.toContain("tested from Iran");
    });

    it("should reflect actual data in output files", async () => {
      await insertTestConfig({ config_hash: "h1", protocol: "vless", raw: "vless://h1@x.com" });
      await insertTestConfig({ config_hash: "h2", protocol: "vmess", raw: "vmess://h2@x.com" });

      const manifest = await generateAllOutputs(db);
      const allContent = manifest.get("all.txt")!;
      const lines = allContent.trim().split("\n");
      expect(lines.length).toBe(2);

      const stats = JSON.parse(manifest.get("stats.json")!);
      expect(stats.total_active_valid).toBe(2);
      expect(stats.protocols.vless).toBe(1);
      expect(stats.protocols.vmess).toBe(1);
    });
  });

  // ─── getPopulatedOperators() / getPopulatedProtocols() ───

  describe("getPopulatedOperators()", () => {
    it("should return empty array when no data", async () => {
      const ops = await getPopulatedOperators(db);
      expect(ops).toEqual([]);
    });

    it("should return operators with configs", async () => {
      const c1 = await insertTestConfig({ config_hash: "h1", protocol: "vless", raw: "vless://h1@x.com" });
      const c2 = await insertTestConfig({ config_hash: "h2", protocol: "vmess", raw: "vmess://h2@x.com" });

      const b1 = await insertTestBatch("irancell");
      const b2 = await insertTestBatch("mci");

      await insertOccurrence(db, { config_id: c1.id, source_type: "admin", batch_id: b1.id });
      await insertOccurrence(db, { config_id: c2.id, source_type: "admin", batch_id: b2.id });

      const ops = await getPopulatedOperators(db);
      expect(ops).toContain("irancell");
      expect(ops).toContain("mci");
      expect(ops.length).toBe(2);
    });
  });

  describe("getPopulatedProtocols()", () => {
    it("should return empty array when no data", async () => {
      const protos = await getPopulatedProtocols(db);
      expect(protos).toEqual([]);
    });

    it("should return protocols with configs", async () => {
      await insertTestConfig({ config_hash: "h1", protocol: "vless", raw: "vless://h1@x.com" });
      await insertTestConfig({ config_hash: "h2", protocol: "vmess", raw: "vmess://h2@x.com" });

      const protos = await getPopulatedProtocols(db);
      expect(protos).toContain("vless");
      expect(protos).toContain("vmess");
    });
  });
});
