/**
 * Tests — Webhook Handler
 *
 * Tests webhook secret verification, idempotency, Update parsing,
 * and error handling.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { handleWebhookRequest } from "../../src/telegram/webhook";
import type { TgUpdate } from "../../src/telegram/types";
import { MockTelegramBotAPI } from "../../src/telegram/api";

function makeEnv(db: D1Database, overrides: Record<string, string> = {}) {
  return {
    DB: db,
    TELEGRAM_BOT_TOKEN: "test-bot-token",
    TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
    ADMIN_USER_IDS: "111111,222222",
    ...overrides,
  };
}

/** Shared mock API for all webhook tests to avoid real HTTP calls. */
let mockApi: MockTelegramBotAPI;

function getMockApi(): MockTelegramBotAPI {
  mockApi = new MockTelegramBotAPI();
  return mockApi;
}

function makeUpdate(updateId: number, extra: Partial<TgUpdate> = {}): TgUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      from: { id: 111111, is_bot: false, first_name: "Admin" },
      date: Date.now(),
      chat: { id: 111111, type: "private" },
      text: "/start",
    },
    ...extra,
  };
}

function makeRequest(
  body: TgUpdate,
  secretToken: string = "test-webhook-secret"
): Request {
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": secretToken,
    },
    body: JSON.stringify(body),
  });
}

