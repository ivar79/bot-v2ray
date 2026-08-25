/**
 * Subscription Fetcher - MVP
 * Fetches V2Ray configs from subscription URLs.
 * Supports plain text and base64 subscriptions.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { SourceRow } from "../db/connection";
import { getEnabledSubscriptions, updateSourceFetchResult } from "../db/sources";
import { createBatch, completeBatchRun, failBatchRun } from "./batch";
import { runPipeline } from "./pipeline";

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
}

export interface FetchAllResult {
  totalProcessed: number;
  successCount: number;
  failCount: number;
  skipCount: number;
}

export async function fetchWithLimits(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
    if (e instanceof Error && e.name === "AbortError") return { success: false, error: "Timeout (20s)" };
    return { success: false, error: e instanceof Error ? e.message : "Unknown" };
  } finally { clearTimeout(timeoutId); }
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
  try {
    let b64 = trimmed;
    const pad = b64.length % 4;
    if (pad === 2) b64 += "==";
    else if (pad === 3) b64 += "=";
    const decoded = atob(b64);
    if (decoded && hasProtocolURIs(decoded)) return "base64";
  } catch { /* not base64 */ }
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
    try {
      let b64 = content.trim();
      const pad = b64.length % 4;
      if (pad === 2) b64 += "==";
      else if (pad === 3) b64 += "=";
      const decoded = atob(b64);
      if (decoded) text = decoded;
    } catch { return []; }
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

export async function fetchSingleSubscription(db: D1Database, sub: SourceRow): Promise<SubscriptionProcessResult> {
  const chatId = sub.chat_id;
  const title = sub.title ?? sub.sub_url ?? "Sub #" + chatId;
  const prevStatus = sub.sub_status;
  if (!sub.sub_url) return { sourceChatId: chatId, title, success: false, configCount: 0, newCount: 0, duplicateCount: 0, format: "unknown", error: "No URL" };
  const fr = await fetchWithLimits(sub.sub_url);
  if (!fr.success || !fr.content) {
    const fc = sub.consecutive_failures + 1;
    const ns = fc >= AUTO_DISABLE_THRESHOLD ? "inactive" : prevStatus;
    await updateSourceFetchResult(db, chatId, { status: ns, consecutive_failures: fc, last_fetch_status: "error", last_fetch_error: fr.error ?? "Unknown" });
    return { sourceChatId: chatId, title, success: false, configCount: 0, newCount: 0, duplicateCount: 0, format: "unknown", error: fr.error };
  }
  const format = detectFormat(fr.content);
  if (format === "unknown") {
    const fc = sub.consecutive_failures + 1;
    const ns = fc >= AUTO_DISABLE_THRESHOLD ? "inactive" : prevStatus;
    await updateSourceFetchResult(db, chatId, { status: ns, consecutive_failures: fc, last_fetch_status: "error", last_fetch_error: "Unrecognized format", sub_type: "unknown" });
    return { sourceChatId: chatId, title, success: false, configCount: 0, newCount: 0, duplicateCount: 0, format: "unknown", error: "Unrecognized format" };
  }
  const raw = extractConfigs(fr.content, format);
  if (raw.length === 0) {
    const fc = sub.consecutive_failures + 1;
    const ns = fc >= AUTO_DISABLE_THRESHOLD ? "inactive" : prevStatus;
    await updateSourceFetchResult(db, chatId, { status: ns, consecutive_failures: fc, last_fetch_status: "success", last_config_count: 0, sub_type: format });
    return { sourceChatId: chatId, title, success: false, configCount: 0, newCount: 0, duplicateCount: 0, format, error: "No configs" };
  }
  const limited = raw.slice(0, MAX_CONFIGS_PER_SUB);
  const batch = await createBatch({ db, sourceType: "subscription", sourceChatId: chatId, operator: "unknown" });
  try {
    const nl = String.fromCharCode(10);
    const result = await runPipeline(limited.join(nl), { db, batchId: batch.batchId, sourceType: "subscription", sourceChatId: chatId });
    await completeBatchRun(db, batch.collectionRunId, result);
    await updateSourceFetchResult(db, chatId, { status: "active", consecutive_failures: 0, last_fetch_status: "success", last_config_count: limited.length, sub_type: format });
    return { sourceChatId: chatId, title, success: true, configCount: limited.length, newCount: result.newCount, duplicateCount: result.duplicateCount, format };
  } catch (e) {
    await failBatchRun(db, batch.collectionRunId, "Pipeline error");
    await updateSourceFetchResult(db, chatId, { last_fetch_status: "error", last_fetch_error: "Pipeline error", sub_type: format });
    return { sourceChatId: chatId, title, success: false, configCount: limited.length, newCount: 0, duplicateCount: 0, format, error: "Pipeline error" };
  }
}

export async function fetchAllSubscriptions(db: D1Database): Promise<FetchAllResult> {
  const subs = await getEnabledSubscriptions(db);
  let sc = 0, fc = 0, sk = 0;
  const toProcess = subs.slice(0, MAX_SUBS_PER_CYCLE);
  for (const sub of toProcess) {
    if (!shouldFetch(sub)) { sk++; continue; }
    const r = await fetchSingleSubscription(db, sub);
    if (r.success) sc++; else fc++;
  }
  return { totalProcessed: toProcess.length, successCount: sc, failCount: fc, skipCount: sk };
}

function shouldFetch(sub: SourceRow): boolean {
  if (!sub.last_fetched_at) return true;
  const last = new Date(sub.last_fetched_at).getTime();
  const interval = sub.fetch_interval_hours * 60 * 60 * 1000;
  return Date.now() - last >= interval;
}

export function isActiveSubscription(sub: SourceRow): boolean {
  return sub.sub_status === "active";
}
