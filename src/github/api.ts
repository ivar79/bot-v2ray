/**
 * GitHub REST API Client
 *
 * Provides a mockable interface for GitHub Git Data API calls.
 * In production, makes real HTTP requests to api.github.com.
 * In tests, use MockGitHubAPI.
 *
 * API base: https://api.github.com
 * Auth: Bearer token via Authorization header
 * API version: 2026-03-10
 *
 * Endpoints used:
 * - GET  /repos/{owner}/{repo}/git/trees/{tree_sha}       — get tree
 * - POST /repos/{owner}/{repo}/git/blobs                  — create blob
 * - POST /repos/{owner}/{repo}/git/trees                  — create tree
 * - GET  /repos/{owner}/{repo}/git/ref/heads/{branch}     — get ref
 * - POST /repos/{owner}/{repo}/git/commits                — create commit
 * - PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}   — update ref
 */

import type {
  GitBlob,
  GitTree,
  GitCommit,
  GitRef,
  TreeEntry,
  GitHubError,
} from "./types";

// ─── Interface ─────────────────────────────────────────────

/**
 * GitHub API client interface.
 * Implementations must be injectable for testing.
 */
export interface GitHubAPI {
  /** Get a tree by SHA or ref. */
  getTree(owner: string, repo: string, ref: string): Promise<GitTree | null>;

  /** Create a blob from content. */
  createBlob(
    owner: string,
    repo: string,
    content: string
  ): Promise<GitBlob | null>;

  /** Create a tree from entries. */
  createTree(
    owner: string,
    repo: string,
    tree: TreeEntry[],
    baseTree?: string
  ): Promise<GitTree | null>;

  /** Get a branch ref. */
  getRef(
    owner: string,
    repo: string,
    branch: string
  ): Promise<GitRef | null>;

  /** Create a commit. */
  createCommit(
    owner: string,
    repo: string,
    message: string,
    tree: string,
    parents: string[]
  ): Promise<GitCommit | null>;

  /** Update a branch ref to point to a new commit. */
  updateRef(
    owner: string,
    repo: string,
    branch: string,
    sha: string,
    force?: boolean
  ): Promise<boolean>;
}

// ─── Production Implementation ─────────────────────────────

/** GitHub API base URL. */
const GITHUB_API_BASE = "https://api.github.com";

/**
 * Production GitHub API client.
 * Makes real HTTP requests to GitHub servers.
 */
export class RealGitHubAPI implements GitHubAPI {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T | null> {
    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      };

      const init: RequestInit = { method, headers };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }

      const response = await fetch(`${GITHUB_API_BASE}${path}`, init);

      if (!response.ok) {
        // Log error details without exposing the token
        const errorBody = (await response.json().catch(() => null)) as GitHubError | null;
        console.error(
          `GitHub API ${method} ${path} failed: ${response.status} ${errorBody?.message ?? "Unknown error"}`
        );
        return null;
      }

      return (await response.json()) as T;
    } catch (err) {
      console.error(
        `GitHub API ${method} ${path} network error:`,
        err instanceof Error ? err.message : "Unknown error"
      );
      return null;
    }
  }

  async getTree(
    owner: string,
    repo: string,
    ref: string
  ): Promise<GitTree | null> {
    return this.request<GitTree>("GET", `/repos/${owner}/${repo}/git/trees/${ref}`);
  }

  async createBlob(
    owner: string,
    repo: string,
    content: string
  ): Promise<GitBlob | null> {
    return this.request<GitBlob>(
      "POST",
      `/repos/${owner}/${repo}/git/blobs`,
      { content, encoding: "utf-8" }
    );
  }

  async createTree(
    owner: string,
    repo: string,
    tree: TreeEntry[],
    baseTree?: string
  ): Promise<GitTree | null> {
    const body: { tree: TreeEntry[]; base_tree?: string } = { tree };
    if (baseTree) body.base_tree = baseTree;
    return this.request<GitTree>(
      "POST",
      `/repos/${owner}/${repo}/git/trees`,
      body
    );
  }

  async getRef(
    owner: string,
    repo: string,
    branch: string
  ): Promise<GitRef | null> {
    return this.request<GitRef>(
      "GET",
      `/repos/${owner}/${repo}/git/ref/heads/${branch}`
    );
  }

  async createCommit(
    owner: string,
    repo: string,
    message: string,
    tree: string,
    parents: string[]
  ): Promise<GitCommit | null> {
    return this.request<GitCommit>(
      "POST",
      `/repos/${owner}/${repo}/git/commits`,
      { message, tree, parents }
    );
  }

  async updateRef(
    owner: string,
    repo: string,
    branch: string,
    sha: string,
    force = false
  ): Promise<boolean> {
    const result = await this.request<{ ref: string }>(
      "PATCH",
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      { sha, force }
    );
    return result !== null;
  }
}

// ─── Mock Implementation ───────────────────────────────────

/**
 * Mock GitHub API for testing.
 * Records all calls and returns configurable responses.
 */
