import { describe, it, expect } from "vitest";
import worker from "../src/index";

// Mock environment for testing
const mockEnv = {
  DB: {} as D1Database,
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  GITHUB_TOKEN: "test-github-token",
  ADMIN_USER_IDS: "123456789",
};

describe("Worker Health Check", () => {
  it("GET / returns 200 with health status", async () => {
    const request = new Request("http://localhost:8787/", {
      method: "GET",
    });

    const response = await worker.fetch(request, mockEnv, {} as ExecutionContext);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("v2ray-aggregator");
    expect(body.version).toBe("0.1.0");
    expect(body.time).toBeDefined();
  });

  it("POST / returns 404", async () => {
    const request = new Request("http://localhost:8787/", {
      method: "POST",
    });

    const response = await worker.fetch(request, mockEnv, {} as ExecutionContext);
    expect(response.status).toBe(404);
  });

  it("GET /unknown returns 404", async () => {
    const request = new Request("http://localhost:8787/unknown", {
      method: "GET",
    });

    const response = await worker.fetch(request, mockEnv, {} as ExecutionContext);
    expect(response.status).toBe(404);
  });

  it("POST /webhook without secret returns 403", async () => {
    const request = new Request("http://localhost:8787/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    });

    const response = await worker.fetch(request, mockEnv, {} as ExecutionContext);
    expect(response.status).toBe(403);
  });

  it("POST /webhook with wrong secret returns 403", async () => {
    const request = new Request("http://localhost:8787/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Secret-Token": "wrong-secret",
      },
      body: JSON.stringify({ update_id: 1 }),
    });

    const response = await worker.fetch(request, mockEnv, {} as ExecutionContext);
    expect(response.status).toBe(403);
  });
});
