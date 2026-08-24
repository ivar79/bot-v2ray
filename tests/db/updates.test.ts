/**
 * Database Tests — Processed Updates Table
 *
 * Tests webhook idempotency via processed_updates.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import {
  markUpdateProcessed,
  isUpdateProcessed,
  cleanupOldUpdates,
  countProcessedUpdates,
} from "../../src/db/updates";

describe("Processed Updates Table", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  it("should mark an update as processed", async () => {
    const result = await markUpdateProcessed(db, 1001);
    expect(result).toBe(true);
  });

  it("should detect already processed update (idempotency)", async () => {
    await markUpdateProcessed(db, 1001);

    // Second time should return false (duplicate)
    const result = await markUpdateProcessed(db, 1001);
    expect(result).toBe(false);
  });

  it("should check if update is processed", async () => {
    expect(await isUpdateProcessed(db, 1001)).toBe(false);

    await markUpdateProcessed(db, 1001);
    expect(await isUpdateProcessed(db, 1001)).toBe(true);
  });

  it("should handle multiple different updates", async () => {
    await markUpdateProcessed(db, 1001);
    await markUpdateProcessed(db, 1002);
    await markUpdateProcessed(db, 1003);

    expect(await isUpdateProcessed(db, 1001)).toBe(true);
    expect(await isUpdateProcessed(db, 1002)).toBe(true);
    expect(await isUpdateProcessed(db, 1003)).toBe(true);
    expect(await isUpdateProcessed(db, 1004)).toBe(false);
  });

  it("should count processed updates", async () => {
    expect(await countProcessedUpdates(db)).toBe(0);

    await markUpdateProcessed(db, 1001);
    expect(await countProcessedUpdates(db)).toBe(1);

    await markUpdateProcessed(db, 1002);
    expect(await countProcessedUpdates(db)).toBe(2);

    // Duplicate should not increase count
    await markUpdateProcessed(db, 1001);
    expect(await countProcessedUpdates(db)).toBe(2);
  });

  it("should clean up old records", async () => {
    // Insert some records
    await markUpdateProcessed(db, 1001);
    await markUpdateProcessed(db, 1002);

    // With a very old threshold, nothing should be cleaned (records are new)
    const cleaned = await cleanupOldUpdates(db, 365);
    expect(cleaned).toBe(0);

    // All records should still be there
    expect(await countProcessedUpdates(db)).toBe(2);
  });
});
