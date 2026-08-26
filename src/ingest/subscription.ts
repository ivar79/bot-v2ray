/**
 * Subscription Fetcher - MVP
 * Fetches V2Ray configs from subscription URLs.
 * Supports plain text and base64 subscriptions.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { SourceRow } from "../db/connection";
import { getEnabledSubscriptions, updateSourceFetchResult } from "../db/sources";
import {
  createFetchRun,
  getActiveFetchRun,
  requestFetchCancellation,
  isFetchCancellationRequested,
  finishFetchRun,
  cleanupStaleFetchRuns,
} from "../db/fetch-runs";
import { createBatch, completeBatchRun, failBatchRun } from "./batch";
import { runPipeline } from "./pipeline";
import { tryDecodeBase64 } from "../utils/base64";
import type { TelegramBotAPI } from "../telegram/api";
import { autoPublishConfigs, type AutoPublishResult } from "../telegram/output-publisher";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const MAX_READ_SIZE = 2 * 1024 * 1024;
const MAX_CONFIGS_PER_SUB = 2000;
const MAX_SUBS_PER_CYCLE = 20;
const AUTO_DISABLE_THRESHOLD = 3;

export type SubFormat = "base64" | "plain" | "unknown";

export interface FetchResult {
  success: boolean;
  content?: string;
  truncated?: boolean;
  error?: string;
  httpStatus?: number;
}

export interface SubscriptionProcessResult {
  sourceChatId: number;
  title: string | null;
  success: boolean;
  configCount: number;
  newCount: number;
  duplicateCount: number;
  format: SubFormat;
  error?: string;
  cancelled?: boolean;
  /** IDs of configs newly inserted during this fetch (for auto-publish). */
  newConfigIds: number[];}

export interface FetchAllResult {
  totalProcessed: number;
  successCount: number;
  failCount: number;
  skipCount: number;
  cancelled?: boolean;
  /** Per-source failure reasons (for user-facing reporting). */
  errors: string[];
  /** Result of auto-publishing new configs (undefined when no API client). */
  published?: AutoPublishResult;}

export interface FetchCancellation {
  isCancelled: () => boolean;
}

export interface FetchInstrumentation {
  flowId: string;
  abortSignal?: AbortSignal;
  db?: D1Database;
  userId?: number;
}

interface ActiveFetch {
  cancelled: boolean;
  userId: number;
  chatId: number;
  controller: AbortController;
  pollTimer?: ReturnType<typeof setInterval>;
}

const activeFetches = new Map<string, ActiveFetch>();


/** Register a manual fetch in memory and persist its identity for other Worker requests. */
export async function registerFetch(flowId: string, userId: number, chatId: number, db?: D1Database): Promise<boolean> {
  if (!flowId || activeFetches.has(flowId)) return false;
  if (db) {
    await cleanupStaleFetchRuns(db);
    if (!await createFetchRun(db, flowId, userId, chatId)) return false;
  }
  activeFetches.set(flowId, { cancelled: false, userId, chatId, controller: new AbortController() });
  return true;
}

/** Find a running fetch owned by a user in memory or persistent state. */
export async function getActiveFetch(userId: number, chatId: number, db?: D1Database): Promise<string | null> {
  for (const [flowId, fetch] of activeFetches) {
    if (fetch.userId === userId && fetch.chatId === chatId) return flowId;
  }
  if (!db) return null;
  const run = await getActiveFetchRun(db, userId, chatId);
  return run?.flow_id ?? null;
}

/** Request cancellation in memory and persist it for the fetch's Worker request. */
export async function cancelFetch(flowId: string, userId: number, chatId: number, db?: D1Database): Promise<boolean> {
  const fetch = activeFetches.get(flowId);
  if (fetch) {
    if (fetch.userId !== userId || fetch.chatId !== chatId) return false;
    fetch.cancelled = true;
    fetch.controller.abort();
    if (db) await requestFetchCancellation(db, flowId, userId, chatId);
    return true;
  }
  if (!db) return false;
  return requestFetchCancellation(db, flowId, userId, chatId);
}

/** Read persistent cancellation state for a fetch flow. */
export async function isFetchCancelled(flowId: string, db: D1Database): Promise<boolean> {
  return isFetchCancellationRequested(db, flowId);
}

