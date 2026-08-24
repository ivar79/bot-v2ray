/**
 * V2Ray Aggregator — Cloudflare Worker Entry Point
 *
 * This is the main entry point for the V2Ray Aggregator Worker.
 * It handles incoming HTTP requests and routes them to the appropriate handler.
 */

import { handleWebhookRequest } from "./telegram/webhook";

export interface Env {
  // D1 Database binding
  DB: D1Database;

  // Secrets (configured via wrangler secret put)
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
  ADMIN_USER_IDS: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "v2ray-aggregator",
          version: "0.1.0",
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Telegram webhook endpoint
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhookRequest(request, env);
    }

    // 404 for all other routes
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    // Periodic cleanup: remove processed_updates older than 90 days
    // Prevents unbounded table growth
    try {
      const { cleanupOldUpdates } = await import("./db/updates");
      const deleted = await cleanupOldUpdates(env.DB, 90);
      if (deleted > 0) {
        console.log(`Cleaned up ${deleted} old processed update records`);
      }
    } catch (err) {
      console.error(
        "Scheduled cleanup failed:",
        err instanceof Error ? err.message : "Unknown error"
      );
    }
  },
};
