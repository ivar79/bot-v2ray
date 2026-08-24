/**
 * Database Tests — Admin States Table
 *
 * Tests admin state get/set/clear and conversation flow tracking.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import {
  getAdminState,
  getAdminStateName,
  setAdminState,
  clearAdminState,
  getAllAdminStates,
  getActiveAdminStates,
  deleteAdminState,
} from "../../src/db/admin-states";

describe("Admin States Table", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  it("should return null when no state exists", async () => {
    const state = await getAdminState(db, 123456789);
    expect(state).toBeNull();
  });

  it("should return 'idle' as default state name", async () => {
    const name = await getAdminStateName(db, 123456789);
    expect(name).toBe("idle");
  });

  it("should set admin state", async () => {
    await setAdminState(db, 123456789, "awaiting_operator", {
      batch_id: 42,
      raw_configs: ["vless://..."],
    });

    const state = await getAdminState(db, 123456789);
    expect(state).not.toBeNull();
    expect(state!.user_id).toBe(123456789);
    expect(state!.state).toBe("awaiting_operator");
    expect(state!.context).toBeDefined();

    const context = JSON.parse(state!.context!);
    expect(context.batch_id).toBe(42);
    expect(context.raw_configs).toEqual(["vless://..."]);
  });

  it("should upsert admin state", async () => {
    await setAdminState(db, 123456789, "awaiting_operator");
    await setAdminState(db, 123456789, "processing_batch");

    const name = await getAdminStateName(db, 123456789);
    expect(name).toBe("processing_batch");
  });

  it("should clear admin state back to idle", async () => {
    await setAdminState(db, 123456789, "awaiting_operator", {
      batch_id: 42,
    });
    await clearAdminState(db, 123456789);

    const state = await getAdminState(db, 123456789);
    expect(state).not.toBeNull();
    expect(state!.state).toBe("idle");
    expect(state!.context).toBeNull();
  });

  it("should get all admin states", async () => {
    await setAdminState(db, 111, "awaiting_operator");
    await setAdminState(db, 222, "processing_batch");

    const all = await getAllAdminStates(db);
    expect(all.length).toBe(2);
  });

  it("should get only active (non-idle) admin states", async () => {
    await setAdminState(db, 111, "awaiting_operator");
    await setAdminState(db, 222, "idle");
    await setAdminState(db, 333, "processing_batch");

    const active = await getActiveAdminStates(db);
    expect(active.length).toBe(2);
    expect(active.every((s) => s.state !== "idle")).toBe(true);
  });

  it("should delete admin state entirely", async () => {
    await setAdminState(db, 123456789, "awaiting_operator");
    await deleteAdminState(db, 123456789);

    const state = await getAdminState(db, 123456789);
    expect(state).toBeNull();
  });

  it("should handle admin state without context", async () => {
    await setAdminState(db, 123456789, "idle");

    const state = await getAdminState(db, 123456789);
    expect(state).not.toBeNull();
    expect(state!.context).toBeNull();
  });

  it("should track conversation flow lifecycle", async () => {
    const userId = 123456789;

    // Step 1: Admin sends /upload → state becomes awaiting_operator
    await setAdminState(db, userId, "awaiting_operator", {
      pending_configs: ["vless://..."],
    });
    expect(await getAdminStateName(db, userId)).toBe("awaiting_operator");

    // Step 2: Admin selects operator → state becomes processing
    await setAdminState(db, userId, "processing_batch", {
      batch_id: 1,
      operator: "irancell",
    });
    expect(await getAdminStateName(db, userId)).toBe("processing_batch");

    // Step 3: Processing complete → state becomes idle
    await clearAdminState(db, userId);
    expect(await getAdminStateName(db, userId)).toBe("idle");
  });
});
