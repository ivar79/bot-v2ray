/**
 * Tests — Canonicalization & Parser Router
 *
 * Tests cross-protocol canonicalization, dedup behavior, parser routing,
 * and determinism across the entire parser pipeline.
 */

import { describe, it, expect } from "vitest";
import {
  parseRouter,
  parseWithHash,
  parseAllFromText,
  extractConfigs,
  getSupportedProtocols,
} from "../src/parsers";
import { encodeBase64 } from "../src/utils/base64";

// ─── Known test UUIDs ──────────────────────────────────────

const UUID_A = "a3482e88-686a-4a58-8126-99c9034e4b09";
const UUID_B = "b3482e88-686a-4a58-8126-99c9034e4b09";

// ─── Parser Router Tests ───────────────────────────────────

describe("Parser Router", () => {
  it("should route VMess configs correctly", () => {
    const vmessObj = {
      v: "2",
      ps: "Test",
      add: "server.com",
      port: 443,
      id: UUID_A,
      aid: "0",
      net: "tcp",
      type: "none",
      host: "",
      path: "",
      tls: "tls",
    };
    const uri = `vmess://${encodeBase64(JSON.stringify(vmessObj))}`;
    const result = parseRouter(uri);

    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("vmess");
    expect(result!.isValid).toBe(true);
  });

  it("should route VLESS configs correctly", () => {
    const uri = `vless://${UUID_A}@server.com:443?security=tls#Test`;
    const result = parseRouter(uri);

    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("vless");
    expect(result!.isValid).toBe(true);
  });

  it("should route Trojan configs correctly", () => {
    const uri = "trojan://pass@server.com:443#Test";
    const result = parseRouter(uri);

    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("trojan");
    expect(result!.isValid).toBe(true);
  });

  it("should route Shadowsocks configs correctly", () => {
    const b64 = encodeBase64("aes-256-gcm:password");
    const uri = `ss://${b64}@server.com:8388#Test`;
    const result = parseRouter(uri);

    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("ss");
    expect(result!.isValid).toBe(true);
  });

  it("should route Hysteria v1 correctly", () => {
    const uri = "hysteria://auth@server.com:8443#Test";
    const result = parseRouter(uri);

    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("hysteria");
    expect(result!.isValid).toBe(true);
  });

  it("should route Hysteria2 correctly (hysteria2://)", () => {
    const uri = "hysteria2://auth@server.com:443#Test";
    const result = parseRouter(uri);

    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("hysteria2");
    expect(result!.isValid).toBe(true);
  });

  it("should route Hysteria2 correctly (hy2://)", () => {
    const uri = "hy2://auth@server.com:443#Test";
    const result = parseRouter(uri);

    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("hysteria2");
    expect(result!.isValid).toBe(true);
  });

  it("should return null for unsupported schemes", () => {
    const result = parseRouter("wireguard://something");
    expect(result).toBeNull();
  });

  it("should return null for empty input", () => {
    expect(parseRouter("")).toBeNull();
    expect(parseRouter("   ")).toBeNull();
  });

  it("should return null for garbage input", () => {
    expect(parseRouter("not a config at all")).toBeNull();
    expect(parseRouter("random text with no scheme")).toBeNull();
  });

  it("should handle case-insensitive scheme detection", () => {
    const uri = `VLESS://${UUID_A}@server.com:443`;
    const result = parseRouter(uri);

    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("vless");
    expect(result!.isValid).toBe(true);
  });
});

// ─── Canonicalization Dedup Tests ──────────────────────────

