/**
 * Tests — Hysteria v1 Parser
 *
 * Tests Hysteria v1 parsing, validation, and canonicalization.
 */

import { describe, it, expect } from "vitest";
import {
  HysteriaParser,
  parseHysteriaWithHash,
} from "../../src/parsers/hysteria";

describe("Hysteria Parser", () => {
  const parser = new HysteriaParser();

  describe("detect()", () => {
    it("should detect hysteria:// prefix", () => {
      expect(parser.detect("hysteria://abc")).toBe(true);
    });

    it("should detect case-insensitively", () => {
      expect(parser.detect("HYSTERIA://abc")).toBe(true);
    });

    it("should not detect hysteria2://", () => {
      expect(parser.detect("hysteria2://abc")).toBe(false);
    });

    it("should not detect hy2://", () => {
      expect(parser.detect("hy2://abc")).toBe(false);
    });

    it("should not detect non-hysteria", () => {
      expect(parser.detect("vless://abc")).toBe(false);
    });
  });

  describe("parse() — valid inputs", () => {
    it("should parse a basic Hysteria config", () => {
      const uri = "hysteria://myauth@server.com:8443?obfs=obfs-local#Test";
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.protocol).toBe("hysteria");
      expect(result.server).toBe("server.com");
      expect(result.port).toBe(8443);
    });

    it("should parse Hysteria without auth", () => {
      const uri = "hysteria://server.com:8443";
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.server).toBe("server.com");
      expect(result.port).toBe(8443);
    });

    it("should remove fragment from canonical", () => {
      const uri = "hysteria://auth@server.com:8443#MyConfig";
      const result = parser.parse(uri);

      expect(result.canonical).not.toContain("MyConfig");
      expect(result.canonical).not.toContain("#");
    });

    it("should sort query parameters", () => {
      const uri1 = "hysteria://auth@server.com:8443?obfs=local&sni=google.com";
      const uri2 = "hysteria://auth@server.com:8443?sni=google.com&obfs=local";
      const r1 = parser.parse(uri1);
      const r2 = parser.parse(uri2);

      expect(r1.canonical).toBe(r2.canonical);
    });

    it("should normalize server to lowercase", () => {
      const uri = "hysteria://auth@SERVER.COM:8443";
      const result = parser.parse(uri);
      expect(result.server).toBe("server.com");
    });

    it("should preserve bandwidth params", () => {
      const uri = "hysteria://auth@server.com:8443?upmbps=100&downmbps=200";
      const result = parser.parse(uri);

      expect(result.canonical).toContain("upmbps=100");
      expect(result.canonical).toContain("downmbps=200");
    });
  });

  describe("parse() — invalid inputs", () => {
    it("should reject empty payload", () => {
      const result = parser.parse("hysteria://");
      expect(result.isValid).toBe(false);
    });

    it("should reject missing port", () => {
      const result = parser.parse("hysteria://auth@server.com");
      expect(result.isValid).toBe(false);
    });

    it("should reject invalid port", () => {
      const result = parser.parse("hysteria://auth@server.com:99999");
      expect(result.isValid).toBe(false);
    });
  });

  describe("parseWithHash() — async", () => {
    it("should produce valid SHA-256 hash", async () => {
      const uri = "hysteria://auth@server.com:8443?obfs=local#Test";
      const result = await parseHysteriaWithHash(uri);

      expect(result.isValid).toBe(true);
      expect(result.configHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should be deterministic", async () => {
      const uri = "hysteria://auth@server.com:8443?obfs=local";
      const r1 = await parseHysteriaWithHash(uri);
      const r2 = await parseHysteriaWithHash(uri);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("should produce same hash regardless of remark", async () => {
      const uri1 = "hysteria://auth@server.com:8443#ConfigA";
      const uri2 = "hysteria://auth@server.com:8443#ConfigB";
      const r1 = await parseHysteriaWithHash(uri1);
      const r2 = await parseHysteriaWithHash(uri2);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("should produce different hash for different auth", async () => {
      const uri1 = "hysteria://auth1@server.com:8443";
      const uri2 = "hysteria://auth2@server.com:8443";
      const r1 = await parseHysteriaWithHash(uri1);
      const r2 = await parseHysteriaWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different server", async () => {
      const uri1 = "hysteria://auth@server1.com:8443";
      const uri2 = "hysteria://auth@server2.com:8443";
      const r1 = await parseHysteriaWithHash(uri1);
      const r2 = await parseHysteriaWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });
  });
});
