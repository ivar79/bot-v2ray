/**
 * Tests — VMess Parser
 *
 * Tests VMess parsing, validation, and canonicalization.
 */

import { describe, it, expect } from "vitest";
import { VMessParser, parseVMessWithHash } from "../../src/parsers/vmess";
import { encodeBase64 } from "../../src/utils/base64";

function makeVMessJson(obj: Record<string, unknown>): string {
  return encodeBase64(JSON.stringify(obj));
}

function makeVMessUri(obj: Record<string, unknown>): string {
  return `vmess://${makeVMessJson(obj)}`;
}

const VALID_VMESS = {
  v: "2",
  ps: "Test Config",
  add: "server.example.com",
  port: 443,
  id: "a3482e88-686a-4a58-8126-99c9034e4b09",
  aid: "0",
  net: "tcp",
  type: "none",
  host: "",
  path: "",
  tls: "tls",
};

describe("VMess Parser", () => {
  const parser = new VMessParser();

  describe("detect()", () => {
    it("should detect vmess:// prefix", () => {
      expect(parser.detect("vmess://abc")).toBe(true);
    });

    it("should detect case-insensitively", () => {
      expect(parser.detect("VMESS://abc")).toBe(true);
      expect(parser.detect("VMess://abc")).toBe(true);
    });

    it("should not detect non-vmess", () => {
      expect(parser.detect("vless://abc")).toBe(false);
      expect(parser.detect("trojan://abc")).toBe(false);
      expect(parser.detect("random text")).toBe(false);
    });
  });

  describe("parse() — valid inputs", () => {
    it("should parse a standard VMess config", () => {
      const uri = makeVMessUri(VALID_VMESS);
      const result = parser.parse(uri);

      expect(result.isValid).toBe(true);
      expect(result.protocol).toBe("vmess");
      expect(result.server).toBe("server.example.com");
      expect(result.port).toBe(443);
    });

    it("should remove ps (display name) from canonical", () => {
      const uri = makeVMessUri(VALID_VMESS);
      const result = parser.parse(uri);

      expect(result.canonical).not.toContain("Test Config");
      expect(result.canonical).not.toContain("ps");
    });

    it("should produce deterministic canonical with sorted keys", () => {
      const uri = makeVMessUri(VALID_VMESS);
      const result1 = parser.parse(uri);
      const result2 = parser.parse(uri);

      expect(result1.canonical).toBe(result2.canonical);
    });

    it("should normalize server to lowercase", () => {
      const uri = makeVMessUri({
        ...VALID_VMESS,
        add: "SERVER.Example.COM",
      });
      const result = parser.parse(uri);
      expect(result.server).toBe("server.example.com");
    });

    it("should normalize UUID to lowercase", () => {
      const uri = makeVMessUri({
        ...VALID_VMESS,
        id: "A3482E88-686A-4A58-8126-99C9034E4B09",
      });
      const result = parser.parse(uri);
      expect(result.canonical).toContain("a3482e88");
    });

    it("should preserve connection-affecting fields", () => {
      const uri = makeVMessUri({
        ...VALID_VMESS,
        net: "ws",
        path: "/chat",
        host: "CDN.Example.com",
      });
      const result = parser.parse(uri);
      expect(result.canonical).toContain('"net":"ws"');
      expect(result.canonical).toContain('"path":"/chat"');
      expect(result.canonical).toContain('"host":"cdn.example.com"');
    });

    it("should preserve unknown fields (conservative)", () => {
      const uri = makeVMessUri({
        ...VALID_VMESS,
        "custom-field": "custom-value",
      });
      const result = parser.parse(uri);
      expect(result.canonical).toContain("custom-field");
      expect(result.canonical).toContain("custom-value");
    });
  });

  describe("parse() — invalid inputs", () => {
    it("should reject empty payload", () => {
      const result = parser.parse("vmess://");
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("Empty");
    });

    it("should reject invalid base64", () => {
      const result = parser.parse("vmess://!!!invalid-base64!!!");
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("base64");
    });

    it("should reject invalid JSON", () => {
      const b64 = encodeBase64("not json at all");
      const result = parser.parse(`vmess://${b64}`);
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("JSON");
    });

    it("should reject missing id (UUID)", () => {
      const obj = { ...VALID_VMESS };
      delete (obj as Record<string, unknown>).id;
      const uri = makeVMessUri(obj);
      const result = parser.parse(uri);
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("id");
    });

    it("should reject missing server (add)", () => {
      const obj = { ...VALID_VMESS };
      delete (obj as Record<string, unknown>).add;
      const uri = makeVMessUri(obj);
      const result = parser.parse(uri);
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("add");
    });

    it("should reject missing port", () => {
      const obj = { ...VALID_VMESS };
      delete (obj as Record<string, unknown>).port;
      const uri = makeVMessUri(obj);
      const result = parser.parse(uri);
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("port");
    });

    it("should reject invalid port (0)", () => {
      const uri = makeVMessUri({ ...VALID_VMESS, port: 0 });
      const result = parser.parse(uri);
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("Invalid port");
    });

    it("should reject invalid port (99999)", () => {
      const uri = makeVMessUri({ ...VALID_VMESS, port: 99999 });
      const result = parser.parse(uri);
      expect(result.isValid).toBe(false);
      expect(result.parseError).toContain("Invalid port");
    });
  });

  describe("parseWithHash() — async hash computation", () => {
    it("should produce valid SHA-256 hash", async () => {
      const uri = makeVMessUri(VALID_VMESS);
      const result = await parseVMessWithHash(uri);

      expect(result.isValid).toBe(true);
      expect(result.configHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should be deterministic", async () => {
      const uri = makeVMessUri(VALID_VMESS);
      const r1 = await parseVMessWithHash(uri);
      const r2 = await parseVMessWithHash(uri);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("should produce same hash for different ps", async () => {
      const uri1 = makeVMessUri({ ...VALID_VMESS, ps: "Config A" });
      const uri2 = makeVMessUri({ ...VALID_VMESS, ps: "Config B" });
      const r1 = await parseVMessWithHash(uri1);
      const r2 = await parseVMessWithHash(uri2);
      expect(r1.configHash).toBe(r2.configHash);
    });

    it("should produce different hash for different UUID", async () => {
      const uri1 = makeVMessUri(VALID_VMESS);
      const uri2 = makeVMessUri({
        ...VALID_VMESS,
        id: "b3482e88-686a-4a58-8126-99c9034e4b09",
      });
      const r1 = await parseVMessWithHash(uri1);
      const r2 = await parseVMessWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different server", async () => {
      const uri1 = makeVMessUri(VALID_VMESS);
      const uri2 = makeVMessUri({ ...VALID_VMESS, add: "other.com" });
      const r1 = await parseVMessWithHash(uri1);
      const r2 = await parseVMessWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });

    it("should produce different hash for different port", async () => {
      const uri1 = makeVMessUri(VALID_VMESS);
      const uri2 = makeVMessUri({ ...VALID_VMESS, port: 8443 });
      const r1 = await parseVMessWithHash(uri1);
      const r2 = await parseVMessWithHash(uri2);
      expect(r1.configHash).not.toBe(r2.configHash);
    });
  });
});
