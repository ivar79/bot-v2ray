/**
 * Tests — Text Extractor
 *
 * Tests extraction of config URIs from mixed text content.
 */

import { describe, it, expect } from "vitest";
import { extractConfigs } from "../../src/parsers/index";

describe("Text Extractor", () => {
  it("should extract a single VLESS config from plain text", () => {
    const text = "Use this config: vless://abc123@server.com:443?security=tls#MyConfig";
    const results = extractConfigs(text);
    expect(results.length).toBe(1);
    expect(results[0]).toContain("vless://");
  });

  it("should extract multiple configs from mixed text", () => {
    const text = `
Here are some configs:
vless://uuid@server1.com:443?security=tls#Config1
vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCJ9@server2.com:443
trojan://pass@server3.com:443?security=tls#Config3
    `;
    const results = extractConfigs(text);
    expect(results.length).toBe(3);
  });

  it("should handle line breaks between configs", () => {
    const text = `vless://a@b.com:443
vmess://eyJ2IjoiMiJ9
trojan://c@d.com:443`;
    const results = extractConfigs(text);
    expect(results.length).toBe(3);
  });

  it("should deduplicate configs (case-insensitive)", () => {
    const text = `
vless://abc@server.com:443#Test
VLESS://abc@server.com:443#Test
vless://abc@server.com:443#Different
    `;
    const results = extractConfigs(text);
    // First two are case-variants of the same URI → deduplicated
    // Third has a different fragment → different URI
    expect(results.length).toBe(2);
  });

  it("should handle surrounding markdown text", () => {
    const text = `
## Configs for Iran

Here is a **great** config:
\`\`\`
vless://uuid@server.com:443?security=reality&sni=google.com#Reality
\`\`\`

And another one in the list:
- vless://uuid2@server2.com:443?security=tls#TLS
    `;
    const results = extractConfigs(text);
    expect(results.length).toBe(2);
  });

  it("should handle configs with special characters", () => {
    const text = `vless://uuid@server.com:443?security=tls&fp=chrome&sni=example.com#Config%201`;
    const results = extractConfigs(text);
    expect(results.length).toBe(1);
  });

  it("should return empty for text with no configs", () => {
    const text = "This is just regular text with no configurations at all.";
    const results = extractConfigs(text);
    expect(results.length).toBe(0);
  });

  it("should return empty for empty input", () => {
    expect(extractConfigs("")).toEqual([]);
    expect(extractConfigs("   ")).toEqual([]);
  });

  it("should handle Shadowsocks configs", () => {
    const text = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@server.com:8388#SSConfig";
    const results = extractConfigs(text);
    expect(results.length).toBe(1);
    expect(results[0]).toContain("ss://");
  });

  it("should handle Hysteria2 configs", () => {
    const text = `hysteria2://auth@server.com:443?obfs=password#HY2Config
hy2://auth@server2.com:443#HY2Alias`;
    const results = extractConfigs(text);
    expect(results.length).toBe(2);
  });

  it("should handle Hysteria v1 configs", () => {
    const text = "hysteria://auth@server.com:8443?obfs=obfs-local#HY1";
    const results = extractConfigs(text);
    expect(results.length).toBe(1);
  });

  it("should strip trailing punctuation from URIs", () => {
    const text = `Check this out:
vless://uuid@server.com:443?security=tls#Config.
Also see: vless://uuid2@server2.com:443#Config!`;
    const results = extractConfigs(text);
    expect(results.length).toBe(2);
    expect(results[0]).not.toMatch(/\.$/);
    expect(results[1]).not.toMatch(/!$/);
  });

  it("should not extract arbitrary text as config", () => {
    const text = "This vless thing is cool but not a real config.";
    const results = extractConfigs(text);
    // "vless thing" doesn't have :// after vless
    expect(results.length).toBe(0);
  });

  it("should handle a long text with many configs", () => {
    const configs = Array.from(
      { length: 50 },
      (_, i) => `vless://uuid${i}@server${i}.com:443?security=tls#Config${i}`
    );
    const text = configs.join("\n");
    const results = extractConfigs(text);
    expect(results.length).toBe(50);
  });
});