describe("Canonicalization & Dedup", () => {
  it("VLESS: same URI with different fragment → same hash", async () => {
    const uri1 = `vless://${UUID_A}@server.com:443?security=tls#Config A`;
    const uri2 = `vless://${UUID_A}@server.com:443?security=tls#Config B`;

    const r1 = await parseWithHash(uri1);
    const r2 = await parseWithHash(uri2);

    expect(r1.configHash).toBe(r2.configHash);
  });

  it("VLESS: equivalent query ordering → same hash", async () => {
    const uri1 = `vless://${UUID_A}@server.com:443?security=tls&fp=chrome&sni=google.com`;
    const uri2 = `vless://${UUID_A}@server.com:443?sni=google.com&fp=chrome&security=tls`;

    const r1 = await parseWithHash(uri1);
    const r2 = await parseWithHash(uri2);

    expect(r1.configHash).toBe(r2.configHash);
  });

  it("VLESS: different UUID → different hash", async () => {
    const uri1 = `vless://${UUID_A}@server.com:443`;
    const uri2 = `vless://${UUID_B}@server.com:443`;

    const r1 = await parseWithHash(uri1);
    const r2 = await parseWithHash(uri2);

    expect(r1.configHash).not.toBe(r2.configHash);
  });

  it("VLESS: different server → different hash", async () => {
    const uri1 = `vless://${UUID_A}@server1.com:443`;
    const uri2 = `vless://${UUID_A}@server2.com:443`;

    const r1 = await parseWithHash(uri1);
    const r2 = await parseWithHash(uri2);

    expect(r1.configHash).not.toBe(r2.configHash);
  });

  it("VLESS: different port → different hash", async () => {
    const uri1 = `vless://${UUID_A}@server.com:443`;
    const uri2 = `vless://${UUID_A}@server.com:8443`;

    const r1 = await parseWithHash(uri1);
    const r2 = await parseWithHash(uri2);

    expect(r1.configHash).not.toBe(r2.configHash);
  });

  it("Trojan: same config different remark → same hash", async () => {
    const uri1 = "trojan://pass@server.com:443#Remark A";
    const uri2 = "trojan://pass@server.com:443#Remark B";

    const r1 = await parseWithHash(uri1);
    const r2 = await parseWithHash(uri2);

    expect(r1.configHash).toBe(r2.configHash);
  });

  it("VMess: different ps (remark) → same hash", async () => {
    const obj1 = {
      v: "2",
      ps: "First Name",
      add: "server.com",
      port: 443,
      id: UUID_A,
      aid: "0",
      net: "tcp",
      type: "none",
      host: "",
      path: "",
      tls: "tls",
    };
    const obj2 = { ...obj1, ps: "Completely Different Name" };

    const uri1 = `vmess://${encodeBase64(JSON.stringify(obj1))}`;
    const uri2 = `vmess://${encodeBase64(JSON.stringify(obj2))}`;

    const r1 = await parseWithHash(uri1);
    const r2 = await parseWithHash(uri2);

    expect(r1.configHash).toBe(r2.configHash);
  });

  it("VMess: connection-changing field → different hash", async () => {
    const obj1 = {
      v: "2",
      ps: "",
      add: "server.com",
      port: 443,
      id: UUID_A,
      aid: "0",
      net: "tcp",
      type: "none",
      host: "",
      path: "",
      tls: "tls",
    };
    const obj2 = { ...obj1, net: "ws", path: "/chat" };

    const uri1 = `vmess://${encodeBase64(JSON.stringify(obj1))}`;
    const uri2 = `vmess://${encodeBase64(JSON.stringify(obj2))}`;

    const r1 = await parseWithHash(uri1);
    const r2 = await parseWithHash(uri2);

    expect(r1.configHash).not.toBe(r2.configHash);
  });

  it("Hysteria2: hy2:// vs hysteria2:// equivalent → same hash", async () => {
    const uri1 = "hy2://auth@server.com:443?obfs=password&sni=google.com";
    const uri2 = "hysteria2://auth@server.com:443?obfs=password&sni=google.com";

    const r1 = await parseWithHash(uri1);
    const r2 = await parseWithHash(uri2);

    expect(r1.configHash).toBe(r2.configHash);
  });

  it("Shadowsocks: same config different case method → same hash", async () => {
    const b64a = encodeBase64("aes-256-gcm:password");
    const b64b = encodeBase64("AES-256-GCM:password");

    const r1 = await parseWithHash(`ss://${b64a}@server.com:443`);
    const r2 = await parseWithHash(`ss://${b64b}@server.com:443`);

    expect(r1.configHash).toBe(r2.configHash);
  });
});

// ─── Determinism Tests ─────────────────────────────────────

describe("Determinism", () => {
  const testCases = [
    { name: "VLESS", uri: `vless://${UUID_A}@server.com:443?security=tls#Test` },
    { name: "Trojan", uri: "trojan://pass@server.com:443?security=tls#Test" },
    { name: "Shadowsocks", uri: `ss://${encodeBase64("aes-256-gcm:pass")}@server.com:443` },
    { name: "Hysteria", uri: "hysteria://auth@server.com:8443?obfs=local#Test" },
    { name: "Hysteria2 (hy2)", uri: "hy2://auth@server.com:443?obfs=password#Test" },
    { name: "Hysteria2 (hysteria2)", uri: "hysteria2://auth@server.com:443?obfs=password#Test" },
  ];

  for (const tc of testCases) {
    it(`${tc.name}: same input produces identical output across multiple runs`, async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => parseWithHash(tc.uri))
      );

      for (const result of results) {
        expect(result.protocol).toBe(results[0].protocol);
        expect(result.canonical).toBe(results[0].canonical);
        expect(result.configHash).toBe(results[0].configHash);
        expect(result.isValid).toBe(results[0].isValid);
      }
    });
  }
});

// ─── parseAllFromText Tests ────────────────────────────────

describe("parseAllFromText", () => {
  it("should parse multiple configs from mixed text", async () => {
    const text = `
Check these configs:
vless://${UUID_A}@server1.com:443?security=tls#Config1
trojan://pass@server2.com:443#Config2
hy2://auth@server3.com:443#Config3
    `;

    const results = await parseAllFromText(text);
    expect(results.length).toBe(3);
    expect(results.every((r) => r.isValid)).toBe(true);
  });

  it("should include invalid configs in results", async () => {
    const text = `
vless://${UUID_A}@server.com:443
vmess://invalidbase64!!!
vless://${UUID_B}@server2.com:443
    `;

    const results = await parseAllFromText(text);
    expect(results.length).toBe(3);
    expect(results[0].isValid).toBe(true);
    expect(results[1].isValid).toBe(false);
    expect(results[2].isValid).toBe(true);
  });

  it("should return empty for text with no configs", async () => {
    const results = await parseAllFromText("Just plain text here.");
    expect(results.length).toBe(0);
  });
});

// ─── Protocol List ─────────────────────────────────────────

describe("getSupportedProtocols", () => {
  it("should return all supported protocols", () => {
    const protocols = getSupportedProtocols();
    expect(protocols).toContain("vmess");
    expect(protocols).toContain("vless");
    expect(protocols).toContain("trojan");
    expect(protocols).toContain("ss");
    expect(protocols).toContain("hysteria");
    expect(protocols).toContain("hysteria2");
    expect(protocols.length).toBe(6);
  });
});
