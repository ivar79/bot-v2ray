/**
 * Tests — Telegram API: HTML sanitization
 *
 * The sanitizer prevents Telegram's \"can't parse entities: Unsupported
 * start tag ...\" errors that made inline buttons appear broken.
 */

import { describe, it, expect } from "vitest";
import { sanitizeTelegramHtml, escapeHtml } from "../../src/telegram/api";

describe("sanitizeTelegramHtml()", () => {
  it("keeps supported inline tags intact", () => {
    const out = sanitizeTelegramHtml("<b>Title</b> and <code>cmd</code>");
    expect(out).toBe("<b>Title</b> and <code>cmd</code>");
  });

  it("escapes literal <url> so Telegram does not see a tag", () => {
    const out = sanitizeTelegramHtml("Usage: /addsub <url> [name]");
    expect(out).toBe("Usage: /addsub &lt;url&gt; [name]");
  });

  it("escapes non-ASCII angle-bracket content (e.g. <ساعت>)", () => {
    const out = sanitizeTelegramHtml("/autofetch interval <ساعت>");
    expect(out).toBe("/autofetch interval &lt;ساعت&gt;");
  });

  it("escapes & in URLs inside HTML messages", () => {
    const out = sanitizeTelegramHtml("https://x.com/?a=1&b=2");
    expect(out).toBe("https://x.com/?a=1&amp;b=2");
  });

  it("does not double-escape already-safe text", () => {
    const out = sanitizeTelegramHtml("Plain text, 100% safe");
    expect(out).toBe("Plain text, 100% safe");
  });
})

describe("escapeHtml()", () => {
  it("escapes & < >", () => {
    expect(escapeHtml("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });
})
