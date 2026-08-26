import type { D1Database } from "@cloudflare/workers-types";

export interface FetchRunRow {
  flow_id: string;
  user_id: number;
  chat_id: number;
  status: "running" | "cancelled" | "completed" | "failed";
  cancel_requested: number;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

function nowISO(): string {
  return new Date().toISOString();
}

export async function createFetchRun(
  db: D1Database,
  flowId: string,
  userId: number,
  chatId: number
): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO fetch_runs
      (flow_id, user_id, chat_id, status, cancel_requested, started_at, updated_at)
     VALUES (?, ?, ?, 'running', 0, ?, ?)`
  ).bind(flowId, userId, chatId, nowISO(), nowISO()).run();
  return result.success;
}

export async function getFetchRun(
  db: D1Database,
  flowId: string
): Promise<FetchRunRow | null> {
  return await db.prepare(
    "SELECT * FROM fetch_runs WHERE flow_id = ?"
  ).bind(flowId).first<FetchRunRow>();
}

export async function getActiveFetchRun(
  db: D1Database,
  userId: number,
  chatId: number
): Promise<FetchRunRow | null> {
  return await db.prepare(
    "SELECT * FROM fetch_runs WHERE user_id = ? AND chat_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1"
  ).bind(userId, chatId).first<FetchRunRow>();
}

export async function requestFetchCancellation(
  db: D1Database,
  flowId: string,
  userId: number,
  chatId: number
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE fetch_runs
     SET cancel_requested = 1, updated_at = ?
     WHERE flow_id = ? AND user_id = ? AND chat_id = ? AND status = 'running'`
  ).bind(nowISO(), flowId, userId, chatId).run();
  return result.meta.changes > 0;
}

export async function isFetchCancellationRequested(
  db: D1Database,
  flowId: string
): Promise<boolean> {
  const row = await db.prepare(
    "SELECT cancel_requested FROM fetch_runs WHERE flow_id = ? AND status = 'running'"
  ).bind(flowId).first<{ cancel_requested: number }>();
  return row?.cancel_requested === 1;
}

export async function finishFetchRun(
  db: D1Database,
  flowId: string,
  status: "cancelled" | "completed" | "failed"
): Promise<void> {
  await db.prepare(
    `UPDATE fetch_runs
     SET status = ?, updated_at = ?, finished_at = ?
     WHERE flow_id = ? AND status = 'running'`
  ).bind(status, nowISO(), nowISO(), flowId).run();
}

export async function cleanupStaleFetchRuns(
  db: D1Database,
  maxAgeMinutes = 30
): Promise<number> {
  const result = await db.prepare(
    `UPDATE fetch_runs
     SET status = 'failed', updated_at = ?, finished_at = ?
     WHERE status = 'running'
       AND started_at < datetime('now', '-' || ? || ' minutes')`
  ).bind(nowISO(), nowISO(), maxAgeMinutes).run();
  return result.meta.changes;
}
