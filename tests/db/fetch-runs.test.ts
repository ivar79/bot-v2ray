/**
 * Tests â€” fetch_runs lifecycle and staleness handling
 *
 * Verifies that orphaned (crashed) fetch runs no longer block new fetches
 * after the staleness window has passed.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import {
  createFetchRun,
  getFetchRun,
  getActiveFetchRun,
  cleanupStaleFetchRuns,
  STALE_FETCH_RUN_MINUTES,
} from "../../src/db/fetch-runs";
import { cancelFetch } from "../../src/ingest/subscription";

describe("fetch-runs", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  it("returns a fresh running run as active", async () => {
    await createFetchRun(db, "flow-fresh", 111, 111);

    const run = await getActiveFetchRun(db, 111, 111);
    expect(run).not.toBeNull();
    expect(run!.flow_id).toBe("flow-fresh");
  });

  it("returns null when no run exists for the user/chat", async () => {
    await createFetchRun(db, "flow-other", 111, 111);

    const run = await getActiveFetchRun(db, 222, 222);
    expect(run).toBeNull();
  });

  it("ignores orphaned running runs older than the staleness window (ISO format, like production)", async () => {
    await createFetchRun(db, "flow-stale", 222, 222);
    // Production writes started_at via new Date().toISOString() (T + Z format).
    // This is the regression test for the format-mismatch bug that made every
    // run look fresh forever ('T' sorts after ' ' in SQLite string comparison).
    const iso = new Date(Date.now() - (STALE_FETCH_RUN_MINUTES + 5) * 60_000).toISOString();
    await db.prepare(
      "UPDATE fetch_runs SET started_at = ? WHERE flow_id = ?"
    ).bind(iso, "flow-stale").run();

    const run = await getActiveFetchRun(db, 222, 222);
    expect(run).toBeNull();
  });

  it("still reports a recent running run as active (ISO format, like production)", async () => {
    await createFetchRun(db, "flow-recent", 333, 333);
    const iso = new Date(Date.now() - 2 * 60_000).toISOString();
    await db.prepare(
      "UPDATE fetch_runs SET started_at = ? WHERE flow_id = ?"
    ).bind(iso, "flow-recent").run();

    const run = await getActiveFetchRun(db, 333, 333);
    expect(run).not.toBeNull();
    expect(run!.flow_id).toBe("flow-recent");
  });

  it("cleanupStaleFetchRuns marks old ISO-format runs as failed", async () => {
    await createFetchRun(db, "flow-old", 444, 444);
    const iso = new Date(Date.now() - 40 * 60_000).toISOString();
    await db.prepare(
      "UPDATE fetch_runs SET started_at = ? WHERE flow_id = ?"
    ).bind(iso, "flow-old").run();

    const changed = await cleanupStaleFetchRuns(db);
    expect(changed).toBeGreaterThan(0);

    // After cleanup the run is no longer active
    const run = await getActiveFetchRun(db, 444, 444);
    expect(run).toBeNull();
  });

  it("cancelFetch finishes an orphaned run so it stops blocking new fetches", async () => {
    await createFetchRun(db, "flow-orphan", 555, 555);
    // Older than the staleness window, ISO format (crashed worker scenario)
    const iso = new Date(Date.now() - (STALE_FETCH_RUN_MINUTES + 10) * 60_000).toISOString();
    await db.prepare(
      "UPDATE fetch_runs SET started_at = ? WHERE flow_id = ?"
    ).bind(iso, "flow-orphan").run();

    // No in-memory fetch exists for this flow — DB-only cancel path
    const cancelled = await cancelFetch("flow-orphan", 555, 555, db);
    expect(cancelled).toBe(true);

    const row = await getFetchRun(db, "flow-orphan");
    expect(row).not.toBeNull();
    expect(row!.status).toBe("cancelled");

    // The block is cleared immediately
    const run = await getActiveFetchRun(db, 555, 555);
    expect(run).toBeNull();
  });

  it("cancelFetch returns false when no running row exists", async () => {
    const cancelled = await cancelFetch("flow-none", 777, 777, db);
    expect(cancelled).toBe(false);
  });
});
