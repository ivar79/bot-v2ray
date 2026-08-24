/**
 * GitHub Publisher — Type Definitions
 *
 * Types for the GitHub Git Data API and publisher configuration.
 * All types are derived from the official GitHub REST API documentation.
 *
 * API version: 2026-03-10
 * Source: https://docs.github.com/en/rest/git
 */

// ─── Publisher Configuration ────────────────────────────────

/** Configuration for the GitHub publisher. */
export interface GitHubPublisherConfig {
  /** GitHub repository owner (user or organization). */
  owner: string;
  /** GitHub repository name (without .git extension). */
  repo: string;
  /** Target branch name. */
  branch: string;
  /** GitHub personal access token (from Cloudflare secret). */
  token: string;
}

// ─── Publication Result ─────────────────────────────────────

/** Result of a publication attempt. */
export interface PublishResult {
  /** Whether the publication succeeded. */
  success: boolean;
  /** The new commit SHA if publication succeeded, null otherwise. */
  commitSha: string | null;
  /** Number of files that were updated or created. */
  filesChanged: number;
  /** Number of files that were unchanged (skipped). */
  filesUnchanged: number;
  /** Error message if publication failed. */
  error?: string;
  /** Per-file results for detailed reporting. */
  fileResults: FilePublishResult[];
}

/** Result of publishing a single file. */
export interface FilePublishResult {
  /** Filename. */
  name: string;
  /** Whether this specific file was published successfully. */
  success: boolean;
  /** Whether the file was skipped because content was unchanged. */
  skipped: boolean;
  /** Error message if this file failed. */
  error?: string;
}

// ─── GitHub API Response Types ─────────────────────────────

/** Git blob object. */
export interface GitBlob {
  url: string;
  sha: string;
  size?: number;
}

/** Git tree entry. */
export interface TreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
  url?: string;
}

/** Git tree object. */
export interface GitTree {
  sha: string;
  url: string;
  tree: TreeEntry[];
  truncated?: boolean;
}

/** Git commit object. */
export interface GitCommit {
  sha: string;
  url: string;
  message: string;
  tree: { sha: string; url: string };
  parents: Array<{ sha: string; url: string }>;
  author?: {
    name: string;
    email: string;
    date: string;
  };
  committer?: {
    name: string;
    email: string;
    date: string;
  };
}

/** Git reference object. */
export interface GitRef {
  ref: string;
  url: string;
  object: {
    type: string;
    sha: string;
    url: string;
  };
}

/** GitHub API error response. */
export interface GitHubError {
  message: string;
  documentation_url?: string;
  errors?: Array<{ message: string; code: string }>;
}

// ─── Content Encoding ──────────────────────────────────────

/** Encoding used for blob creation. */
export const BLOB_ENCODING = "utf-8" as const;

/** File mode for regular files in the tree. */
export const FILE_MODE = "100644" as const;