export class MockGitHubAPI implements GitHubAPI {
  /** Recorded calls for assertion. */
  public calls: Array<{
    method: string;
    path: string;
    body?: unknown;
  }> = [];

  /** Configurable responses. */
  public trees: Map<string, GitTree> = new Map();
  public blobs: GitBlob[] = [];
  public createdTrees: GitTree[] = [];
  public refs: Map<string, GitRef> = new Map();
  public commits: GitCommit[] = [];

  /** If set, all API calls return null (simulate network failure). */
  public simulateFailure = false;

  /** If set, specific paths return null (simulate targeted failures). */
  public failPaths: Set<string> = new Set();

  /** If set, getRef returns null (simulate missing branch). */
  public missingBranch: string | null = null;

  async getTree(
    owner: string,
    repo: string,
    ref: string
  ): Promise<GitTree | null> {
    this.calls.push({ method: "GET_TREE", path: `${owner}/${repo}/${ref}` });

    if (this.simulateFailure || this.failPaths.has("getTree")) return null;

    const key = `${owner}/${repo}/${ref}`;
    const tree = this.trees.get(key);
    if (tree) return tree;

    // Return empty tree if not configured
    return {
      sha: "empty_tree_sha",
      url: `https://api.github.com/repos/${owner}/${repo}/git/trees/empty_tree_sha`,
      tree: [],
    };
  }

  async createBlob(
    owner: string,
    repo: string,
    content: string
  ): Promise<GitBlob | null> {
    this.calls.push({ method: "CREATE_BLOB", path: `${owner}/${repo}`, body: content });

    if (this.simulateFailure || this.failPaths.has("createBlob")) return null;

    const idx = this.blobs.length;
    const sha = `blob_sha_${idx}_${content.length}`;
    const blob: GitBlob = {
      sha,
      url: `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
      size: content.length,
    };
    this.blobs.push(blob);
    return blob;
  }

  async createTree(
    owner: string,
    repo: string,
    tree: TreeEntry[],
    baseTree?: string
  ): Promise<GitTree | null> {
    this.calls.push({
      method: "CREATE_TREE",
      path: `${owner}/${repo}`,
      body: { tree, baseTree },
    });

    if (this.simulateFailure || this.failPaths.has("createTree")) return null;

    const sha = `tree_sha_${this.createdTrees.length}`;
    const result: GitTree = {
      sha,
      url: `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}`,
      tree,
    };
    this.createdTrees.push(result);
    return result;
  }

  async getRef(
    owner: string,
    repo: string,
    branch: string
  ): Promise<GitRef | null> {
    this.calls.push({ method: "GET_REF", path: `${owner}/${repo}/heads/${branch}` });

    if (this.simulateFailure || this.failPaths.has("getRef")) return null;
    if (this.missingBranch === branch) return null;

    const key = `${owner}/${repo}/${branch}`;
    const ref = this.refs.get(key);
    if (ref) return ref;

    // Return a default ref
    return {
      ref: `refs/heads/${branch}`,
      url: `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      object: {
        type: "commit",
        sha: "current_commit_sha",
        url: `https://api.github.com/repos/${owner}/${repo}/git/commits/current_commit_sha`,
      },
    };
  }

  async createCommit(
    owner: string,
    repo: string,
    message: string,
    tree: string,
    parents: string[]
  ): Promise<GitCommit | null> {
    this.calls.push({
      method: "CREATE_COMMIT",
      path: `${owner}/${repo}`,
      body: { message, tree, parents },
    });

    if (this.simulateFailure || this.failPaths.has("createCommit")) return null;

    const sha = `commit_sha_${this.commits.length}`;
    const commit: GitCommit = {
      sha,
      url: `https://api.github.com/repos/${owner}/${repo}/git/commits/${sha}`,
      message,
      tree: { sha: tree, url: "" },
      parents: parents.map((s) => ({ sha: s, url: "" })),
    };
    this.commits.push(commit);
    return commit;
  }

  async updateRef(
    owner: string,
    repo: string,
    branch: string,
    sha: string,
    _force = false
  ): Promise<boolean> {
    this.calls.push({
      method: "UPDATE_REF",
      path: `${owner}/${repo}/heads/${branch}`,
      body: { sha },
    });

    if (this.simulateFailure || this.failPaths.has("updateRef")) return false;

    // Update the stored ref
    const key = `${owner}/${repo}/${branch}`;
    this.refs.set(key, {
      ref: `refs/heads/${branch}`,
      url: `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      object: {
        type: "commit",
        sha,
        url: `https://api.github.com/repos/${owner}/${repo}/git/commits/${sha}`,
      },
    });

    return true;
  }

  /** Reset all recorded calls and state. */
  reset(): void {
    this.calls = [];
    this.trees.clear();
    this.blobs = [];
    this.createdTrees = [];
    this.refs.clear();
    this.commits = [];
    this.simulateFailure = false;
    this.failPaths.clear();
    this.missingBranch = null;
  }
}

// ─── Factory ───────────────────────────────────────────────

/** Create a GitHub API client for production use. */
export function createGitHubAPI(token: string): GitHubAPI {
  return new RealGitHubAPI(token);
}
