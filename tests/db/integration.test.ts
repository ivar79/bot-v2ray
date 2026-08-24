/**
 * Database Tests — Integration / Foreign Key Behavior
 *
 * Tests cross-table relationships and data integrity.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { insertConfig, getActiveConfigs, countConfigs } from "../../src/db/configs";
import { insertBatch, updateBatchStats } from "../../src/db/batches";
import {
  insertOccurrence,
  getOccurrencesByConfigId,
  getOccurrencesByBatchId,
  countOccurrences,
} from "../../src/db/occurrences";
import { insertSource, getSourceByChatId } from "../../src/db/sources";
import { markUpdateProcessed, isUpdateProcessed } from "../../src/db/updates";
import { setSetting, getSetting } from "../../src/db/settings";
import {
  startCollectionRun,
  completeCollectionRun,
} from "../../src/db/collection-runs";

describe("Database Integration", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  it("should link config → occurrence → batch correctly", async () => {
    // Create a config
    const config = await insertConfig(db, {
      protocol: "vmess",
      raw: "vmess://encoded123",
      canonical: "vmess://canonical123",
      config_hash: "integration_hash_1",
    });

    // Create a batch with operator metadata
    const batch = await insertBatch(db, {
      source_type: "admin",
      operator: "irancell",
    });

    // Create an occurrence linking config to batch
    const occ = await insertOccurrence(db, {
      config_id: config.id,
      source_type: "admin",
      source_chat_id: 123456,
      batch_id: batch.id,
      raw_at_occurrence: "vmess://encoded123",
    });

    // Verify the relationship
    expect(occ.config_id).toBe(config.id);
    expect(occ.batch_id).toBe(batch.id);

    // Config should appear in occurrences
    const configOccs = await getOccurrencesByConfigId(db, config.id);
    expect(configOccs.length).toBe(1);

    // Batch should contain this occurrence
    const batchOccs = await getOccurrencesByBatchId(db, batch.id);
    expect(batchOccs.length).toBe(1);
  });

  it("should support dedup scenario: same config, multiple batches", async () => {
    const config = await insertConfig(db, {
      protocol: "vless",
      raw: "vless://dedup@example.com:443",
      canonical: "vless://dedup@example.com:443/",
      config_hash: "dedup_hash",
    });

    const batch1 = await insertBatch(db, {
      source_type: "admin",
      operator: "irancell",
    });

    const batch2 = await insertBatch(db, {
      source_type: "trusted_channel",
    });

    // Same config, different batches/sources
    await insertOccurrence(db, {
      config_id: config.id,
      source_type: "admin",
      batch_id: batch1.id,
      source_chat_id: 123456,
    });

    await insertOccurrence(db, {
      config_id: config.id,
      source_type: "trusted_channel",
      batch_id: batch2.id,
      source_chat_id: -100111,
    });

    // Only ONE canonical config
    expect(await countConfigs(db)).toBe(1);
    // But TWO occurrences
    expect(await countOccurrences(db)).toBe(2);

    // Config appears in both batches
    const occs = await getOccurrencesByConfigId(db, config.id);
    expect(occs.length).toBe(2);
  });

  it("should support full admin upload workflow", async () => {
    // 1. Record processed update for idempotency
    const updateId = 10001;
    const alreadyProcessed = await isUpdateProcessed(db, updateId);
    expect(alreadyProcessed).toBe(false);

    // 2. Create collection run
    const run = await startCollectionRun(db, {
      trigger_type: "admin_upload",
      update_id: updateId,
    });

    // 3. Create batch with operator metadata
    const batch = await insertBatch(db, {
      source_type: "admin",
      source_chat_id: 123456,
      source_message_id: 100,
      update_id: updateId,
      operator: "irancell",
      verification_status: "admin_verified",
      verified_by: 123456,
    });

    // 4. Process configs (simulating 3 unique configs)
    const configs = [];
    for (let i = 0; i < 3; i++) {
      const c = await insertConfig(db, {
        protocol: "vless",
        raw: `vless://config${i}@example.com:443`,
        canonical: `vless://config${i}@example.com:443/`,
        config_hash: `admin_hash_${i}`,
      });
      configs.push(c);

      await insertOccurrence(db, {
        config_id: c.id,
        source_type: "admin",
        source_chat_id: 123456,
        source_message_id: 100,
        batch_id: batch.id,
      });
    }

    // 5. Update batch stats
    await updateBatchStats(db, batch.id, {
      total_extracted: 3,
      valid_count: 3,
      invalid_count: 0,
      new_count: 3,
      duplicate_count: 0,
    });

    // 6. Complete collection run
    await completeCollectionRun(db, run.id, {
      configs_extracted: 3,
      configs_valid: 3,
      configs_new: 3,
      configs_duplicate: 0,
    });

    // 7. Mark update as processed (idempotency)
    await markUpdateProcessed(db, updateId);

    // Verify everything
    expect(await countConfigs(db)).toBe(3);
    expect(await isUpdateProcessed(db, updateId)).toBe(true);

    const activeConfigs = await getActiveConfigs(db);
    expect(activeConfigs.length).toBe(3);
  });

  it("should support settings alongside database operations", async () => {
    // Store system configuration
    await setSetting(db, "admin.user_ids", JSON.stringify([123456, 789012]));
    await setSetting(db, "telegram.output_channel", "-1001234567890");
    await setSetting(db, "github.owner", "testuser");
    await setSetting(db, "github.repo", "v2ray-configs");

    // Retrieve settings
    expect(await getSetting(db, "admin.user_ids")).toBe(
      JSON.stringify([123456, 789012])
    );
    expect(await getSetting(db, "telegram.output_channel")).toBe(
      "-1001234567890"
    );

    // Settings don't interfere with config operations
    const config = await insertConfig(db, {
      protocol: "trojan",
      raw: "trojan://test@example.com",
      canonical: "trojan://test@example.com/",
      config_hash: "settings_test_hash",
    });
    expect(config.id).toBeGreaterThan(0);
  });

  it("should handle source with batch correctly", async () => {
    // Create a trusted source
    const source = await insertSource(db, {
      chat_id: -1009999999999,
      title: "Test Channel",
      username: "test_channel",
      trusted: 1,
    });

    // Create a batch from that source
    const batch = await insertBatch(db, {
      source_type: "trusted_channel",
      source_chat_id: source.chat_id,
      operator: "unknown",
    });

    // Verify source can be looked up by chat_id
    const found = await getSourceByChatId(db, source.chat_id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Test Channel");

    // Batch should reference the same chat_id
    expect(batch.source_chat_id).toBe(source.chat_id);
  });
});
