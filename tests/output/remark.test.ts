/**
 * Tests — Output Engine: Config Remark Rewriter
 *
 * Covers template expansion, per-protocol URI rewriting (fragment vs
 * vmess base64-JSON), and integration with the output generator.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import {
  buildRemark,
  applyRemarkToUri,
  applyRemarkToConfigs,
  DEFAULT_REMARK_TEMPLATE,
} from "../../src/output/remark";
import { generateAllTxt } from "../../src/output/generator";
import { insertConfig } from "../../src/db/configs";
import { setSetting } from "../../src/db/settings";
import { encodeBase64 } from "../../src/utils/base64";
import type { ConfigRow } from "../../src/db/connection";

// ─── Fixtures ────────────────────────────────────────────

function makeConfig(overrides: Partial<ConfigRow> = {}): ConfigRow {
  return {
    id: 1,
    protocol: "vless",
    raw: "vless://uuid@server.com:443?security=tls#Original",
    canonical: "vless://uuid@server.com:443/#Original",
    config_hash: "hash1",
    normalized_uri: null,
    structured_data: null,
    is_valid: 1,
    active: 1,
    parser_version: "1.0",
    first_seen: "2026-01-01 00:00:00",
    last_seen: "2026-01-01 00:00:00",
    location_country: null,
    location_country_code: null,
    location_flag: null,
    location_display: null,
    ...overrides,
  };
}

// ─── buildRemark() ───────────────────────────────────────

describe("buildRemark()", () => {
  it("expands all template placeholders", () => {
    const cfg = makeConfig({
      location_flag: "🇩🇪",
      location_country: "Germany",
      location_display: "🇩🇪 Germany",
      protocol: "vmess",
    });
    const out = buildRemark("{flag} {country} | {location} | {protocol}", cfg);
    expect(out).toBe("🇩🇪 Germany | 🇩🇪 Germany | VMESS");
  });

  it("falls back to the default template when empty", () => {
    const cfg = makeConfig();
    expect(buildRemark("", cfg)).toBe(DEFAULT_REMARK_TEMPLATE);
    expect(buildRemark("   ", cfg)).toBe(DEFAULT_REMARK_TEMPLATE);
    expect(buildRemark(null, cfg)).toBe(DEFAULT_REMARK_TEMPLATE);
  });

  it("uses fallback location when location is unknown", () => {
    const cfg = makeConfig({ location_flag: null, location_country: null, location_display: null });
    const out = buildRemark("{location}", cfg);
    expect(out).toBe("🌍 Unknown");
  });
})

// ─── applyRemarkToUri() ──────────────────────────────────

describe("applyRemarkToUri()", () => {
  it("rewrites the fragment for vless/trojan URIs", () => {
    const out = applyRemarkToUri("vless://uuid@x.com:443?security=tls#Old", "MyChannel");
    expect(out).toBe("vless://uuid@x.com:443?security=tls#MyChannel");
  });

  it("rewrites the ps field inside vmess base64 JSON", () => {
    const obj = { v: "2", ps: "Old Name", add: "x.com", port: 443, id: "uuid", aid: "0", net: "tcp", type: "none", host: "", path: "", tls: "tls" };
    const uri = "vmess://" + encodeBase64(JSON.stringify(obj));
    const out = applyRemarkToUri(uri, "New Name");
    const decoded = JSON.parse(atob(out.slice(8))) as { ps: string };
    expect(decoded.ps).toBe("New Name");
  });

  it("leaves URIs without a scheme untouched", () => {
    expect(applyRemarkToUri("not a config", "X")).toBe("not a config");
  });

  it("percent-encodes the remark for URI safety", () => {
    const out = applyRemarkToUri("trojan://p@x.com:443#old", "کانال ما");
    expect(out).toMatch(/^trojan:\/\/p@x\.com:443#/);
    expect(out).not.toContain("کانال");
    expect(out).toContain("%DA%A9");
  });
})

// ─── applyRemarkToConfigs() ──────────────────────────────

describe("applyRemarkToConfigs()", () => {
  it("rewrites every config in the array", () => {
    const configs = [
      makeConfig({ raw: "vless://a@x.com:443#A", config_hash: "a" }),
      makeConfig({ raw: "trojan://b@x.com:443#B", config_hash: "b" }),
    ];
    const out = applyRemarkToConfigs(configs, "My Channel");
    expect(out[0]).toBe("vless://a@x.com:443#My%20Channel");
    expect(out[1]).toBe("trojan://b@x.com:443#My%20Channel");
  });
})

// ─── Generator Integration ───────────────────────────────

describe("Generator remark integration", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  it("applies the remark template to generated files when configured", async () => {
    await setSetting(db, "remark_template", "📡 {protocol} | {location}");
    await insertConfig(db, {
      protocol: "vless",
      raw: "vless://uuid@x.com:443?security=tls#Old",
      canonical: "vless://uuid@x.com:443/#Old",
      config_hash: "h1",
    });

    const content = await generateAllTxt(db);
    expect(content).toContain("VLESS");
    expect(content).not.toContain("#Old");
  });

  it("keeps raw URIs when no remark template is configured", async () => {
    await insertConfig(db, {
      protocol: "vless",
      raw: "vless://uuid@x.com:443?security=tls#Old",
      canonical: "vless://uuid@x.com:443/#Old",
      config_hash: "h2",
    });

    const content = await generateAllTxt(db);
    expect(content).toContain("vless://uuid@x.com:443?security=tls#Old");
  });
})
