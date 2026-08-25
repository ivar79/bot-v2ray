/**
 * Tests — Config Card Formatter
 */

import { describe, it, expect } from "vitest";
import {
  formatConfigCard,
  formatConfigBatchCard,
  checkStaleness,
  STALENESS_THRESHOLD_HOURS,
} from "../../src/output/config-card";
import type { ConfigRow } from "../../src/db/connection";

function makeConfig(overrides: Partial<ConfigRow> = {}): ConfigRow {
  return {
    id: 1,
    protocol: "vless",
    raw: "vless://uuid@server.com:443?security=tls#Test",
    canonical: "vless://uuid@server.com:443",
    config_hash: "abc123",
    normalized_uri: null,
    structured_data: null,
    is_valid: 1,
    active: 1,
    parser_version: "1.0",
    first_seen: "2025-01-01T00:00:00Z",
    last_seen: "2025-01-02T00:00:00Z",
    location_country: "Germany",
    location_country_code: "DE",
    location_flag: "🇩🇪",
    location_display: "🇩🇪 Germany",
    ...overrides,
  };
}

describe("Config Card Formatter", () => {
  describe("formatConfigCard()", () => {
    it("should format a basic config card", () => {
      const config = makeConfig();
      const card = formatConfigCard(config);

      expect(card).toContain("🚀 Premium V2Ray Config");
      expect(card).toContain("🇩🇪 Germany");
      expect(card).toContain("📡 Protocol: VLESS");
      expect(card).toContain("⚡ Status: Active");
      expect(card).toContain("vless://uuid@server.com:443?security=tls#Test");
    });

    it("should show Unknown location when no location fields", () => {
      const config = makeConfig({
        location_country: null,
        location_country_code: null,
        location_flag: null,
        location_display: null,
      });
      const card = formatConfigCard(config);
      expect(card).toContain("🌍 Unknown");
    });

    it("should show country without flag when flag is null", () => {
      const config = makeConfig({
        location_flag: null,
        location_country: "Germany",
      });
      const card = formatConfigCard(config);
      expect(card).toContain("🌍 Germany");
    });

    it("should include source channel when provided", () => {
      const config = makeConfig();
      const card = formatConfigCard(config, { sourceChannel: "@MyChannel" });
      expect(card).toContain("📢 Source: @MyChannel");
    });

    it("should not include source channel when not provided", () => {
      const config = makeConfig();
      const card = formatConfigCard(config);
      expect(card).not.toContain("📢 Source:");
    });

    it("should show stale status when checkStale is true and config is stale", () => {
      const config = makeConfig({
        last_seen: "2024-01-01T00:00:00Z", // Very old
      });
      const now = new Date("2025-01-01T00:00:00Z");
      const card = formatConfigCard(config, { checkStale: true });
      expect(card).toContain("⚠️ Stale");
    });

    it("should show active status when checkStale is true and config is fresh", () => {
      const config = makeConfig({
        last_seen: new Date().toISOString(),
      });
      const card = formatConfigCard(config, { checkStale: true });
      expect(card).toContain("✅ Active");
    });

    it("should handle unknown protocol", () => {
      const config = makeConfig({ protocol: "ss" });
      const card = formatConfigCard(config);
      expect(card).toContain("📡 Protocol: Shadowsocks");
    });

    it("should handle hysteria2 protocol", () => {
      const config = makeConfig({ protocol: "hysteria2" });
      const card = formatConfigCard(config);
      expect(card).toContain("📡 Protocol: Hysteria2");
    });

    it("should format VMess protocol", () => {
      const config = makeConfig({ protocol: "vmess" });
      const card = formatConfigCard(config);
      expect(card).toContain("📡 Protocol: VMess");
    });

    it("should format Trojan protocol", () => {
      const config = makeConfig({ protocol: "trojan" });
      const card = formatConfigCard(config);
      expect(card).toContain("📡 Protocol: Trojan");
    });

    it("should use location_display as fallback", () => {
      const config = makeConfig({
        location_country: null,
        location_flag: null,
        location_display: "US-California",
      });
      const card = formatConfigCard(config);
      expect(card).toContain("🌍 US-California");
    });
  });

  describe("formatConfigBatchCard()", () => {
    it("should return empty string for empty array", () => {
      expect(formatConfigBatchCard([])).toBe("");
    });

    it("should format single config as single card", () => {
      const config = makeConfig();
      const single = formatConfigCard(config);
      const batch = formatConfigBatchCard([config]);
      expect(batch).toBe(single);
    });

    it("should format multiple configs with header count", () => {
      const configs = [
        makeConfig({ id: 1, protocol: "vless" }),
        makeConfig({ id: 2, protocol: "vmess" }),
      ];
      const card = formatConfigBatchCard(configs);
      expect(card).toContain("🚀 Premium V2Ray Configs (2)");
      expect(card).toContain("VLESS");
      expect(card).toContain("VMess");
    });

    it("should include source channel in batch card", () => {
      const configs = [
        makeConfig({ id: 1 }),
        makeConfig({ id: 2, protocol: "vmess" }),
      ];
      const card = formatConfigBatchCard(configs, { sourceChannel: "@Test" });
      expect(card).toContain("📢 Source: @Test");
    });
  });

  describe("checkStaleness()", () => {
    it("should detect stale config", () => {
      const now = new Date("2025-01-10T00:00:00Z");
      const config = makeConfig({
        last_seen: "2025-01-01T00:00:00Z", // 9 days ago
      });
      const result = checkStaleness(config, now);
      expect(result.isStale).toBe(true);
      expect(result.hoursSinceLastSeen).toBe(216);
    });

    it("should detect fresh config", () => {
      const now = new Date("2025-01-02T06:00:00Z");
      const config = makeConfig({
        last_seen: "2025-01-02T00:00:00Z", // 6 hours ago
      });
      const result = checkStaleness(config, now);
      expect(result.isStale).toBe(false);
      expect(result.hoursSinceLastSeen).toBe(6);
    });

    it("should be stale exactly at threshold + 1", () => {
      const now = new Date("2025-01-04T01:00:00Z");
      const config = makeConfig({
        last_seen: "2025-01-01T00:00:00Z", // 73 hours ago
      });
      const result = checkStaleness(config, now);
      expect(result.isStale).toBe(true);
    });

    it("should not be stale at exact threshold", () => {
      const now = new Date("2025-01-04T00:00:00Z");
      const config = makeConfig({
        last_seen: "2025-01-01T00:00:00Z", // exactly 72 hours
      });
      const result = checkStaleness(config, now);
      expect(result.isStale).toBe(false);
    });
  });
});