/** Get a cancellation token that also polls persistent D1 state across Worker requests. */
export function getFetchCancellation(flowId: string, db?: D1Database, userId?: number): FetchCancellation | null {
  const fetch = activeFetches.get(flowId);
  if (fetch) {
    if (db && userId !== undefined && !fetch.pollTimer) {
      fetch.pollTimer = setInterval(() => {
        void isFetchCancelled(flowId, db).then((cancelled) => {
          if (cancelled) {
            fetch.cancelled = true;
            fetch.controller.abort();
          }
        });
      }, 150);
    }
    return { isCancelled: () => fetch.cancelled };
  }
  return null;
}

/** Get the abort signal for a registered fetch. */
export function getFetchAbortSignal(flowId: string): AbortSignal | null {
  return activeFetches.get(flowId)?.controller.signal ?? null;
}

/** Remove a completed fetch from memory and persistent state. */
export async function unregisterFetch(flowId: string, db?: D1Database, userId?: number, status: "cancelled" | "completed" | "failed" = "completed"): Promise<void> {
  const fetch = activeFetches.get(flowId);
  if (fetch?.pollTimer !== undefined) clearInterval(fetch.pollTimer);
  activeFetches.delete(flowId);
  if (db) await finishFetchRun(db, flowId, status);
}

export function isFetchActive(flowId: string): boolean {
  return activeFetches.has(flowId);
}

export async function fetchWithLimits(url: string, cancellation?: FetchCancellation, abortSignal?: AbortSignal): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const cancelPollId = cancellation && abortSignal
    ? setInterval(() => {
        if (cancellation.isCancelled()) controller.abort();
      }, 100)
    : undefined;
  if (abortSignal) {
    if (abortSignal.aborted) controller.abort();
    else abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "V2RayAggregator/1.0" }, redirect: "follow" });
    if (!response.ok) return { success: false, error: "HTTP " + response.status, httpStatus: response.status };
    const cl = response.headers.get("content-length");
    if (cl && parseInt(cl, 10) > MAX_RESPONSE_SIZE) return { success: false, error: "Response too large" };
    const reader = response.body?.getReader();
    if (!reader) return { success: false, error: "No body" };
    const chunks: Uint8Array[] = [];
    let total = 0, truncated = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > MAX_READ_SIZE) { truncated = true; reader.cancel().catch(() => {}); break; }
    }
    const dec = new TextDecoder();
    let content = "";
    for (let i = 0; i < chunks.length; i++) content += dec.decode(chunks[i], { stream: i < chunks.length - 1 });
    if (total === 0) return { success: false, error: "Empty response" };
    return { success: true, content, truncated };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { success: false, error: cancellation?.isCancelled() ? "Cancelled" : "Timeout (20s)" };
    }
    return { success: false, error: e instanceof Error ? e.message : "Unknown" };
  } finally {
    clearTimeout(timeoutId);
    if (cancelPollId !== undefined) clearInterval(cancelPollId);
  }
}

// Use indexOf instead of regex to avoid shell escaping issues with /
function hasProtocolURIs(text: string): boolean {
  return text.includes("vmess://") || text.includes("vless://") ||
    text.includes("trojan://") || text.includes("ss://") ||
    text.includes("hysteria2://") || text.includes("hy2://") ||
    text.includes("hysteria://");
}


export function detectFormat(content: string): SubFormat {
  if (!content || !content.trim()) return "unknown";
  const trimmed = content.trim();
  // Tolerant base64 decode: handles whitespace/newlines, URL-safe alphabet,
  // and missing/incorrect padding — common in real-world subscription payloads.
  const decoded = tryDecodeBase64(trimmed);
  if (decoded && hasProtocolURIs(decoded)) return "base64";
  if (hasProtocolURIs(trimmed)) return "plain";
  return "unknown";
}

// Config URI pattern: matches vmess://, vless://, etc. followed by non-whitespace



