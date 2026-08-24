/**
 * Database Tests — Configs Table
 *
 * Tests config insertion, duplicate handling, lookup, and queries.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import {
  insertConfig,
  getConfigById,
  getConfigByHash,
  configHashExists,
  touchConfig,
  deactivateConfig,
  activateConfig,
  getActiveConfigs,
  getActiveConfigsByProtocol,
  getActiveConfigsByOperator,
  countConfigs,
  countActiveConfigs,
  countConfigsByProtocol,
  countActiveConfigsByOperator,
  countActiveConfigsWithOccurrences,
} from "../../src/db/configs";
import type { ConfigRow } from "../../src/db/connection";

describe("Configs Table", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  const sampleConfig = {
    protocol: "vless",
    raw: "vless://abc123@example.com:443?security=tls#test",
    canonical: "vless://abc123@example.com:443/?security=tls#test",
    config_hash: "sha256_aabbccdd00112233",
  };

  it("should insert a config and retrieve it by id", async () => {
    const inserted = await insertConfig(db, sampleConfig);

    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.protocol).toBe("vless");
    expect(inserted.raw).toBe(sampleConfig.raw);
    expect(inserted.canonical).toBe(sampleConfig.canonical);
    expect(inserted.config_hash).toBe(sampleConfig.config_hash);
    expect(inserted.is_valid).toBe(1);
    expect(inserted.active).toBe(1);
    expect(inserted.parser_version).toBe("1.0");
    expect(inserted.first_seen).toBeDefined();
    expect(inserted.last_seen).toBeDefined();
  });

  it("should retrieve a config by id", async () => {
    const inserted = await insertConfig(db, sampleConfig);
    const found = await getConfigById(db, inserted.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(inserted.id);
    expect(found!.protocol).toBe("vless");
  });

  it("should return null for non-existent id", async () => {
    const found = await getConfigById(db, 99999);
    expect(found).toBeNull();
  });

  it("should retrieve a config by config_hash", async () => {
    await insertConfig(db, sampleConfig);
    const found = await getConfigByHash(db, sampleConfig.config_hash);

    expect(found).not.toBeNull();
    expect(found!.config_hash).toBe(sampleConfig.config_hash);
  });

  it("should return null for non-existent hash", async () => {
    const found = await getConfigByHash(db, "nonexistent_hash");
    expect(found).toBeNull();
  });

  it("should check if config_hash exists", async () => {
    expect(await configHashExists(db, sampleConfig.config_hash)).toBe(false);
    await insertConfig(db, sampleConfig);
    expect(await configHashExists(db, sampleConfig.config_hash)).toBe(true);
  });

  it("should reject duplicate config_hash (UNIQUE constraint)", async () => {
    await insertConfig(db, sampleConfig);

    await expect(
      insertConfig(db, { ...sampleConfig, raw: "different raw" })
    ).rejects.toThrow();
  });

  it("should allow different config_hash values", async () => {
    await insertConfig(db, sampleConfig);
    const second = await insertConfig(db, {
      ...sampleConfig,
      config_hash: "sha256_ddeeff0011223344",
    });

    expect(second.id).not.toBe(sampleConfig.config_hash);
    expect(await countConfigs(db)).toBe(2);
  });

  it("should update last_seen timestamp", async () => {
    const inserted = await insertConfig(db, sampleConfig);
    const originalLastSeen = inserted.last_seen;

    // Small delay to ensure timestamp changes
    await new Promise((r) => setTimeout(r, 10));
    await touchConfig(db, inserted.id);

    const updated = await getConfigById(db, inserted.id);
    expect(updated!.last_seen).not.toBe(originalLastSeen);
  });

  it("should deactivate and reactivate a config", async () => {
    const inserted = await insertConfig(db, sampleConfig);

    await deactivateConfig(db, inserted.id);
    const deactivated = await getConfigById(db, inserted.id);
    expect(deactivated!.active).toBe(0);

    await activateConfig(db, inserted.id);
    const reactivated = await getConfigById(db, inserted.id);
    expect(reactivated!.active).toBe(1);
  });

  it("should get only active and valid configs", async () => {
    await insertConfig(db, sampleConfig);
    await insertConfig(db, {
      ...sampleConfig,
      config_hash: "hash_active2",
      protocol: "vmess",
    });
    const third = await insertConfig(db, {
      ...sampleConfig,
      config_hash: "hash_inactive",
      protocol: "trojan",
    });
    await deactivateConfig(db, third.id);

    const active = await getActiveConfigs(db);
    expect(active.length).toBe(2);
  });

  it("should get active configs by protocol", async () => {
    await insertConfig(db, sampleConfig);
    await insertConfig(db, {
      ...sampleConfig,
      config_hash: "hash2",
      protocol: "vmess",
    });
    await insertConfig(db, {
      ...sampleConfig,
      config_hash: "hash3",
      protocol: "vless",
    });

    const vlessConfigs = await getActiveConfigsByProtocol(db, "vless");
    expect(vlessConfigs.length).toBe(2);
    expect(vlessConfigs.every((c) => c.protocol === "vless")).toBe(true);
  });

  it("should count configs correctly", async () => {
    expect(await countConfigs(db)).toBe(0);
    await insertConfig(db, sampleConfig);
    expect(await countConfigs(db)).toBe(1);
    await insertConfig(db, {
      ...sampleConfig,
      config_hash: "hash2",
    });
    expect(await countConfigs(db)).toBe(2);
  });

  it("should count active configs correctly", async () => {
    await insertConfig(db, sampleConfig);
    const second = await insertConfig(db, {
      ...sampleConfig,
      config_hash: "hash2",
    });
    await deactivateConfig(db, second.id);

    expect(await countActiveConfigs(db)).toBe(1);
  });

  it("should count configs by protocol", async () => {
    await insertConfig(db, sampleConfig); // vless
    await insertConfig(db, {
      ...sampleConfig,
      config_hash: "h2",
      protocol: "vmess",
    });
    await insertConfig(db, {
      ...sampleConfig,
      config_hash: "h3",
      protocol: "vmess",
    });

    const counts = await countConfigsByProtocol(db);
    expect(counts["vless"]).toBe(1);
    expect(counts["vmess"]).toBe(2);
  });

  it("should store optional fields as null when not provided", async () => {
    const inserted = await insertConfig(db, sampleConfig);
    const found = await getConfigById(db, inserted.id);

    expect(found!.normalized_uri).toBeNull();
    expect(found!.structured_data).toBeNull();
  });

  it("should store optional fields when provided", async () => {
    const inserted = await insertConfig(db, {
      ...sampleConfig,
      normalized_uri: "vless://encoded",
      structured_data: JSON.stringify({ port: 443 }),
    });
    const found = await getConfigById(db, inserted.id);

    expect(found!.normalized_uri).toBe("vless://encoded");
    expect(found!.structured_data).toBe('{"port":443}');
  });

  // ─── Operator Queries ──────────────────────────────────────

  describe("getActiveConfigsByOperator()", () => {
    it("should return empty array when no matching operator", async () => {
      await insertConfig(db, sampleConfig);
      const result = await getActiveConfigsByOperator(db, "irancell");
      expect(result).toEqual([]);
    });

    it("should return configs linked to batches with matching operator", async () => {
      const c1 = await insertConfig(db, sampleConfig);
      const { insertBatch } = await import("../../src/db/batches");
      const { insertOccurrence } = await import("../../src/db/occurrences");

      const batch = await insertBatch(db, {
        source_type: "admin",
        source_chat_id: 123,
        operator: "irancell",
      });

      await insertOccurrence(db, {
        config_id: c1.id,
        source_type: "admin",
        batch_id: batch.id,
      });

      const result = await getActiveConfigsByOperator(db, "irancell");
      expect(result.length).toBe(1);
      expect(result[0].config_hash).toBe(sampleConfig.config_hash);
    });

    it("should exclude inactive configs from operator results", async () => {
      const c1 = await insertConfig(db, sampleConfig);
      const { insertBatch } = await import("../../src/db/batches");
      const { insertOccurrence } = await import("../../src/db/occurrences");

      const batch = await insertBatch(db, {
        source_type: "admin",
        source_chat_id: 123,
        operator: "irancell",
      });

      await insertOccurrence(db, {
        config_id: c1.id,
        source_type: "admin",
        batch_id: batch.id,
      });

      await deactivateConfig(db, c1.id);

      const result = await getActiveConfigsByOperator(db, "irancell");
      expect(result).toEqual([]);
    });
  });

  describe("countActiveConfigsByOperator()", () => {
    it("should return empty object when no data", async () => {
      const counts = await countActiveConfigsByOperator(db);
      expect(counts).toEqual({});
    });

    it("should count distinct configs per operator", async () => {
      const c1 = await insertConfig(db, sampleConfig);
      const c2 = await insertConfig(db, {
        ...sampleConfig,
        config_hash: "hash2",
        protocol: "vmess",
      });

      const { insertBatch } = await import("../../src/db/batches");
      const { insertOccurrence } = await import("../../src/db/occurrences");

      const b1 = await insertBatch(db, {
        source_type: "admin",
        source_chat_id: 111,
        operator: "irancell",
      });
      const b2 = await insertBatch(db, {
        source_type: "admin",
        source_chat_id: 222,
        operator: "mci",
      });

      await insertOccurrence(db, { config_id: c1.id, source_type: "admin", batch_id: b1.id });
      await insertOccurrence(db, { config_id: c2.id, source_type: "admin", batch_id: b2.id });

      const counts = await countActiveConfigsByOperator(db);
      expect(counts["irancell"]).toBe(1);
      expect(counts["mci"]).toBe(1);
    });

    it("should count same config in same operator only once", async () => {
      const c1 = await insertConfig(db, sampleConfig);
      const { insertBatch } = await import("../../src/db/batches");
      const { insertOccurrence } = await import("../../src/db/occurrences");

      const b1 = await insertBatch(db, {
        source_type: "admin",
        source_chat_id: 111,
        operator: "irancell",
      });
      const b2 = await insertBatch(db, {
        source_type: "admin",
        source_chat_id: 222,
        operator: "irancell",
      });

      await insertOccurrence(db, { config_id: c1.id, source_type: "admin", batch_id: b1.id });
      await insertOccurrence(db, { config_id: c1.id, source_type: "admin", batch_id: b2.id });

      const counts = await countActiveConfigsByOperator(db);
      expect(counts["irancell"]).toBe(1);
    });
  });

  describe("countActiveConfigsWithOccurrences()", () => {
    it("should return 0 for empty database", async () => {
      const count = await countActiveConfigsWithOccurrences(db);
      expect(count).toBe(0);
    });

    it("should count distinct configs with occurrences", async () => {
      const c1 = await insertConfig(db, sampleConfig);
      const c2 = await insertConfig(db, {
        ...sampleConfig,
        config_hash: "hash2",
      });
      const { insertBatch } = await import("../../src/db/batches");
      const { insertOccurrence } = await import("../../src/db/occurrences");

      const batch = await insertBatch(db, {
        source_type: "admin",
        source_chat_id: 111,
      });

      await insertOccurrence(db, { config_id: c1.id, source_type: "admin", batch_id: batch.id });
      await insertOccurrence(db, { config_id: c2.id, source_type: "admin", batch_id: batch.id });

      const count = await countActiveConfigsWithOccurrences(db);
      expect(count).toBe(2);
    });
  });
});
