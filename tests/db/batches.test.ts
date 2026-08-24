/**
 * Database Tests — Batches Table
 *
 * Tests batch creation, lookup, stats update, and operator metadata.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import {
  insertBatch,
  getBatchById,
  getBatchesBySource,
  getBatchByUpdateId,
  getAllBatches,
  updateBatchStats,
  updateBatchOperator,
  countBatches,
  countBatchesByOperator,
} from "../../src/db/batches";

describe("Batches Table", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  const sampleBatch = {
    source_type: "admin",
    source_chat_id: 123456789,
    source_message_id: 100,
    update_id: 1,
    operator: "irancell",
    verification_status: "admin_verified",
    verification_method: "admin_upload",
    verified_by: 123456789,
    notes: "Test batch from admin",
  };

  it("should insert a batch and retrieve it", async () => {
    const inserted = await insertBatch(db, sampleBatch);

    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.source_type).toBe("admin");
    expect(inserted.source_chat_id).toBe(123456789);
    expect(inserted.operator).toBe("irancell");
    expect(inserted.verification_status).toBe("admin_verified");
    expect(inserted.verification_method).toBe("admin_upload");
    expect(inserted.verified_by).toBe(123456789);
    expect(inserted.notes).toBe("Test batch from admin");
    expect(inserted.total_extracted).toBe(0);
    expect(inserted.valid_count).toBe(0);
    expect(inserted.new_count).toBe(0);
    expect(inserted.duplicate_count).toBe(0);
    expect(inserted.created_at).toBeDefined();
  });

  it("should use default values when optional fields omitted", async () => {
    const inserted = await insertBatch(db, { source_type: "admin" });

    expect(inserted.operator).toBe("unknown");
    expect(inserted.verification_status).toBe("admin_supplied");
    expect(inserted.verification_method).toBe("admin_upload");
    expect(inserted.confidence).toBe("admin");
    expect(inserted.source_chat_id).toBeNull();
    expect(inserted.source_message_id).toBeNull();
    expect(inserted.update_id).toBeNull();
  });

  it("should retrieve by id", async () => {
    const inserted = await insertBatch(db, sampleBatch);
    const found = await getBatchById(db, inserted.id);

    expect(found).not.toBeNull();
    expect(found!.operator).toBe("irancell");
  });

  it("should return null for non-existent id", async () => {
    const found = await getBatchById(db, 99999);
    expect(found).toBeNull();
  });

  it("should get batches by source", async () => {
    await insertBatch(db, sampleBatch);
    await insertBatch(db, {
      ...sampleBatch,
      source_message_id: 200,
      update_id: 2,
    });
    await insertBatch(db, {
      source_type: "trusted_channel",
      source_chat_id: -1001111111111,
    });

    const adminBatches = await getBatchesBySource(
      db,
      "admin",
      123456789
    );
    expect(adminBatches.length).toBe(2);
  });

  it("should get batch by update_id", async () => {
    await insertBatch(db, sampleBatch);

    const found = await getBatchByUpdateId(db, 1);
    expect(found).not.toBeNull();
    expect(found!.update_id).toBe(1);
  });

  it("should return null for non-existent update_id", async () => {
    const found = await getBatchByUpdateId(db, 99999);
    expect(found).toBeNull();
  });

  it("should get all batches", async () => {
    await insertBatch(db, sampleBatch);
    await insertBatch(db, { source_type: "trusted_channel", source_chat_id: -1002222222222 });

    const all = await getAllBatches(db);
    expect(all.length).toBe(2);
  });

  it("should update batch stats", async () => {
    const inserted = await insertBatch(db, sampleBatch);

    await updateBatchStats(db, inserted.id, {
      total_extracted: 100,
      valid_count: 92,
      invalid_count: 8,
      new_count: 70,
      duplicate_count: 22,
    });

    const updated = await getBatchById(db, inserted.id);
    expect(updated!.total_extracted).toBe(100);
    expect(updated!.valid_count).toBe(92);
    expect(updated!.invalid_count).toBe(8);
    expect(updated!.new_count).toBe(70);
    expect(updated!.duplicate_count).toBe(22);
  });

  it("should update batch operator metadata", async () => {
    const inserted = await insertBatch(db, sampleBatch);

    await updateBatchOperator(db, inserted.id, {
      operator: "mci",
      notes: "Updated to MCI",
    });

    const updated = await getBatchById(db, inserted.id);
    expect(updated!.operator).toBe("mci");
    expect(updated!.notes).toBe("Updated to MCI");
  });

  it("should return current batch when no operator updates provided", async () => {
    const inserted = await insertBatch(db, sampleBatch);
    const unchanged = await updateBatchOperator(db, inserted.id, {});

    expect(unchanged).not.toBeNull();
    expect(unchanged!.operator).toBe("irancell");
  });

  it("should count batches", async () => {
    expect(await countBatches(db)).toBe(0);
    await insertBatch(db, sampleBatch);
    expect(await countBatches(db)).toBe(1);
  });

  it("should count batches by operator", async () => {
    await insertBatch(db, sampleBatch);
    await insertBatch(db, { source_type: "admin", operator: "mci" });
    await insertBatch(db, { source_type: "admin", operator: "mci" });

    const counts = await countBatchesByOperator(db);
    expect(counts["irancell"]).toBe(1);
    expect(counts["mci"]).toBe(2);
  });
});
