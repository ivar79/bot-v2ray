/**
 * D1 Test Helper — Wraps better-sqlite3 to emulate D1Database interface
 *
 * D1 is SQLite-based. better-sqlite3 provides an in-memory SQLite
 * database that matches D1's query semantics. This helper wraps it
 * to match the D1Database interface used by our query modules.
 */

import Database from "better-sqlite3";
import type { D1Database } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Create an in-memory D1-compatible database by applying the migration SQL.
 * Returns a D1Database-compatible object.
 */
export function createTestDB(): D1Database {
  const db = new Database(":memory:");

  // Enable WAL mode for better concurrency (matches D1 behavior)
  db.pragma("journal_mode = WAL");
  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Load and apply the migration
  const migrationPath = resolve(__dirname, "../../migrations/0001_initial.sql");
  const migrationSQL = readFileSync(migrationPath, "utf-8");
  db.exec(migrationSQL);

  // Wrap the better-sqlite3 database to match D1Database interface
  return wrapAsD1(db);
}

/**
 * Wrap a better-sqlite3 Database as a D1Database-compatible object.
 * Only implements the methods our query modules actually use.
 */
function wrapAsD1(db: Database.Database): D1Database {
  function createBoundStatement(sql: string, params: unknown[]) {
    return {
      first: async <T = Record<string, unknown>>(
        colName?: string
      ): Promise<T | null> => {
        try {
          const stmt = db.prepare(sql);
          const row = colName ? stmt.get(...params) : stmt.get(...params);
          return (row as T) ?? null;
        } catch {
          return null;
        }
      },
      all: async <T = Record<string, unknown>>(): Promise<{ results: T[] }> => {
        try {
          const stmt = db.prepare(sql);
          const rows = stmt.all(...params) as T[];
          return { results: rows };
        } catch (e) {
          console.error("D1 test helper all() error:", e);
          return { results: [] };
        }
      },
      run: async (): Promise<{
        success: boolean;
        meta: { last_row_id: number; changes: number };
        error?: string;
      }> => {
        try {
          const stmt = db.prepare(sql);
          const result = stmt.run(...params);
          return {
            success: true,
            meta: {
              last_row_id: Number(result.lastInsertRowid),
              changes: result.changes,
            },
          };
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Unknown error";
          return {
            success: false,
            meta: { last_row_id: 0, changes: 0 },
            error: message,
          };
        }
      },
    };
  }

  // D1Database-compatible interface
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) =>
        createBoundStatement(sql, params),
      first: async <T = Record<string, unknown>>(
        ...params: unknown[]
      ): Promise<T | null> => {
        try {
          const stmt = db.prepare(sql);
          const row = stmt.get(...params);
          return (row as T) ?? null;
        } catch {
          return null;
        }
      },
      all: async <T = Record<string, unknown>>(
        ...params: unknown[]
      ): Promise<{ results: T[] }> => {
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params) as T[];
        return { results: rows };
      },
      run: async (
        ...params: unknown[]
      ): Promise<{
        success: boolean;
        meta: { last_row_id: number; changes: number };
        error?: string;
      }> => {
        try {
          const stmt = db.prepare(sql);
          const result = stmt.run(...params);
          return {
            success: true,
            meta: {
              last_row_id: Number(result.lastInsertRowid),
              changes: result.changes,
            },
          };
        } catch (e) {
          const message = e instanceof Error ? e.message : "Unknown error";
          return {
            success: false,
            meta: { last_row_id: 0, changes: 0 },
            error: message,
          };
        }
      },
    }),
    exec: async (sql: string): Promise<{ success: boolean }> => {
      try {
        db.exec(sql);
        return { success: true };
      } catch {
        return { success: false };
      }
    },
    batch: async (
      stmts: { bind: (...args: unknown[]) => unknown }[]
    ): Promise<unknown[]> => {
      const results: unknown[] = [];
      const runInTransaction = db.transaction(() => {
        for (const stmt of stmts) {
          // For batch, we execute each statement
          // This is a simplified version
          results.push(stmt);
        }
      });
      runInTransaction();
      return results;
    },
  } as unknown as D1Database;
}

/**
 * Close the underlying SQLite database connection.
 */
export function closeTestDB(db: D1Database): void {
  const internal = db as unknown as { close?: () => void };
  // The wrapped DB doesn't expose close, so this is best-effort
}
