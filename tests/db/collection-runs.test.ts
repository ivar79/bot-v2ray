/**
 * Database Tests — Collection Runs Table
 *
 * Tests collection run lifecycle: start, complete, fail.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import {
  startCollectionRun,
  getCollectionRunById,
  getCollectionRunsByBatchId,
  getRecentCollectionRuns,
  completeCollectionRun,
  failCollectionRun,
  countCollectionRuns,
  getLastCompletedRun,
} from "../../src/db/collection-runs";

describe("Collection Runs Table", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  it("should start a collection run", async () => {
    const run = await startCollectionRun(db, {
      trigger_type: "admin_upload",
    });

    expect(run.id).toBeGreaterThan(0);
    expect(run.trigger_type).toBe("admin_upload");
    expect(run.status).toBe("running");
    expect(run.batch_id).toBeNull();
    expect(run.update_id).toBeNull();
    expect(run.configs_extracted).toBe(0);
    expect(run.started_at).toBeDefined();
    expect(run.completed_at).toBeNull();
  });

  it("should start a run with batch and update_id", async () => {
    const run = await startCollectionRun(db, {
      trigger_type: "channel_post",
      batch_id: 42,
      update_id: 1001,
    });

    expect(run.batch_id).toBe(42);
    expect(run.update_id).toBe(1001);
  });

  it("should retrieve a run by id", async () => {
    const started = await startCollectionRun(db, {
      trigger_type: "admin_upload",
    });

    const found = await getCollectionRunById(db, started.id);
    expect(found).not.toBeNull();
    expect(found!.status).toBe("running");
  });

  it("should return null for non-existent id", async () => {
    const found = await getCollectionRunById(db, 99999);
    expect(found).toBeNull();
  });

  it("should complete a collection run with stats", async () => {
    const run = await startCollectionRun(db, {
      trigger_type: "admin_upload",
    });

    await completeCollectionRun(db, run.id, {
      configs_extracted: 100,
      configs_valid: 92,
      configs_new: 70,
      configs_duplicate: 22,
    });

    const completed = await getCollectionRunById(db, run.id);
    expect(completed!.status).toBe("completed");
    expect(completed!.completed_at).toBeDefined();
    expect(completed!.configs_extracted).toBe(100);
    expect(completed!.configs_valid).toBe(92);
    expect(completed!.configs_new).toBe(70);
    expect(completed!.configs_duplicate).toBe(22);
  });

  it("should fail a collection run with error message", async () => {
    const run = await startCollectionRun(db, {
      trigger_type: "admin_upload",
    });

    await failCollectionRun(db, run.id, "Telegram API timeout");

    const failed = await getCollectionRunById(db, run.id);
    expect(failed!.status).toBe("error");
    expect(failed!.completed_at).toBeDefined();
    expect(failed!.error_message).toBe("Telegram API timeout");
  });

  it("should get collection runs by batch_id", async () => {
    await startCollectionRun(db, { trigger_type: "admin_upload", batch_id: 1 });
    await startCollectionRun(db, { trigger_type: "admin_upload", batch_id: 1 });
    await startCollectionRun(db, { trigger_type: "admin_upload", batch_id: 2 });

    const runs = await getCollectionRunsByBatchId(db, 1);
    expect(runs.length).toBe(2);
  });

  it("should get recent collection runs with limit", async () => {
    await startCollectionRun(db, { trigger_type: "admin_upload" });
    await startCollectionRun(db, { trigger_type: "admin_upload" });
    await startCollectionRun(db, { trigger_type: "admin_upload" });

    const recent = await getRecentCollectionRuns(db, 2);
    expect(recent.length).toBe(2);
  });

  it("should count collection runs", async () => {
    expect(await countCollectionRuns(db)).toBe(0);

    await startCollectionRun(db, { trigger_type: "admin_upload" });
    expect(await countCollectionRuns(db)).toBe(1);

    await startCollectionRun(db, { trigger_type: "channel_post" });
    expect(await countCollectionRuns(db)).toBe(2);
  });

  it("should get the last completed run", async () => {
    const run1 = await startCollectionRun(db, { trigger_type: "admin_upload" });
    await completeCollectionRun(db, run1.id, {
      configs_extracted: 50,
      configs_valid: 45,
      configs_new: 40,
      configs_duplicate: 5,
    });

    const run2 = await startCollectionRun(db, { trigger_type: "channel_post" });
    await completeCollectionRun(db, run2.id, {
      configs_extracted: 30,
      configs_valid: 28,
      configs_new: 25,
      configs_duplicate: 3,
    });

    const last = await getLastCompletedRun(db);
    expect(last).not.toBeNull();
    expect(last!.id).toBe(run2.id);
  });

  it("should return null for last completed run when none completed", async () => {
    await startCollectionRun(db, { trigger_type: "admin_upload" });

    const last = await getLastCompletedRun(db);
    expect(last).toBeNull();
  });
});
