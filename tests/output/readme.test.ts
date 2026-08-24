/**
 * Tests — Output Engine: README Generator
 *
 * Tests README.md generation:
 * - Content structure
 * - Protocol listing
 * - Operator listing
 * - Methodology description
 * - Disclaimer wording
 * - No false claims about Iran testing
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { generateReadme } from "../../src/output/readme";
import { generateStats } from "../../src/output/stats";
import { insertConfig, deactivateConfig } from "../../src/db/configs";
import { insertBatch } from "../../src/db/batches";
import { insertOccurrence } from "../../src/db/occurrences";
import { insertSource } from "../../src/db/sources";
import type { OutputStats } from "../../src/output/types";

describe("Output Engine — README Generator", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  describe("generateReadme()", () => {
    it("should include the project title", async () => {
      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).toContain("# V2Ray Configuration Aggregator");
    });

    it("should include last updated timestamp", async () => {
      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).toContain("Last updated:");
      expect(readme).toContain(stats.generated_at);
    });

    it("should include total active configurations count", async () => {
      await insertConfig(db, {
        protocol: "vless", raw: "vless://h1@x.com:443",
        canonical: "vless://h1@x.com:443/", config_hash: "h1",
      });
      await insertConfig(db, {
        protocol: "vmess", raw: "vmess://h2@x.com:443",
        canonical: "vmess://h2@x.com:443/", config_hash: "h2",
      });

      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).toContain("2");
      expect(readme).toContain("Total active configurations");
    });

    it("should list all supported protocols", async () => {
      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).toContain("VMess");
      expect(readme).toContain("VLESS");
      expect(readme).toContain("Trojan");
      expect(readme).toContain("Shadowsocks");
      expect(readme).toContain("Hysteria");
      expect(readme).toContain("Hysteria2");
    });

    it("should list all operator categories", async () => {
      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).toContain("Irancell");
      expect(readme).toContain("MCI");
      expect(readme).toContain("Rightel");
      expect(readme).toContain("Mokhaberat");
      expect(readme).toContain("Other");
      expect(readme).toContain("Unknown");
    });

    it("should list all generated files", async () => {
      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).toContain("`all.txt`");
      expect(readme).toContain("`vmess.txt`");
      expect(readme).toContain("`vless.txt`");
      expect(readme).toContain("`trojan.txt`");
      expect(readme).toContain("`shadowsocks.txt`");
      expect(readme).toContain("`hysteria.txt`");
      expect(readme).toContain("`hysteria2.txt`");
      expect(readme).toContain("`irancell.txt`");
      expect(readme).toContain("`mci.txt`");
      expect(readme).toContain("`rightel.txt`");
      expect(readme).toContain("`mokhaberat.txt`");
      expect(readme).toContain("`other.txt`");
      expect(readme).toContain("`unknown.txt`");
      expect(readme).toContain("`stats.json`");
      expect(readme).toContain("`README.md`");
    });

    it("should include methodology section", async () => {
      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).toContain("## Methodology");
      expect(readme).toContain("canonicalized");
      expect(readme).toContain("deduplicated");
      expect(readme).toContain("SHA-256");
    });

    it("should include sorting documentation", async () => {
      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).toContain("## Sorting");
      expect(readme).toContain("protocol");
      expect(readme).toContain("configuration hash");
    });

    it("should include disclaimer section", async () => {
      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).toContain("## Disclaimer");
      expect(readme).toContain("does not");
      expect(readme).toContain("network connectivity");
    });

    it("should NOT claim 'tested from Iran'", async () => {
      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).not.toContain("tested from Iran");
      expect(readme).not.toContain("Tested from Iran");
      expect(readme).not.toContain("tested in Iran");
    });

    it("should use correct operator classification wording", async () => {
      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).toContain(
        "Operator classification is based on administrator-provided verification"
      );
    });

    it("should not expose Telegram IDs", async () => {
      await insertSource(db, { chat_id: -1001234567890 });
      await insertBatch(db, {
        source_type: "admin",
        source_chat_id: 123456789,
        verified_by: 987654321,
      });

      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).not.toContain("123456789");
      expect(readme).not.toContain("987654321");
      expect(readme).not.toContain("-1001234567890");
    });

    it("should include source and batch counts from stats", async () => {
      await insertSource(db, { chat_id: 1001 });
      await insertSource(db, { chat_id: 1002 });
      await insertBatch(db, { source_type: "admin", source_chat_id: 111 });
      await insertBatch(db, { source_type: "admin", source_chat_id: 222 });
      await insertBatch(db, { source_type: "trusted_channel", source_chat_id: 333 });

      const stats = await generateStats(db);
      const readme = await generateReadme(db, stats);

      expect(readme).toContain("Sources:");
      expect(readme).toContain("2");
      expect(readme).toContain("Ingestion batches:");
      expect(readme).toContain("3");
    });
  });
});
