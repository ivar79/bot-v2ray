/**
 * Tests — Hysteria2 Parser
 *
 * Tests Hysteria2 parsing, validation, and canonicalization.
 * Critically: verifies that hy2:// and hysteria2:// produce the same hash
 * when connection parameters are equivalent.
 */

import { describe, it, expect } from "vitest";
import {
  Hysteria2Parser,
  parseHysteria2WithHash,
} from "../../src/parsers/hysteria2";

describe("Hysteria2 Parser", () => {
  const parser = new Hysteria2Parser();

  describe("detect()", () => {
    it("should detect hysteria2:// prefix", () => {
      expect(parser.detect("hysteria2://abc")).toBe(true);
    });

    it("should detect hy2:// prefix", () => {
      expect(parser.detect("hy2://abc")).toBe(true);
    });

    it("should detect case-insensitively", () => {
      expect(parser.detect("HYSTERIA2://abc")).toBe(true);
      expect(parser.detect("HY2://abc")).toBe(true);
    });

    it("should not detect plain hysteria://", () => {
      expect(parser.detect("hysteria://abc")).toBe(false);
    });

    it("should not detect non-hysteria2", () => {
      expect(parser.detect("vless://abc")).toBe(false);
    });
  });

  describe("parse() — valid inputs", () => {
    it("should parse hysteria2:// format", () => {
      const uri = "hysteria2://myauth@server.com:443?obfs=password#Test";
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.protocol).toBe("hysteria2");
      expect(result.server).toBe("server.com");
      expect(result.port).toBe(443);
    });

    it("should parse hy2:// format", () => {
      const uri = "hy2://myauth@server.com:443#Test";
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.protocol).toBe("hysteria2");
      expect(result.server).toBe("server.com");
      expect(result.port).toBe(443);
    });

    it("should normalize both schemes to same protocol name", () => {
      const r1 = parser.parse("hysteria2://auth@server.com:443");
      const r2 = parser.parse("hy2://auth@server.com:443");
      expect(r1.protocol).toBe("hysteria2");
      expect(r2.protocol).toBe("hysteria2");
    });

    it("should parse auth from query param when no userinfo", () => {
      const uri = "hy2://server.com:443?auth=mytoken";
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.canonical).toContain("mytoken");
    });

    it("should remove fragment from canonical", () => {
      const uri = "hy2://auth@server.com:443#MyConfig";
      const result = parser.parse(uri);

      expect(result.canonical).not.toContain("MyConfig");
      expect(result.canonical).not.toContain("#");
    });

    it("should sort query parameters", () => {
      const uri1 = "hy2://auth@server.com:443?obfs=password&sni=google.com";
      const uri2 = "hy2://auth@server.com:443?sni=google.com&obfs=password";
      const r1 = parser.parse(uri1);
      const r2 = parser.parse(uri2);

      expect(r1.canonical).toBe(r2.canonical);
    });

    it("should normalize server to lowercase", () => {
      const uri = "hy2://auth@SERVER.COM:443";
      const result = parser.parse(uri);
      expect(result.server).toBe("server.com");
    });

    it("should handle empty query string", () => {
      const uri = "hy2://auth@server.com:443";
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe("hysteria2://auth@server.com:443");
    });

    it("should preserve obfs params", () => {
      const uri = "hy2://auth@server.com:443?obfs=password&obfs-password=secret";
      const result = parser.parse(uri);

      expect(result.canonical).toContain("obfs=password");
      expect(result.canonical).toContain("obfs-password=secret");
    });
  });

  describe("parse() — invalid inputs", () => {
    it("should reject empty payload", () => {
      const result = parser.parse("hy2://");
      expect(result.isValid).toBe(false);
    });

    it("should reject missing port", () => {
      const result = parser.parse("hy2://auth@server.com");
      expect(result.isValid).toBe(false);
    });

    it("should reject invalid port", () => {
      const result = parser.parse("hy2://auth@server.com:99999");
      expect(result.isValid).toBe(false);
    });
  });

  describe("parseWithHash() — async", () => {
    it("should produce valid SHA-256 hash", async () => {
      const uri = "hy2://auth@server.com:443?obfs=password#Test";
      const result = await parseHysteria2WithHash(uri);

      expect(result.isValid).toBe(true);
      expect(result.configHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should be deterministic", async () => {
      const uri = "hy2://auth@server.com:443?obfs=password";
      const r1 = await parseHysteria2WithHash(uri);
      const r2 = await parseHysteria2WithHash(uri);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("should produce same hash regardless of remark", async () => {
      const uri1 = "hy2://auth@server.com:443#ConfigA";
      const uri2 = "hy2://auth@server.com:443#ConfigB";
      const r1 = await parseHysteria2WithHash(uri1);
      const r2 = await parseHysteria2WithHash(uri2);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("CRITICAL: hy2:// and hysteria2:// produce same hash for equivalent params", async () => {
      const uri1 = "hy2://auth@server.com:443?obfs=password&sni=google.com";
      const uri2 = "hysteria2://auth@server.com:443?obfs=password&sni=google.com";
      const r1 = await parseHysteria2WithHash(uri1);
      const r2 = await parseHysteria2WithHash(uri2);

      expect(r1.isValid).toBe(true);
      expect(r2.isValid).toBe(true);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("should produce different hash for different auth", async () => {
      const uri1 = "hy2://auth1@server.com:443";
      const uri2 = "hy2://auth2@server.com:443";
      const r1 = await parseHysteria2WithHash(uri1);
      const r2 = await parseHysteria2WithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different server", async () => {
      const uri1 = "hy2://auth@server1.com:443";
      const uri2 = "hy2://auth@server2.com:443";
      const r1 = await parseHysteria2WithHash(uri1);
      const r2 = await parseHysteria2WithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different port", async () => {
      const uri1 = "hy2://auth@server.com:443";
      const uri2 = "hy2://auth@server.com:8443";
      const r1 = await parseHysteria2WithHash(uri1);
      const r2 = await parseHysteria2WithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different obfs", async () => {
      const uri1 = "hy2://auth@server.com:443?obfs=password";
      const uri2 = "hy2://auth@server.com:443?obfs=none";
      const r1 = await parseHysteria2WithHash(uri1);
      const r2 = await parseHysteria2WithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });
  });
});
