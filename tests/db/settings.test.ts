/**
 * Database Tests — Settings Table
 *
 * Tests settings get/set, upsert, delete, and JSON handling.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import {
  getSetting,
  getSettingJSON,
  setSetting,
  setSettingJSON,
  deleteSetting,
  getAllSettings,
  settingExists,
  countSettings,
} from "../../src/db/settings";

describe("Settings Table", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  it("should set and get a string value", async () => {
    await setSetting(db, "bot.welcome_message", "Hello!");
    const value = await getSetting(db, "bot.welcome_message");

    expect(value).toBe("Hello!");
  });

  it("should return null for non-existent key", async () => {
    const value = await getSetting(db, "nonexistent");
    expect(value).toBeNull();
  });

  it("should upsert (overwrite) existing key", async () => {
    await setSetting(db, "test_key", "value1");
    await setSetting(db, "test_key", "value2");

    const value = await getSetting(db, "test_key");
    expect(value).toBe("value2");
    expect(await countSettings(db)).toBe(1);
  });

  it("should set and get JSON values", async () => {
    const data = { owner_id: 123456, channels: [-100111, -100222] };
    await setSettingJSON(db, "github.config", data);

    const result = await getSettingJSON<{ owner_id: number; channels: number[] }>(
      db,
      "github.config"
    );

    expect(result).toEqual(data);
  });

  it("should return null for invalid JSON in getSettingJSON", async () => {
    await setSetting(db, "bad_json", "not valid json {{{");
    const result = await getSettingJSON(db, "bad_json");
    expect(result).toBeNull();
  });

  it("should delete a setting", async () => {
    await setSetting(db, "to_delete", "value");
    expect(await settingExists(db, "to_delete")).toBe(true);

    const deleted = await deleteSetting(db, "to_delete");
    expect(deleted).toBe(true);
    expect(await settingExists(db, "to_delete")).toBe(false);
  });

  it("should return false when deleting non-existent key", async () => {
    const deleted = await deleteSetting(db, "nonexistent");
    expect(deleted).toBe(false);
  });

  it("should get all settings", async () => {
    await setSetting(db, "key_a", "value_a");
    await setSetting(db, "key_b", "value_b");
    await setSetting(db, "key_c", "value_c");

    const all = await getAllSettings(db);
    expect(all.length).toBe(3);
    // Sorted by key
    expect(all[0].key).toBe("key_a");
    expect(all[1].key).toBe("key_b");
    expect(all[2].key).toBe("key_c");
  });

  it("should check if setting exists", async () => {
    expect(await settingExists(db, "exists_check")).toBe(false);
    await setSetting(db, "exists_check", "yes");
    expect(await settingExists(db, "exists_check")).toBe(true);
  });

  it("should count settings", async () => {
    expect(await countSettings(db)).toBe(0);
    await setSetting(db, "s1", "v1");
    expect(await countSettings(db)).toBe(1);
    await setSetting(db, "s2", "v2");
    expect(await countSettings(db)).toBe(2);
    // Upsert should not increase count
    await setSetting(db, "s1", "v1_new");
    expect(await countSettings(db)).toBe(2);
  });

  it("should store admin IDs as JSON", async () => {
    const adminIds = [123456789, 987654321];
    await setSettingJSON(db, "admin.user_ids", adminIds);

    const result = await getSettingJSON<number[]>(db, "admin.user_ids");
    expect(result).toEqual(adminIds);
  });

  it("should store channel configuration", async () => {
    const channelConfig = {
      output_channel_id: -1001234567890,
      trusted_sources: [
        { chat_id: -1001111111111, username: "v2ray_free" },
        { chat_id: -1002222222222, username: "v2ray_tests" },
      ],
    };
    await setSettingJSON(db, "telegram.channels", channelConfig);

    const result = await getSettingJSON<typeof channelConfig>(
      db,
      "telegram.channels"
    );
    expect(result).toEqual(channelConfig);
  });
});