describe("Webhook Handler", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDB();
  });

  describe("Secret Token Verification", () => {
    it("should accept valid secret token", async () => {
      const update = makeUpdate(1001);
      const request = makeRequest(update);
      const response = await handleWebhookRequest(request, makeEnv(db), getMockApi());

      expect(response.status).toBe(200);
    });

    it("should reject invalid secret token", async () => {
      const update = makeUpdate(1001);
      const request = makeRequest(update, "wrong-secret");
      const response = await handleWebhookRequest(request, makeEnv(db));

      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text).toContain("Invalid webhook secret");
    });

    it("should reject missing secret token header", async () => {
      const update = makeUpdate(1001);
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const response = await handleWebhookRequest(request, makeEnv(db));

      expect(response.status).toBe(403);
    });

    it("should not expose internal details in error messages", async () => {
      const update = makeUpdate(1001);
      const request = makeRequest(update, "wrong");
      const response = await handleWebhookRequest(request, makeEnv(db));

      const text = await response.text();
      expect(text).not.toContain("stack");
      expect(text).not.toContain("Error");
      expect(text).not.toContain("token");
    });
  });

  describe("Update Parsing", () => {
    it("should reject invalid JSON body", async () => {
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": "test-webhook-secret",
        },
        body: "not json!!!",
      });
      const response = await handleWebhookRequest(request, makeEnv(db));

      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain("Invalid JSON");
    });

    it("should reject update without update_id", async () => {
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": "test-webhook-secret",
        },
        body: JSON.stringify({ message: {} }),
      });
      const response = await handleWebhookRequest(request, makeEnv(db));

      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain("Invalid update structure");
    });

    it("should handle empty body", async () => {
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": "test-webhook-secret",
        },
        body: "",
      });
      const response = await handleWebhookRequest(request, makeEnv(db));

      expect(response.status).toBe(400);
    });
  });

  describe("Idempotency", () => {
    it("should process update only once", async () => {
      const update = makeUpdate(2001);
      const api = getMockApi();

      // First delivery — should process and return 200
      const response1 = await handleWebhookRequest(
        makeRequest(update),
        makeEnv(db),
        api
      );
      expect(response1.status).toBe(200);

      // Second delivery — should return 200 without reprocessing
      const response2 = await handleWebhookRequest(
        makeRequest(update),
        makeEnv(db),
        api
      );
      expect(response2.status).toBe(200);

      // Verify the update was recorded
      const { isUpdateProcessed } = await import(
        "../../src/db/updates"
      );
      expect(await isUpdateProcessed(db, 2001)).toBe(true);
    });

    it("should process different updates independently", async () => {
      const update1 = makeUpdate(3001);
      const update2 = makeUpdate(3002);
      const api = getMockApi();

      const response1 = await handleWebhookRequest(
        makeRequest(update1),
        makeEnv(db),
        api
      );
      const response2 = await handleWebhookRequest(
        makeRequest(update2),
        makeEnv(db),
        api
      );

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      const { isUpdateProcessed } = await import(
        "../../src/db/updates"
      );
      expect(await isUpdateProcessed(db, 3001)).toBe(true);
      expect(await isUpdateProcessed(db, 3002)).toBe(true);
    });

    it("should reject a retry while the first delivery is still processing", async () => {
      const update = makeUpdate(5001);
      const api = getMockApi();
      const originalSend = api.sendMessage.bind(api);
      let sendCount = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      api.sendMessage = async (params) => {
        sendCount++;
        await gate;
        return originalSend(params);
      };

      // First delivery starts processing and blocks inside sendMessage
      const first = handleWebhookRequest(makeRequest(update), makeEnv(db), api);

      // Wait until the first delivery has entered routing — by then the
      // update is already claimed, so a duplicate must be rejected
      for (let i = 0; i < 100 && sendCount === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(sendCount).toBe(1);

      // Telegram retries the same update while the first is still running
      const second = await handleWebhookRequest(makeRequest(update), makeEnv(db), api);
      expect(second.status).toBe(200);
      expect(sendCount).toBe(1); // must not re-execute the handler

      // Release the first delivery and let it finish
      release();
      const firstResponse = await first;
      expect(firstResponse.status).toBe(200);
      expect(sendCount).toBe(1);
    });

    it("should acknowledge immediately and process in the background when ctx is provided", async () => {
      const update = makeUpdate(6001);
      const api = getMockApi();
      const tasks: Promise<unknown>[] = [];
      const fakeCtx = {
        waitUntil: (p: Promise<unknown>) => { tasks.push(p); },
      } as unknown as ExecutionContext;

      const response = await handleWebhookRequest(makeRequest(update), makeEnv(db), api, fakeCtx);

      // Webhook answers 200 right away; the update is routed in the background
      expect(response.status).toBe(200);
      expect(tasks.length).toBe(1);

      await tasks[0];
      expect(api.sendMessageCalls.length).toBeGreaterThan(0);
    });
  });

  describe("Update Routing", () => {
    it("should route message updates", async () => {
      const update: TgUpdate = {
        update_id: 4001,
        message: {
          message_id: 1,
          from: { id: 111111, is_bot: false, first_name: "Admin" },
          date: Date.now(),
          chat: { id: 111111, type: "private" },
          text: "/start",
        },
      };
      const api = getMockApi();

      const response = await handleWebhookRequest(
        makeRequest(update),
        makeEnv(db),
        api
      );
      expect(response.status).toBe(200);
    });

    it("should route channel_post updates", async () => {
      const update: TgUpdate = {
        update_id: 4002,
        channel_post: {
          message_id: 1,
          date: Date.now(),
          chat: { id: -100123456, type: "channel", title: "Test" },
          text: "Some channel post",
        },
      };
      const api = getMockApi();

      const response = await handleWebhookRequest(
        makeRequest(update),
        makeEnv(db),
        api
      );
      expect(response.status).toBe(200);
    });

    it("should route callback_query updates", async () => {
      const update: TgUpdate = {
        update_id: 4003,
        callback_query: {
          id: "cb123",
          from: { id: 111111, is_bot: false, first_name: "Admin" },
          data: "operator:irancell",
        },
      };
      const api = getMockApi();

      const response = await handleWebhookRequest(
        makeRequest(update),
        makeEnv(db),
        api
      );
      expect(response.status).toBe(200);
    });

    it("should silently ignore unsupported update types", async () => {
      const update: TgUpdate = {
        update_id: 4004,
        // No message, channel_post, or callback_query
        inline_query: { id: "iq1", from: { id: 1, is_bot: false, first_name: "Test" }, query: "" },
      };
      const api = getMockApi();

      const response = await handleWebhookRequest(
        makeRequest(update),
        makeEnv(db),
        api
      );
      expect(response.status).toBe(200);
    });
  });

  describe("Error Handling", () => {
    it("should not expose internal errors to Telegram", async () => {
      // Send a valid update — should never expose stack traces
      const update = makeUpdate(5001);
      const api = getMockApi();
      const response = await handleWebhookRequest(
        makeRequest(update),
        makeEnv(db),
        api
      );

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain("stack");
      expect(text).not.toContain("Error");
    });

    it("should return 200 even for processing errors (prevent retries)", async () => {
      // Send an update with a valid structure but no handler
      const update: TgUpdate = { update_id: 5002 };
      const api = getMockApi();
      const response = await handleWebhookRequest(
        makeRequest(update),
        makeEnv(db),
        api
      );

      // Should still return 200 to prevent Telegram from retrying
      expect(response.status).toBe(200);
    });
  });

  describe("Payload Size Limits", () => {
    it("should accept normal-sized payloads", async () => {
      const update = makeUpdate(6001);
      const api = getMockApi();
      const response = await handleWebhookRequest(
        makeRequest(update),
        makeEnv(db),
        api
      );
      expect(response.status).toBe(200);
    });
  });
});
