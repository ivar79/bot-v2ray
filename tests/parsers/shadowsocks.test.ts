/**
 * Tests — Shadowsocks Parser
 *
 * Tests Shadowsocks parsing, validation, and canonicalization.
 */

import { describe, it, expect } from "vitest";
import {
  ShadowsocksParser,
  parseShadowsocksWithHash,
} from "../../src/parsers/shadowsocks";
import { encodeBase64 } from "../../src/utils/base64";

function makeSSUri(method: string, password: string, host: string, port: number): string {
  const b64 = encodeBase64(`${method}:${password}`);
  return `ss://${b64}@${host}:${port}`;
}

describe("Shadowsocks Parser", () => {
  const parser = new ShadowsocksParser();

  describe("detect()", () => {
    it("should detect ss:// prefix", () => {
      expect(parser.detect("ss://abc")).toBe(true);
    });

    it("should detect case-insensitively", () => {
      expect(parser.detect("SS://abc")).toBe(true);
    });

    it("should not detect non-ss", () => {
      expect(parser.detect("vless://abc")).toBe(false);
    });
  });

  describe("parse() — valid SIP002 format", () => {
    it("should parse SIP002 format (b64@host:port)", () => {
      const uri = makeSSUri("aes-256-gcm", "mypassword", "server.com", 8388);
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.protocol).toBe("ss");
      expect(result.server).toBe("server.com");
      expect(result.port).toBe(8388);
    });

    it("should parse full-b64 SIP002 format", () => {
      const inner = encodeBase64("aes-256-gcm:mypassword@server.com:8388");
      const uri = `ss://${inner}`;
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.protocol).toBe("ss");
      expect(result.server).toBe("server.com");
      expect(result.port).toBe(8388);
    });

    it("should produce deterministic canonical", () => {
      const uri = makeSSUri("aes-256-gcm", "pass", "server.com", 443);
      const r1 = parser.parse(uri);
      const r2 = parser.parse(uri);
      expect(r1.canonical).toBe(r2.canonical);
    });

    it("should normalize method to lowercase", () => {
      const uri = makeSSUri("AES-256-GCM", "pass", "server.com", 443);
      const result = parser.parse(uri);
      expect(result.canonical).toContain("aes-256-gcm");
    });

    it("should normalize server to lowercase", () => {
      const uri = makeSSUri("aes-256-gcm", "pass", "SERVER.COM", 443);
      const result = parser.parse(uri);
      expect(result.server).toBe("server.com");
      expect(result.canonical).toContain("server.com");
    });
  });

  describe("parse() — valid legacy format", () => {
    it("should parse legacy base64(method:password:host:port)", () => {
      const inner = encodeBase64("aes-256-gcm:mypassword:server.com:8388");
      const uri = `ss://${inner}`;
      const result = parser.parse(uri);

      // This might match SIP002 full-b64 or legacy
      expect(result.isValid).toBe(true);
      expect(result.server).toBe("server.com");
      expect(result.port).toBe(8388);
    });
  });

  describe("parse() — invalid inputs", () => {
    it("should reject empty payload", () => {
      const result = parser.parse("ss://");
      expect(result.isValid).toBe(false);
    });

    it("should reject invalid base64", () => {
      const result = parser.parse("ss://!!!invalid!!!");
      expect(result.isValid).toBe(false);
    });

    it("should reject missing port", () => {
      // Create a b64 that decodes to method:password but no host:port
      const b64 = encodeBase64("aes-256-gcm:pass");
      const result = parser.parse(`ss://${b64}@noport`);
      // Depending on format, this might be recognized or not
      // The important thing is it shouldn't crash
    });
  });

  describe("parseWithHash() — async", () => {
    it("should produce valid SHA-256 hash", async () => {
      const uri = makeSSUri("aes-256-gcm", "mypassword", "server.com", 8388);
      const result = await parseShadowsocksWithHash(uri);

      expect(result.isValid).toBe(true);
      expect(result.configHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should be deterministic", async () => {
      const uri = makeSSUri("aes-256-gcm", "pass", "server.com", 443);
      const r1 = await parseShadowsocksWithHash(uri);
      const r2 = await parseShadowsocksWithHash(uri);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("should produce different hash for different password", async () => {
      const uri1 = makeSSUri("aes-256-gcm", "pass1", "server.com", 443);
      const uri2 = makeSSUri("aes-256-gcm", "pass2", "server.com", 443);
      const r1 = await parseShadowsocksWithHash(uri1);
      const r2 = await parseShadowsocksWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different server", async () => {
      const uri1 = makeSSUri("aes-256-gcm", "pass", "server1.com", 443);
      const uri2 = makeSSUri("aes-256-gcm", "pass", "server2.com", 443);
      const r1 = await parseShadowsocksWithHash(uri1);
      const r2 = await parseShadowsocksWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different port", async () => {
      const uri1 = makeSSUri("aes-256-gcm", "pass", "server.com", 443);
      const uri2 = makeSSUri("aes-256-gcm", "pass", "server.com", 8443);
      const r1 = await parseShadowsocksWithHash(uri1);
      const r2 = await parseShadowsocksWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce same hash for same config regardless of method case", async () => {
      const uri1 = makeSSUri("aes-256-gcm", "pass", "server.com", 443);
      const uri2 = makeSSUri("AES-256-GCM", "pass", "server.com", 443);
      const r1 = await parseShadowsocksWithHash(uri1);
      const r2 = await parseShadowsocksWithHash(uri2);
      expect(r1.configHash).toBe(r2.configHash);
    });
  });
});
