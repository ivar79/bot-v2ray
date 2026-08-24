/**
 * Tests — VLESS Parser
 *
 * Tests VLESS parsing, validation, and canonicalization.
 */

import { describe, it, expect } from "vitest";
import { VLESSParser, parseVLESSWithHash } from "../../src/parsers/vless";

const SAMPLE_UUID = "a3482e88-686a-4a58-8126-99c9034e4b09";

describe("VLESS Parser", () => {
  const parser = new VLESSParser();

  describe("detect()", () => {
    it("should detect vless:// prefix", () => {
      expect(parser.detect("vless://abc")).toBe(true);
    });

    it("should detect case-insensitively", () => {
      expect(parser.detect("VLESS://abc")).toBe(true);
    });

    it("should not detect non-vless", () => {
      expect(parser.detect("vmess://abc")).toBe(false);
      expect(parser.detect("trojan://abc")).toBe(false);
    });
  });

  describe("parse() — valid inputs", () => {
    it("should parse a basic VLESS config", () => {
      const uri = `vless://${SAMPLE_UUID}@server.com:443?security=tls#Test`;
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.protocol).toBe("vless");
      expect(result.server).toBe("server.com");
      expect(result.port).toBe(443);
    });

    it("should parse VLESS with reality", () => {
      const uri = `vless://${SAMPLE_UUID}@reality.com:443?security=reality&sni=google.com&fp=chrome&pbk=abc&sid=def#Reality`;
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.server).toBe("reality.com");
      expect(result.port).toBe(443);
    });

    it("should remove fragment (remark) from canonical", () => {
      const uri = `vless://${SAMPLE_UUID}@server.com:443#MyConfig`;
      const result = parser.parse(uri);

      expect(result.canonical).not.toContain("MyConfig");
      expect(result.canonical).not.toContain("#");
    });

    it("should sort query parameters deterministically", () => {
      const uri1 = `vless://${SAMPLE_UUID}@server.com:443?security=tls&fp=chrome&sni=google.com`;
      const uri2 = `vless://${SAMPLE_UUID}@server.com:443?fp=chrome&sni=google.com&security=tls`;
      const r1 = parser.parse(uri1);
      const r2 = parser.parse(uri2);

      expect(r1.canonical).toBe(r2.canonical);
    });

    it("should normalize server to lowercase", () => {
      const uri = `vless://${SAMPLE_UUID}@SERVER.COM:443`;
      const result = parser.parse(uri);
      expect(result.server).toBe("server.com");
      expect(result.canonical).toContain("server.com");
    });

    it("should normalize UUID to lowercase in canonical", () => {
      const uri = `vless://${SAMPLE_UUID.toUpperCase()}@server.com:443`;
      const result = parser.parse(uri);
      expect(result.canonical).toContain(SAMPLE_UUID.toLowerCase());
    });

    it("should handle IPv6 hosts", () => {
      const uri = `vless://${SAMPLE_UUID}@[2001:db8::1]:443?security=tls`;
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.server).toBe("2001:db8::1");
      expect(result.port).toBe(443);
    });

    it("should preserve connection-affecting query params", () => {
      const uri = `vless://${SAMPLE_UUID}@server.com:443?security=reality&fp=chrome&pbk=abc&sid=def&sni=google.com`;
      const result = parser.parse(uri);

      expect(result.canonical).toContain("security=reality");
      expect(result.canonical).toContain("fp=chrome");
      expect(result.canonical).toContain("pbk=abc");
      expect(result.canonical).toContain("sid=def");
      expect(result.canonical).toContain("sni=google.com");
    });

    it("should handle path-based transports", () => {
      const uri = `vless://${SAMPLE_UUID}@server.com:443?type=ws&path=/chat&host=cdn.com#WS`;
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.canonical).toContain("type=ws");
      expect(result.canonical).toContain("path=/chat");
    });

    it("should handle empty query string", () => {
      const uri = `vless://${SAMPLE_UUID}@server.com:443`;
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe(
        `vless://${SAMPLE_UUID.toLowerCase()}@server.com:443`
      );
    });
  });

  describe("parse() — invalid inputs", () => {
    it("should reject empty payload", () => {
      const result = parser.parse("vless://");
      expect(result.isValid).toBe(false);
    });

    it("should reject missing @ separator", () => {
      const result = parser.parse("vless://uuid-only-no-at-sign");
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("@");
    });

    it("should reject empty UUID", () => {
      const result = parser.parse("vless://@server.com:443");
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("UUID");
    });

    it("should reject missing port", () => {
      const result = parser.parse(`vless://${SAMPLE_UUID}@server.com`);
      expect(result.isValid).toBe(false);
    });

    it("should reject invalid port", () => {
      const result = parser.parse(`vless://${SAMPLE_UUID}@server.com:99999`);
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("Invalid port");
    });

    it("should reject unclosed IPv6 bracket", () => {
      const result = parser.parse(`vless://${SAMPLE_UUID}@[2001:db8::1:443`);
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("IPv6");
    });
  });

  describe("parseWithHash() — async", () => {
    it("should produce valid SHA-256 hash", async () => {
      const uri = `vless://${SAMPLE_UUID}@server.com:443?security=tls#Test`;
      const result = await parseVLESSWithHash(uri);

      expect(result.isValid).toBe(true);
      expect(result.configHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should be deterministic", async () => {
      const uri = `vless://${SAMPLE_UUID}@server.com:443?security=tls`;
      const r1 = await parseVLESSWithHash(uri);
      const r2 = await parseVLESSWithHash(uri);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("should produce same hash regardless of remark", async () => {
      const uri1 = `vless://${SAMPLE_UUID}@server.com:443#ConfigA`;
      const uri2 = `vless://${SAMPLE_UUID}@server.com:443#ConfigB`;
      const r1 = await parseVLESSWithHash(uri1);
      const r2 = await parseVLESSWithHash(uri2);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("should produce different hash for different UUID", async () => {
      const uuid2 = "b3482e88-686a-4a58-8126-99c9034e4b09";
      const uri1 = `vless://${SAMPLE_UUID}@server.com:443`;
      const uri2 = `vless://${uuid2}@server.com:443`;
      const r1 = await parseVLESSWithHash(uri1);
      const r2 = await parseVLESSWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different server", async () => {
      const uri1 = `vless://${SAMPLE_UUID}@server1.com:443`;
      const uri2 = `vless://${SAMPLE_UUID}@server2.com:443`;
      const r1 = await parseVLESSWithHash(uri1);
      const r2 = await parseVLESSWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different port", async () => {
      const uri1 = `vless://${SAMPLE_UUID}@server.com:443`;
      const uri2 = `vless://${SAMPLE_UUID}@server.com:8443`;
      const r1 = await parseVLESSWithHash(uri1);
      const r2 = await parseVLESSWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce same hash for equivalent query param orderings", async () => {
      const uri1 = `vless://${SAMPLE_UUID}@server.com:443?security=tls&fp=chrome&sni=google.com`;
      const uri2 = `vless://${SAMPLE_UUID}@server.com:443?sni=google.com&fp=chrome&security=tls`;
      const r1 = await parseVLESSWithHash(uri1);
      const r2 = await parseVLESSWithHash(uri2);
      expect(r1.configHash).toBe(r2.configHash);
    });
  });
});