// Extract config URIs using indexOf-based approach (avoids regex escaping issues)
function extractConfigURIs(text: string): string[] {
  const schemes = ['vmess://', 'vless://', 'trojan://', 'ss://', 'hysteria2://', 'hy2://', 'hysteria://'];
  const results: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let bestIdx = -1;
    let bestScheme = '';
    for (const scheme of schemes) {
      const idx = text.indexOf(scheme, pos);
      if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
        bestIdx = idx;
        bestScheme = scheme;
      }
    }
    if (bestIdx < 0) break;
    // Find end of URI (whitespace or end of string)
    let end = bestIdx + bestScheme.length;
    while (end < text.length && !/\s/.test(text.charAt(end))) end++;
    const uri = text.slice(bestIdx, end);
    if (uri.length > 10) results.push(uri);
    pos = end;
  }
  return results;
}
export function extractConfigs(content: string, format: SubFormat): string[] {
  if (!content) return [];
  let text = content;
  if (format === "base64") {
    const decoded = tryDecodeBase64(content);
    if (decoded === null) return [];
    text = decoded;
  }
  const matches = extractConfigURIs(text);
  if (!matches) return [];
  const seen = new Set<string>();
  const results: string[] = [];
  for (const match of matches) {
    let cleaned = match;
    // Remove trailing punctuation
    const lastChar = cleaned.charAt(cleaned.length - 1);
    if (")".includes(lastChar) || ",".includes(lastChar) || ".".includes(lastChar) ||
        ";".includes(lastChar) || ":".includes(lastChar) || "?".includes(lastChar) ||
        "!".includes(lastChar)) {
      cleaned = cleaned.slice(0, -1);
    }
    const norm = cleaned.trim().toLowerCase();
    if (!seen.has(norm) && cleaned.length > 10) { seen.add(norm); results.push(cleaned.trim()); }
  }
  return results;
}

export async function fetchSingleSubscription(
  db: D1Database,
  sub: SourceRow,
  cancellation?: FetchCancellation,
  abortSignal?: AbortSignal
): Promise<SubscriptionProcessResult> {
  const chatId = sub.chat_id;
  const title = sub.title ?? sub.sub_url ?? "Sub #" + chatId;
  const prevStatus = sub.sub_status;
  if (cancellation?.isCancelled()) return { sourceChatId: chatId, title, success: false, configCount: 0, newCount: 0, duplicateCount: 0, format: "unknown", error: "Cancelled", cancelled: true, newConfigIds: [] };
  if (!sub.sub_url) return { sourceChatId: chatId, title, success: false, configCount: 0, newCount: 0, duplicateCount: 0, format: "unknown", error: "No URL", newConfigIds: [] };
  const fr = await fetchWithLimits(sub.sub_url, cancellation, abortSignal);  if (!fr.success || !fr.content) {
    if (cancellation?.isCancelled() || fr.error === "Cancelled") {
      return { sourceChatId: chatId, title, success: false, configCount: 0, newCount: 0, duplicateCount: 0, format: "unknown", error: "Cancelled", cancelled: true, newConfigIds: [] };
    }
    const fc = sub.consecutive_failures + 1;
    const ns = fc >= AUTO_DISABLE_THRESHOLD ? "inactive" : prevStatus;
    await updateSourceFetchResult(db, chatId, { status: ns, consecutive_failures: fc, last_fetch_status: "error", last_fetch_error: fr.error ?? "Unknown" });
    return { sourceChatId: chatId, title, success: false, configCount: 0, newCount: 0, duplicateCount: 0, format: "unknown", error: fr.error, newConfigIds: [] };
  }
  const format = detectFormat(fr.content);
  if (format === "unknown") {
    const fc = sub.consecutive_failures + 1;
    const ns = fc >= AUTO_DISABLE_THRESHOLD ? "inactive" : prevStatus;
    await updateSourceFetchResult(db, chatId, { status: ns, consecutive_failures: fc, last_fetch_status: "error", last_fetch_error: "Unrecognized format", sub_type: "unknown" });
    return { sourceChatId: chatId, title, success: false, configCount: 0, newCount: 0, duplicateCount: 0, format: "unknown", error: "Unrecognized format", newConfigIds: [] };
  }
  const raw = extractConfigs(fr.content, format);
  if (raw.length === 0) {
    const fc = sub.consecutive_failures + 1;
    const ns = fc >= AUTO_DISABLE_THRESHOLD ? "inactive" : prevStatus;
    await updateSourceFetchResult(db, chatId, { status: ns, consecutive_failures: fc, last_fetch_status: "success", last_config_count: 0, sub_type: format });
    return { sourceChatId: chatId, title, success: false, configCount: 0, newCount: 0, duplicateCount: 0, format, error: "No configs", newConfigIds: [] };
  }
  const limited = raw.slice(0, MAX_CONFIGS_PER_SUB);
  const batch = await createBatch({ db, sourceType: "subscription", sourceChatId: chatId, operator: "unknown" });
  try {
    const nl = String.fromCharCode(10);
    const result = await runPipeline(limited.join(nl), { db, batchId: batch.batchId, sourceType: "subscription", sourceChatId: chatId });
    await completeBatchRun(db, batch.collectionRunId, result);
    await updateSourceFetchResult(db, chatId, { status: "active", consecutive_failures: 0, last_fetch_status: "success", last_config_count: limited.length, sub_type: format });
    const newConfigIds = result.configs
      .filter((c) => c.isNew && c.configId !== null)
      .map((c) => c.configId as number);
    return { sourceChatId: chatId, title, success: true, configCount: limited.length, newCount: result.newCount, duplicateCount: result.duplicateCount, format, newConfigIds };
  } catch (e) {
    await failBatchRun(db, batch.collectionRunId, "Pipeline error");
    await updateSourceFetchResult(db, chatId, { last_fetch_status: "error", last_fetch_error: "Pipeline error", sub_type: format });
    return { sourceChatId: chatId, title, success: false, configCount: limited.length, newCount: 0, duplicateCount: 0, format, error: "Pipeline error", newConfigIds: [] };
  }
}

