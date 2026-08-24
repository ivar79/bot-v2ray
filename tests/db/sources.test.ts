/**
 * Database Tests — Sources Table
 *
 * Tests source creation, update, lookup, and deletion.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import {
  insertSource,
  getSourceById,
  getSourceByChatId,
  getEnabledSources,
  getTrustedSources,
  getAllSources,
  updateSource,
  deleteSource,
  countSources,
  isSourceEnabled,
} from "../../src/db/sources";

describe("Sources Table", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  const sampleSource = {
    chat_id: -1001234567890,
    title: "V2Ray Configs Channel",
    username: "v2ray_configs",
    trusted: 1,
  };

  it("should insert a source and retrieve it", async () => {
    const inserted = await insertSource(db, sampleSource);

    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.chat_id).toBe(-1001234567890);
    expect(inserted.type).toBe("trusted_channel");
    expect(inserted.title).toBe("V2Ray Configs Channel");
    expect(inserted.username).toBe("v2ray_configs");
    expect(inserted.enabled).toBe(1);
    expect(inserted.trusted).toBe(1);
    expect(inserted.created_at).toBeDefined();
  });

  it("should use default values when optional fields omitted", async () => {
    const inserted = await insertSource(db, { chat_id: -1009999999999 });

    expect(inserted.type).toBe("trusted_channel");
    expect(inserted.enabled).toBe(1);
    expect(inserted.trusted).toBe(0);
    expect(inserted.title).toBeNull();
    expect(inserted.username).toBeNull();
  });

  it("should reject duplicate chat_id (UNIQUE constraint)", async () => {
    await insertSource(db, sampleSource);

    await expect(
      insertSource(db, { ...sampleSource, title: "Duplicate" })
    ).rejects.toThrow();
  });

  it("should retrieve by id", async () => {
    const inserted = await insertSource(db, sampleSource);
    const found = await getSourceById(db, inserted.id);

    expect(found).not.toBeNull();
    expect(found!.chat_id).toBe(sampleSource.chat_id);
  });

  it("should retrieve by chat_id", async () => {
    await insertSource(db, sampleSource);
    const found = await getSourceByChatId(db, sampleSource.chat_id);

    expect(found).not.toBeNull();
    expect(found!.title).toBe("V2Ray Configs Channel");
  });

  it("should return null for non-existent chat_id", async () => {
    const found = await getSourceByChatId(db, -999999);
    expect(found).toBeNull();
  });

  it("should get only enabled sources", async () => {
    await insertSource(db, sampleSource);
    const disabled = await insertSource(db, {
      chat_id: -1002222222222,
      enabled: 0,
    });

    const enabled = await getEnabledSources(db);
    expect(enabled.length).toBe(1);
    expect(enabled[0].chat_id).toBe(sampleSource.chat_id);
  });

  it("should get only trusted sources", async () => {
    await insertSource(db, sampleSource);
    await insertSource(db, {
      chat_id: -1003333333333,
      trusted: 0,
    });

    const trusted = await getTrustedSources(db);
    expect(trusted.length).toBe(1);
    expect(trusted[0].trusted).toBe(1);
  });

  it("should get all sources", async () => {
    await insertSource(db, sampleSource);
    await insertSource(db, { chat_id: -1003333333333 });

    const all = await getAllSources(db);
    expect(all.length).toBe(2);
  });

  it("should update source fields", async () => {
    await insertSource(db, sampleSource);

    const updated = await updateSource(db, sampleSource.chat_id, {
      title: "Updated Title",
      trusted: 0,
    });

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("Updated Title");
    expect(updated!.trusted).toBe(0);
    expect(updated!.chat_id).toBe(sampleSource.chat_id);
  });

  it("should return current source when no updates provided", async () => {
    await insertSource(db, sampleSource);
    const unchanged = await updateSource(db, sampleSource.chat_id, {});

    expect(unchanged).not.toBeNull();
    expect(unchanged!.title).toBe("V2Ray Configs Channel");
  });

  it("should delete a source", async () => {
    await insertSource(db, sampleSource);
    expect(await countSources(db)).toBe(1);

    await deleteSource(db, sampleSource.chat_id);
    expect(await countSources(db)).toBe(0);
    expect(await getSourceByChatId(db, sampleSource.chat_id)).toBeNull();
  });

  it("should count sources", async () => {
    expect(await countSources(db)).toBe(0);
    await insertSource(db, sampleSource);
    expect(await countSources(db)).toBe(1);
    await insertSource(db, { chat_id: -1003333333333 });
    expect(await countSources(db)).toBe(2);
  });

  it("should check if source is enabled", async () => {
    expect(await isSourceEnabled(db, sampleSource.chat_id)).toBe(false);

    await insertSource(db, sampleSource);
    expect(await isSourceEnabled(db, sampleSource.chat_id)).toBe(true);

    await updateSource(db, sampleSource.chat_id, { enabled: 0 });
    expect(await isSourceEnabled(db, sampleSource.chat_id)).toBe(false);
  });
});
