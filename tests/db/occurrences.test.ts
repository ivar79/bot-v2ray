/**
 * Database Tests — Occurrences Table
 *
 * Tests occurrence creation and config/batch relationships.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { insertConfig } from "../../src/db/configs";
import { insertBatch } from "../../src/db/batches";
import {
  insertOccurrence,
  getOccurrenceById,
  getOccurrencesByConfigId,
  getOccurrencesByBatchId,
  touchOccurrence,
  countOccurrencesByConfigId,
  countOccurrences,
} from "../../src/db/occurrences";

describe("Occurrences Table", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  // Helper to create a config and batch for occurrence tests
  async function setupPrerequisites() {
    const config = await insertConfig(db, {
      protocol: "vless",
      raw: "vless://abc@example.com:443#test",
      canonical: "vless://abc@example.com:443/#test",
      config_hash: "hash_occ_1",
    });
    const batch = await insertBatch(db, {
      source_type: "admin",
      source_chat_id: 123456,
      operator: "irancell",
    });
    return { config, batch };
  }

  it("should insert an occurrence", async () => {
    const { config, batch } = await setupPrerequisites();

    const occ = await insertOccurrence(db, {
      config_id: config.id,
      source_type: "admin",
      source_chat_id: 123456,
      source_message_id: 100,
      batch_id: batch.id,
      raw_at_occurrence: "vless://abc@example.com:443#test",
    });

    expect(occ.id).toBeGreaterThan(0);
    expect(occ.config_id).toBe(config.id);
    expect(occ.source_type).toBe("admin");
    expect(occ.source_chat_id).toBe(123456);
    expect(occ.batch_id).toBe(batch.id);
    expect(occ.raw_at_occurrence).toBe("vless://abc@example.com:443#test");
  });

  it("should get occurrence by id", async () => {
    const { config, batch } = await setupPrerequisites();
    const inserted = await insertOccurrence(db, {
      config_id: config.id,
      source_type: "admin",
      batch_id: batch.id,
    });

    const found = await getOccurrenceById(db, inserted.id);
    expect(found).not.toBeNull();
    expect(found!.config_id).toBe(config.id);
  });

  it("should return null for non-existent id", async () => {
    const found = await getOccurrenceById(db, 99999);
    expect(found).toBeNull();
  });

  it("should get occurrences by config_id", async () => {
    const { config, batch } = await setupPrerequisites();

    // Config appears in multiple batches
    await insertOccurrence(db, {
      config_id: config.id,
      source_type: "admin",
      batch_id: batch.id,
    });
    await insertOccurrence(db, {
      config_id: config.id,
      source_type: "trusted_channel",
      source_chat_id: -100111,
    });

    const occs = await getOccurrencesByConfigId(db, config.id);
    expect(occs.length).toBe(2);
  });

  it("should get occurrences by batch_id", async () => {
    const { config, batch } = await setupPrerequisites();

    await insertOccurrence(db, {
      config_id: config.id,
      source_type: "admin",
      batch_id: batch.id,
    });

    const occs = await getOccurrencesByBatchId(db, batch.id);
    expect(occs.length).toBe(1);
  });

  it("should touch occurrence (update last_seen)", async () => {
    const { config } = await setupPrerequisites();
    const occ = await insertOccurrence(db, {
      config_id: config.id,
      source_type: "admin",
    });
    const originalLastSeen = occ.last_seen;

    await new Promise((r) => setTimeout(r, 10));
    await touchOccurrence(db, occ.id);

    const updated = await getOccurrenceById(db, occ.id);
    expect(updated!.last_seen).not.toBe(originalLastSeen);
  });

  it("should count occurrences for a config", async () => {
    const { config, batch } = await setupPrerequisites();

    await insertOccurrence(db, {
      config_id: config.id,
      source_type: "admin",
      batch_id: batch.id,
    });
    await insertOccurrence(db, {
      config_id: config.id,
      source_type: "trusted_channel",
      source_chat_id: -100222,
    });

    const count = await countOccurrencesByConfigId(db, config.id);
    expect(count).toBe(2);
  });

  it("should count total occurrences", async () => {
    expect(await countOccurrences(db)).toBe(0);

    const { config } = await setupPrerequisites();
    await insertOccurrence(db, {
      config_id: config.id,
      source_type: "admin",
    });
    expect(await countOccurrences(db)).toBe(1);
  });

  it("should support optional fields as null", async () => {
    const { config } = await setupPrerequisites();
    const occ = await insertOccurrence(db, {
      config_id: config.id,
      source_type: "admin",
    });

    expect(occ.source_chat_id).toBeNull();
    expect(occ.source_message_id).toBeNull();
    expect(occ.batch_id).toBeNull();
    expect(occ.raw_at_occurrence).toBeNull();
  });
});
