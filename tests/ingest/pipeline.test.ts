/**
 * Tests — Ingestion Pipeline
 *
 * Tests the core pipeline: extract → parse → dedup → store.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { runPipeline, formatPipelineSummary } from "../../src/ingest/pipeline";
import { createBatch } from "../../src/ingest/batch";
import { countConfigs, getConfigByHash } from "../../src/db/configs";
import { countOccurrences, getOccurrencesByBatchId } from "../../src/db/occurrences";

describe("Ingestion Pipeline", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  async function setupBatch() {
    return createBatch({
      db,
      sourceType: "admin",
      sourceChatId: 123456,
      verifiedBy: 111111,
    });
  }

  describe("runPipeline()", () => {
    it("should process valid VLESS configs", async () => {
      const { batchId } = await setupBatch();
      const text = `vless://a3482e88-686a-4a58-8126-99c9034e4b09@server1.com:443?security=tls#Config1
vless://b3482e88-686a-4a58-8126-99c9034e4b09@server2.com:443?security=tls#Config2`;

      const result = await runPipeline(text, {
        db,
        batchId,
        sourceType: "admin",
        sourceChatId: 123456,
      });

      expect(result.totalExtracted).toBe(2);
      expect(result.validCount).toBe(2);
      expect(result.invalidCount).toBe(0);
      expect(result.newCount).toBe(2);
      expect(result.duplicateCount).toBe(0);
    });

    it("should detect duplicate configs", async () => {
      const { batchId } = await setupBatch();
      const text = `vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443?security=tls#Config1`;

      // First run — should be new
      const r1 = await runPipeline(text, {
        db,
        batchId,
        sourceType: "admin",
        sourceChatId: 123456,
      });
      expect(r1.newCount).toBe(1);
      expect(r1.duplicateCount).toBe(0);

      // Second run with same config — should be duplicate
      const { batchId: batchId2 } = await setupBatch();
      const r2 = await runPipeline(text, {
        db,
        batchId: batchId2,
        sourceType: "admin",
        sourceChatId: 123456,
      });
      expect(r2.newCount).toBe(0);
      expect(r2.duplicateCount).toBe(1);
    });

    it("should handle invalid configs gracefully", async () => {
      const { batchId } = await setupBatch();
      const text = `vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443
vmess://invalidbase64!!!`;

      const result = await runPipeline(text, {
        db,
        batchId,
        sourceType: "admin",
        sourceChatId: 123456,
      });

      expect(result.totalExtracted).toBe(2);
      expect(result.validCount).toBe(1);
      expect(result.invalidCount).toBe(1);
    });

    it("should handle mixed protocols", async () => {
      const { batchId } = await setupBatch();
      const text = `vless://a3482e88-686a-4a58-8126-99c9034e4b09@server1.com:443?security=tls#VLESS
trojan://pass@server2.com:443?security=tls#Trojan
hy2://auth@server3.com:443#HY2`;

      const result = await runPipeline(text, {
        db,
        batchId,
        sourceType: "admin",
        sourceChatId: 123456,
      });

      expect(result.totalExtracted).toBe(3);
      expect(result.validCount).toBe(3);
      expect(result.newCount).toBe(3);
    });

    it("should store occurrences linked to batch", async () => {
      const { batchId } = await setupBatch();
      const text = `vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#C1
vless://b3482e88-686a-4a58-8126-99c9034e4b09@server2.com:443#C2`;

      await runPipeline(text, {
        db,
        batchId,
        sourceType: "admin",
        sourceChatId: 123456,
      });

      const occs = await getOccurrencesByBatchId(db, batchId);
      expect(occs.length).toBe(2);
      expect(occs.every((o) => o.batch_id === batchId)).toBe(true);
    });

    it("should update batch stats correctly", async () => {
      const { batchId } = await setupBatch();
      const text = `vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#C1
vmess://invalid!!!`;

      await runPipeline(text, {
        db,
        batchId,
        sourceType: "admin",
        sourceChatId: 123456,
      });

      // Verify batch stats via DB
      const batch = await db
        .prepare("SELECT * FROM batches WHERE id = ?")
        .bind(batchId)
        .first<{
          total_extracted: number;
          valid_count: number;
          invalid_count: number;
          new_count: number;
          duplicate_count: number;
        }>();

      expect(batch).not.toBeNull();
      expect(batch!.total_extracted).toBe(2);
      expect(batch!.valid_count).toBe(1);
      expect(batch!.invalid_count).toBe(1);
      expect(batch!.new_count).toBe(1);
      expect(batch!.duplicate_count).toBe(0);
    });

    it("should handle empty text", async () => {
      const { batchId } = await setupBatch();
      const result = await runPipeline("", {
        db,
        batchId,
        sourceType: "admin",
      });

      expect(result.totalExtracted).toBe(0);
      expect(result.validCount).toBe(0);
      expect(result.newCount).toBe(0);
    });

    it("should handle text with no configs", async () => {
      const { batchId } = await setupBatch();
      const result = await runPipeline("This is just random text with no configs.", {
        db,
        batchId,
        sourceType: "admin",
      });

      expect(result.totalExtracted).toBe(0);
    });

    it("should handle same config appearing multiple times in text", async () => {
      const { batchId } = await setupBatch();
      const uri = "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#C1";
      const text = `${uri}\n${uri}\n${uri}`;

      const result = await runPipeline(text, {
        db,
        batchId,
        sourceType: "admin",
        sourceChatId: 123456,
      });

      // Text extractor deduplicates case-insensitively, so 1 unique URI
      expect(result.totalExtracted).toBe(1);
      expect(result.newCount).toBe(1);
      expect(result.duplicateCount).toBe(0);
    });

    it("should preserve source traceability", async () => {
      const { batchId } = await setupBatch();
      const text = "vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443#C1";

      await runPipeline(text, {
        db,
        batchId,
        sourceType: "admin",
        sourceChatId: 123456,
        sourceMessageId: 42,
      });

      const occs = await getOccurrencesByBatchId(db, batchId);
      expect(occs.length).toBe(1);
      expect(occs[0].source_type).toBe("admin");
      expect(occs[0].source_chat_id).toBe(123456);
      expect(occs[0].source_message_id).toBe(42);
    });
  });

  describe("formatPipelineSummary()", () => {
    it("should format a human-readable summary", () => {
      const summary = formatPipelineSummary({
        configs: [],
        totalExtracted: 100,
        validCount: 92,
        invalidCount: 8,
        newCount: 70,
        duplicateCount: 22,
        batchId: 42,
      });

      expect(summary).toContain("Batch processed");
      expect(summary).toContain("Total extracted: 100");
      expect(summary).toContain("Valid: 92");
      expect(summary).toContain("Invalid: 8");
      expect(summary).toContain("New: 70");
      expect(summary).toContain("Duplicate: 22");
      expect(summary).toContain("#42");
    });
  });
});
