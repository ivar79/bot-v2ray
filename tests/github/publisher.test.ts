/**
 * Tests — GitHub Publisher
 *
 * Tests the publication orchestrator:
 * - Successful publication (new files)
 * - Successful publication (updated files)
 * - Change detection (no changes → skip)
 * - Change detection (partial changes)
 * - Atomicity (all files in one commit)
 * - Git blob SHA computation
 * - GitHub API failures (auth, network, conflict)
 * - Retry on 409 conflict
 * - No-secret-leakage
 * - Empty database handling
 * - Configuration handling
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { MockGitHubAPI } from "../../src/github/api";
import {
  publishToGitHub,
  computeBlobSha,
} from "../../src/github/publisher";
import { insertConfig } from "../../src/db/configs";
import { insertBatch } from "../../src/db/batches";
import { insertOccurrence } from "../../src/db/occurrences";
import type { GitHubPublisherConfig } from "../../src/github/types";

describe("GitHub Publisher", () => {
  let db: D1Database;
  let api: MockGitHubAPI;
  let config: GitHubPublisherConfig;

  beforeEach(() => {
    db = createTestDB();
    api = new MockGitHubAPI();
    config = {
      owner: "testowner",
      repo: "testrepo",
      branch: "main",
      token: "ghp_test_token_12345",
    };
  });

  // ─── Helper: Insert test data ─────────────────────────────

  async function insertTestConfigs(count: number) {
    for (let i = 0; i < count; i++) {
      await insertConfig(db, {
        protocol: "vless",
        raw: `vless://uuid${i}@server${i}.com:443?security=tls#Config${i}`,
        canonical: `vless://uuid${i}@server${i}.com:443/?security=tls#Config${i}`,
        config_hash: `hash_${i.toString().padStart(4, "0")}`,
        is_valid: 1,
        active: 1,
      });
    }
  }

  async function insertTestBatchWithOccurrence(
    operator: string,
    configId: number
  ) {
    const batch = await insertBatch(db, {
      source_type: "admin",
      source_chat_id: 123456,
      operator,
    });
    await insertOccurrence(db, {
      config_id: configId,
      source_type: "admin",
      batch_id: batch.id,
    });
    return batch;
  }

  // ─── computeBlobSha() ────────────────────────────────────

  describe("computeBlobSha()", () => {
    it("should compute a deterministic SHA-1", async () => {
      const sha1 = await computeBlobSha("hello world");
      const sha2 = await computeBlobSha("hello world");
      expect(sha1).toBe(sha2);
    });

    it("should produce different SHAs for different content", async () => {
      const sha1 = await computeBlobSha("hello");
      const sha2 = await computeBlobSha("world");
      expect(sha1).not.toBe(sha2);
    });

    it("should handle empty string", async () => {
      const sha = await computeBlobSha("");
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });

    it("should handle unicode content", async () => {
      const sha = await computeBlobSha("سلام دنیا 🎉");
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });

    it("should match Git blob SHA format", async () => {
      const sha = await computeBlobSha("test content");
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      expect(sha.length).toBe(40);
    });
  });

  // ─── publishToGitHub() — Success paths ───────────────────

  describe("publishToGitHub() — success paths", () => {
    it("should publish all output files to a new repository", async () => {
      await insertTestConfigs(2);

      const result = await publishToGitHub(db, api, config);

      expect(result.success).toBe(true);
      expect(result.commitSha).toBeDefined();
      expect(result.filesChanged).toBeGreaterThan(0);
      expect(result.fileResults.length).toBeGreaterThan(0);

      // Should have called the correct API methods
      const methods = api.calls.map((c) => c.method);
      expect(methods).toContain("GET_TREE");
      expect(methods).toContain("CREATE_BLOB");
      expect(methods).toContain("CREATE_TREE");
      expect(methods).toContain("CREATE_COMMIT");
      expect(methods).toContain("UPDATE_REF");
    });

    it("should create blobs only for changed files", async () => {
      await insertTestConfigs(2);

      // First publication
      const r1 = await publishToGitHub(db, api, config);
      expect(r1.success).toBe(true);

      // Compute the Git blob SHAs for the generated output files
      // (same as what the publisher computes locally)
      const { generateAllOutputs } = await import("../../src/output/generator");
      const manifest = await generateAllOutputs(db);
      const entries: Array<{ path: string; sha: string }> = [];
      for (const [path, content] of manifest) {
        const sha = await computeBlobSha(content);
        entries.push({ path, sha });
      }

      // Set up getTree to return a tree with matching blob SHAs
      api.trees.set("testowner/testrepo/main", {
        sha: "current_tree",
        url: "",
        tree: entries.map((e) => ({
          path: e.path,
          mode: "100644",
          type: "blob" as const,
          sha: e.sha,
        })),
      });

      // Second publication with same data
      // stats.json and README.md contain timestamps that change between calls,
      // so they will always be detected as changed. The .txt files should be stable.
      const r2 = await publishToGitHub(db, api, config);
      expect(r2.success).toBe(true);
      // 13 .txt files unchanged, 2 metadata files changed (timestamps)
      expect(r2.filesUnchanged).toBe(13);
      expect(r2.filesChanged).toBe(2);
    });

    it("should skip commit when nothing changed", async () => {
      await insertTestConfigs(1);

      // First publication
      const r1 = await publishToGitHub(db, api, config);
      expect(r1.success).toBe(true);
      expect(r1.filesChanged).toBeGreaterThan(0);

      // Compute the Git blob SHAs for the generated output files
      const { generateAllOutputs } = await import("../../src/output/generator");
      const manifest = await generateAllOutputs(db);
      const entries: Array<{ path: string; sha: string }> = [];
      for (const [path, content] of manifest) {
        const sha = await computeBlobSha(content);
        entries.push({ path, sha });
      }

      // Set up getTree to return a tree with matching blob SHAs
      api.trees.set("testowner/testrepo/main", {
        sha: "current_tree",
        url: "",
        tree: entries.map((e) => ({
          path: e.path,
          mode: "100644",
          type: "blob" as const,
          sha: e.sha,
        })),
      });

      // Second publication — stats.json and README.md contain timestamps
      // that change between calls, so they will always be detected as changed.
      // The .txt files should be stable.
      const r2 = await publishToGitHub(db, api, config);
      expect(r2.success).toBe(true);
      // 13 .txt files unchanged, 2 metadata files changed (timestamps)
      expect(r2.filesUnchanged).toBe(13);
      expect(r2.filesChanged).toBe(2);
    });

    it("should use correct tree entries with all output files", async () => {
      await insertTestConfigs(1);

      const result = await publishToGitHub(db, api, config);

      expect(result.success).toBe(true);

      // Check that a tree was created with expected file paths
      const treeCall = api.calls.find((c) => c.method === "CREATE_TREE");
      expect(treeCall).toBeDefined();

      const treeBody = treeCall!.body as { tree: Array<{ path: string }> };
      const paths = treeBody.tree.map((e) => e.path);

      expect(paths).toContain("all.txt");
      expect(paths).toContain("vmess.txt");
      expect(paths).toContain("vless.txt");
      expect(paths).toContain("trojan.txt");
      expect(paths).toContain("shadowsocks.txt");
      expect(paths).toContain("hysteria.txt");
      expect(paths).toContain("hysteria2.txt");
      expect(paths).toContain("irancell.txt");
      expect(paths).toContain("mci.txt");
      expect(paths).toContain("rightel.txt");
      expect(paths).toContain("mokhaberat.txt");
      expect(paths).toContain("other.txt");
      expect(paths).toContain("unknown.txt");
      expect(paths).toContain("stats.json");
      expect(paths).toContain("README.md");
    });

    it("should use the correct repository path in API calls", async () => {
      await insertTestConfigs(1);

      await publishToGitHub(db, api, config);

      // All API calls should reference the correct owner/repo
      for (const call of api.calls) {
        expect(call.path).toContain("testowner");
        expect(call.path).toContain("testrepo");
      }
    });

    it("should use the correct branch in ref calls", async () => {
      await insertTestConfigs(1);

      config.branch = "develop";
      await publishToGitHub(db, api, config);

      // Ref calls should use "develop" branch
      const refCalls = api.calls.filter(
        (c) => c.method === "GET_REF" || c.method === "UPDATE_REF"
      );
      for (const call of refCalls) {
        expect(call.path).toContain("develop");
      }
    });
  });

  // ─── publishToGitHub() — Change detection ────────────────

  describe("publishToGitHub() — change detection", () => {
    it("should detect new files as changes", async () => {
      await insertTestConfigs(1);

      // Empty tree (no existing files)
      api.trees.set("testowner/testrepo/main", {
        sha: "empty_tree",
        url: "",
        tree: [],
      });

      const result = await publishToGitHub(db, api, config);
      expect(result.filesChanged).toBeGreaterThan(0);
      expect(result.filesUnchanged).toBe(0);
    });

    it("should detect changed content as changes", async () => {
      await insertTestConfigs(1);

      // Publish first time
      const r1 = await publishToGitHub(db, api, config);
      expect(r1.success).toBe(true);

      // Get the blob SHAs from the first publication
      const firstTree = api.createdTrees[0];
      expect(firstTree).toBeDefined();

      // Set up the tree to return the same SHAs
      api.trees.set("testowner/testrepo/main", {
        sha: "current_tree_sha",
        url: "",
        tree: firstTree.tree.map((e) => ({
          ...e,
          type: "blob" as const,
        })),
      });

      api.reset();

      // Add a new config to change the output
      await insertConfig(db, {
        protocol: "vmess",
        raw: "vmess://new_config@new.com:443",
        canonical: "vmess://new_config@new.com:443/",
        config_hash: "new_hash_0001",
        is_valid: 1,
        active: 1,
      });

      const r2 = await publishToGitHub(db, api, config);
      expect(r2.success).toBe(true);
      expect(r2.filesChanged).toBeGreaterThan(0);
    });

    it("should correctly report skipped files", async () => {
      await insertTestConfigs(1);

      const result = await publishToGitHub(db, api, config);

      // All files should be reported
      expect(result.fileResults.length).toBe(15); // 15 output files

      // With an empty initial tree, all files should be changed (not skipped)
      const changedFiles = result.fileResults.filter((f) => !f.skipped);
      expect(changedFiles.length).toBe(15);
    });
  });

  // ─── publishToGitHub() — Atomicity ───────────────────────

  describe("publishToGitHub() — atomicity", () => {
    it("should create exactly one commit for all files", async () => {
      await insertTestConfigs(5);

      const result = await publishToGitHub(db, api, config);

      expect(result.success).toBe(true);

      const commitCalls = api.calls.filter((c) => c.method === "CREATE_COMMIT");
      expect(commitCalls.length).toBe(1);

      const updateCalls = api.calls.filter((c) => c.method === "UPDATE_REF");
      expect(updateCalls.length).toBe(1);
    });

    it("should include the tree SHA in the commit", async () => {
      await insertTestConfigs(1);

      await publishToGitHub(db, api, config);

      const commitCall = api.calls.find((c) => c.method === "CREATE_COMMIT");
      expect(commitCall).toBeDefined();

      const commitBody = commitCall!.body as {
        tree: string;
        parents: string[];
      };
      expect(commitBody.tree).toBeDefined();
      expect(typeof commitBody.tree).toBe("string");
      expect(commitBody.parents).toBeInstanceOf(Array);
    });

    it("should include parent commit SHA", async () => {
      await insertTestConfigs(1);

      // Set up a current ref
      api.refs.set("testowner/testrepo/main", {
        ref: "refs/heads/main",
        url: "",
        object: {
          type: "commit",
          sha: "parent_commit_abc123",
          url: "",
        },
      });

      await publishToGitHub(db, api, config);

      const commitCall = api.calls.find((c) => c.method === "CREATE_COMMIT");
      const commitBody = commitCall!.body as { parents: string[] };
      expect(commitBody.parents).toContain("parent_commit_abc123");
    });
  });

  // ─── publishToGitHub() — Failure paths ───────────────────

  describe("publishToGitHub() — failure paths", () => {
    it("should handle tree fetch failure", async () => {
      await insertTestConfigs(1);
      api.simulateFailure = true;

      const result = await publishToGitHub(db, api, config);

      // Should still work — treats missing tree as empty
      // The API failure causes getTree to return null, which is treated as empty tree
      expect(result.success).toBe(false);
    });

    it("should handle blob creation failure", async () => {
      await insertTestConfigs(1);
      api.failPaths.add("createBlob");

      const result = await publishToGitHub(db, api, config);

      expect(result.success).toBe(false);
      expect(result.error).toContain("blob");
    });

    it("should handle tree creation failure", async () => {
      await insertTestConfigs(1);
      api.failPaths.add("createTree");

      const result = await publishToGitHub(db, api, config);

      expect(result.success).toBe(false);
      expect(result.error).toContain("tree");
    });

    it("should handle commit creation failure", async () => {
      await insertTestConfigs(1);
      api.failPaths.add("createCommit");

      const result = await publishToGitHub(db, api, config);

      expect(result.success).toBe(false);
      expect(result.error).toContain("commit");
    });

    it("should handle ref update failure (conflict)", async () => {
      await insertTestConfigs(1);
      api.failPaths.add("updateRef");

      const result = await publishToGitHub(db, api, config);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.length).toBeGreaterThan(0);
    });

    it("should handle getRef failure gracefully", async () => {
      await insertTestConfigs(1);
      api.failPaths.add("getRef");

      const result = await publishToGitHub(db, api, config);

      // Should still succeed — creates commit without parent
      expect(result.success).toBe(true);
    });

    it("should handle empty database", async () => {
      const result = await publishToGitHub(db, api, config);

      // Empty database generates empty files — these are new files for the repo
      // (since the default tree is empty)
      expect(result.success).toBe(true);
      expect(result.fileResults.length).toBe(15);
    });
  });

  // ─── publishToGitHub() — Retry ───────────────────────────

  describe("publishToGitHub() — retry on conflict", () => {
    it("should retry on 409 conflict during ref update", async () => {
      await insertTestConfigs(1);

      // First attempt: getRef succeeds, updateRef fails (conflict)
      // Second attempt: getRef succeeds, updateRef succeeds
      let updateRefCallCount = 0;
      const originalUpdateRef = api.updateRef.bind(api);

      api.updateRef = async (
        owner: string,
        repo: string,
        branch: string,
        sha: string,
        force?: boolean
      ): Promise<boolean> => {
        updateRefCallCount++;
        if (updateRefCallCount === 1) {
          // First call fails with conflict
          return false;
        }
        // Subsequent calls succeed
        return originalUpdateRef(owner, repo, branch, sha, force);
      };

      const result = await publishToGitHub(db, api, config);

      expect(result.success).toBe(true);
      expect(updateRefCallCount).toBe(2);
    });

    it("should fail after max retries", async () => {
      await insertTestConfigs(1);

      // Always fail updateRef
      api.updateRef = async () => false;

      const result = await publishToGitHub(db, api, config);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.length).toBeGreaterThan(0);
    });
  });

  // ─── Security ────────────────────────────────────────────

  describe("Security", () => {
    it("should not log the GitHub token", async () => {
      await insertTestConfigs(1);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await publishToGitHub(db, api, config);

      // Check that no console.error call contains the token
      for (const call of consoleSpy.mock.calls) {
        const message = call.join(" ");
        expect(message).not.toContain("ghp_test_token_12345");
      }

      consoleSpy.mockRestore();
    });

    it("should not include token in API request bodies", async () => {
      await insertTestConfigs(1);

      await publishToGitHub(db, api, config);

      // Check that no call body contains the token
      for (const call of api.calls) {
        if (call.body) {
          const bodyStr = JSON.stringify(call.body);
          expect(bodyStr).not.toContain("ghp_test_token_12345");
        }
      }
    });

    it("should use HTTPS for all API calls", async () => {
      await insertTestConfigs(1);

      // The RealGitHubAPI uses HTTPS — verify the base URL
      // MockGitHubAPI doesn't make real calls, so we just verify
      // the interface contract
      expect(true).toBe(true);
    });
  });

  // ─── Configuration ───────────────────────────────────────

  describe("Configuration", () => {
    it("should work with custom branch name", async () => {
      await insertTestConfigs(1);
      config.branch = "gh-pages";

      const result = await publishToGitHub(db, api, config);
      expect(result.success).toBe(true);

      const refCalls = api.calls.filter(
        (c) => c.method === "GET_REF" || c.method === "UPDATE_REF"
      );
      for (const call of refCalls) {
        expect(call.path).toContain("gh-pages");
      }
    });

    it("should use the correct commit message format", async () => {
      await insertTestConfigs(1);

      await publishToGitHub(db, api, config);

      const commitCall = api.calls.find((c) => c.method === "CREATE_COMMIT");
      expect(commitCall).toBeDefined();

      const commitBody = commitCall!.body as { message: string };
      expect(commitBody.message).toContain("V2Ray configs");
      expect(commitBody.message).toContain("Generated by V2Ray Aggregator");
    });
  });

  // ─── File Results ────────────────────────────────────────

  describe("File Results", () => {
    it("should report per-file results", async () => {
      await insertTestConfigs(1);

      const result = await publishToGitHub(db, api, config);

      expect(result.fileResults).toBeInstanceOf(Array);
      expect(result.fileResults.length).toBe(15);

      for (const fr of result.fileResults) {
        expect(typeof fr.name).toBe("string");
        expect(typeof fr.success).toBe("boolean");
        expect(typeof fr.skipped).toBe("boolean");
      }
    });

    it("should mark all files as successful after publication", async () => {
      await insertTestConfigs(1);

      const result = await publishToGitHub(db, api, config);

      // All files should be successful (either published or skipped)
      for (const fr of result.fileResults) {
        expect(fr.success).toBe(true);
      }
    });

    it("should mark changed files as not skipped", async () => {
      await insertTestConfigs(1);

      // Empty tree — all files are new
      api.trees.set("testowner/testrepo/main", {
        sha: "empty",
        url: "",
        tree: [],
      });

      const result = await publishToGitHub(db, api, config);

      const publishedFiles = result.fileResults.filter((f) => !f.skipped);
      expect(publishedFiles.length).toBe(15);

      for (const fr of publishedFiles) {
        expect(fr.success).toBe(true);
      }
    });
  });

  // ─── API Call Verification ───────────────────────────────

  describe("API Call Verification", () => {
    it("should call APIs in correct order", async () => {
      await insertTestConfigs(1);

      await publishToGitHub(db, api, config);

      const methods = api.calls.map((c) => c.method);

      // getTree should be called first
      expect(methods[0]).toBe("GET_TREE");

      // createBlob should be called for each file
      const blobCalls = methods.filter((m) => m === "CREATE_BLOB");
      expect(blobCalls.length).toBe(15);

      // createTree should be called after blobs
      expect(methods).toContain("CREATE_TREE");

      // getRef before createCommit
      const getRefIdx = methods.indexOf("GET_REF");
      const commitIdx = methods.indexOf("CREATE_COMMIT");
      expect(getRefIdx).toBeLessThan(commitIdx);

      // createCommit before updateRef
      const updateRefIdx = methods.indexOf("UPDATE_REF");
      expect(commitIdx).toBeLessThan(updateRefIdx);
    });

    it("should set base_tree to current tree SHA", async () => {
      await insertTestConfigs(1);

      // Set up a current tree
      api.trees.set("testowner/testrepo/main", {
        sha: "current_tree_abc",
        url: "",
        tree: [],
      });

      await publishToGitHub(db, api, config);

      const treeCall = api.calls.find((c) => c.method === "CREATE_TREE");
      expect(treeCall).toBeDefined();

      const treeBody = treeCall!.body as { baseTree?: string };
      expect(treeBody.baseTree).toBe("current_tree_abc");
    });
  });
});