export async function fetchAllSubscriptions(
  db: D1Database,
  api?: TelegramBotAPI,
  instrumentation?: FetchInstrumentation,
  cancellation?: FetchCancellation
): Promise<FetchAllResult> {
  const cycleStartedAt = Date.now();
  const cycleLog = (event: string, details = "") => {
    if (instrumentation) {
      console.log(event + " flow_id=" + instrumentation.flowId + (details ? " " + details : ""));
    }
  };
  cycleLog("FETCH_CYCLE_STARTED");  const subs = await getEnabledSubscriptions(db);
  cycleLog("SUBSCRIPTIONS_LOADED", "count=" + subs.length);
  let sc = 0, fc = 0, sk = 0;
  let cancelled = cancellation?.isCancelled() ?? false;
  const errors: string[] = [];
  const newConfigIds: number[] = [];  const toProcess = subs.slice(0, MAX_SUBS_PER_CYCLE);
  for (const sub of toProcess) {
    if (cancellation?.isCancelled()) {
      cancelled = true;
      break;
    }
    if (!shouldFetch(sub)) { sk++; continue; }
    const r = await fetchSingleSubscription(db, sub, cancellation, instrumentation?.abortSignal);
    if (r.cancelled || cancellation?.isCancelled()) {
      cancelled = true;
      break;
    }
    if (r.success) {
      sc++;
      newConfigIds.push(...r.newConfigIds);
    } else {
      fc++;
      if (r.error) errors.push((r.title ?? "Sub") + ": " + r.error);
    }
  }
  cycleLog("FETCH_CYCLE_FINISHED", "duration_ms=" + (Date.now() - cycleStartedAt) + " total=" + (sc + fc + sk) + " success_count=" + sc + " fail_count=" + fc + " skip_count=" + sk + " cancelled=" + cancelled);

  // Auto-publish newly collected configs to the output channel when an
  // API client is available (manual /send no longer required).
  let published: AutoPublishResult | undefined;
  if (api && newConfigIds.length > 0) {
    try {
      published = await autoPublishConfigs(db, api, newConfigIds);
      if (published.published) {
        console.log("[subscription] auto-published new configs: sent=" + published.sentCount + " total=" + published.totalCount);
      }
    } catch (e) {
      console.error("[subscription] auto-publish failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return { totalProcessed: sc + fc + sk, successCount: sc, failCount: fc, skipCount: sk, cancelled, errors, published };}

function shouldFetch(sub: SourceRow): boolean {
  if (!sub.last_fetched_at) return true;
  const last = new Date(sub.last_fetched_at).getTime();
  const interval = sub.fetch_interval_hours * 60 * 60 * 1000;
  return Date.now() - last >= interval;
}

export function isActiveSubscription(sub: SourceRow): boolean {
  return sub.sub_status === "active";
}
