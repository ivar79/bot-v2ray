/**
 * Tests — Trojan Parser
 *
 * Tests Trojan parsing, validation, and canonicalization.
 */

import { describe, it, expect } from "vitest";
import { TrojanParser, parseTrojanWithHash } from "../../src/parsers/trojan";

describe("Trojan Parser", () => {
  const parser = new TrojanParser();

  describe("detect()", () => {
    it("should detect trojan:// prefix", () => {
      expect(parser.detect("trojan://abc")).toBe(true);
    });

    it("should detect case-insensitively", () => {
      expect(parser.detect("TROJAN://abc")).toBe(true);
    });

    it("should not detect non-trojan", () => {
      expect(parser.detect("vless://abc")).toBe(false);
      expect(parser.detect("vmess://abc")).toBe(false);
    });
  });

  describe("parse() — valid inputs", () => {
    it("should parse a basic Trojan config", () => {
      const uri = "trojan://mypassword@server.com:443?security=tls#Test";
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.protocol).toBe("trojan");
      expect(result.server).toBe("server.com");
      expect(result.port).toBe(443);
    });

    it("should parse Trojan with ws transport", () => {
      const uri = "trojan://pass@server.com:443?type=ws&path=/chat&host=cdn.com#WS";
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.canonical).toContain("type=ws");
    });

    it("should remove fragment from canonical", () => {
      const uri = "trojan://pass@server.com:443#MyConfig";
      const result = parser.parse(uri);

      expect(result.canonical).not.toContain("MyConfig");
      expect(result.canonical).not.toContain("#");
    });

    it("should sort query parameters deterministically", () => {
      const uri1 = "trojan://pass@server.com:443?security=tls&fp=chrome&sni=google.com";
      const uri2 = "trojan://pass@server.com:443?fp=chrome&sni=google.com&security=tls";
      const r1 = parser.parse(uri1);
      const r2 = parser.parse(uri2);

      expect(r1.canonical).toBe(r2.canonical);
    });

    it("should normalize server to lowercase", () => {
      const uri = "trojan://pass@SERVER.COM:443";
      const result = parser.parse(uri);
      expect(result.server).toBe("server.com");
    });

    it("should handle IPv6 hosts", () => {
      const uri = "trojan://pass@[2001:db8::1]:443?security=tls";
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.server).toBe("2001:db8::1");
      expect(result.port).toBe(443);
    });

    it("should preserve connection-affecting params", () => {
      const uri = "trojan://pass@server.com:443?security=tls&sni=google.com&fp=chrome&alpn=h2";
      const result = parser.parse(uri);

      expect(result.canonical).toContain("security=tls");
      expect(result.canonical).toContain("sni=google.com");
      expect(result.canonical).toContain("fp=chrome");
      expect(result.canonical).toContain("alpn=h2");
    });

    it("should handle empty query string", () => {
      const uri = "trojan://pass@server.com:443";
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe("trojan://pass@server.com:443");
    });
  });

  describe("parse() — invalid inputs", () => {
    it("should reject empty payload", () => {
      const result = parser.parse("trojan://");
      expect(result.isValid).toBe(false);
    });

    it("should reject missing @ separator", () => {
      const result = parser.parse("trojan://password-only");
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("@");
    });

    it("should reject empty password", () => {
      const result = parser.parse("trojan://@server.com:443");
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("password");
    });

    it("should reject missing port", () => {
      const result = parser.parse("trojan://pass@server.com");
      expect(result.isValid).toBe(false);
    });

    it("should reject invalid port", () => {
      const result = parser.parse("trojan://pass@server.com:99999");
      expect(result.isValid).toBe(false);
    });
  });

  describe("parseWithHash() — async", () => {
    it("should produce valid SHA-256 hash", async () => {
      const uri = "trojan://mypassword@server.com:443?security=tls#Test";
      const result = await parseTrojanWithHash(uri);

      expect(result.isValid).toBe(true);
      expect(result.configHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should be deterministic", async () => {
      const uri = "trojan://pass@server.com:443?security=tls";
      const r1 = await parseTrojanWithHash(uri);
      const r2 = await parseTrojanWithHash(uri);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("should produce same hash regardless of remark", async () => {
      const uri1 = "trojan://pass@server.com:443#ConfigA";
      const uri2 = "trojan://pass@server.com:443#ConfigB";
      const r1 = await parseTrojanWithHash(uri1);
      const r2 = await parseTrojanWithHash(uri2);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("should produce different hash for different password", async () => {
      const uri1 = "trojan://pass1@server.com:443";
      const uri2 = "trojan://pass2@server.com:443";
      const r1 = await parseTrojanWithHash(uri1);
      const r2 = await parseTrojanWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different server", async () => {
      const uri1 = "trojan://pass@server1.com:443";
      const uri2 = "trojan://pass@server2.com:443";
      const r1 = await parseTrojanWithHash(uri1);
      const r2 = await parseTrojanWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different port", async () => {
      const uri1 = "trojan://pass@server.com:443";
      const uri2 = "trojan://pass@server.com:8443";
      const r1 = await parseTrojanWithHash(uri1);
      const r2 = await parseTrojanWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });
  });
});
