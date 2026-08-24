/**
 * Telegram Bot API Abstraction
 *
 * Provides a mockable interface for Telegram Bot API calls.
 * In production, this makes real HTTP requests to api.telegram.org.
 * In tests, this can be replaced with a mock implementation.
 *
 * Reference: https://core.telegram.org/bots/api
 */

import type {
  SendMessageParams,
  AnswerCallbackQueryParams,
  SendDocumentParams,
} from "./types";

// ─── Interface ─────────────────────────────────────────────

/**
 * Telegram Bot API client interface.
 * Implementations must be injectable for testing.
 */
/** Response from Telegram's getFile API. */
export interface TgFileResult {
  file_id: string;
  file_unique_id: string;
  file_size: number;
  file_path: string;
}

export interface TelegramBotAPI {
  /** Send a text message. */
  sendMessage(params: SendMessageParams): Promise<boolean>;

  /** Send a document (file) to a chat. */
  sendDocument(params: SendDocumentParams): Promise<boolean>;

  /** Answer a callback query (dismiss the loading indicator). */
  answerCallbackQuery(params: AnswerCallbackQueryParams): Promise<boolean>;

  /** Get file info from Telegram (for document downloads). */
  getFile(fileId: string): Promise<TgFileResult | null>;

  /** Download a file from Telegram's file server. */
  downloadFile(filePath: string): Promise<string | null>;
}

// ─── File Path Validation ───────────────

/**
 * Validate a Telegram file path to prevent path traversal.
 *
 * Telegram getFile returns paths like documents/file_123.txt.
 * This validation ensures the path is safe before URL construction.
 *
 * Security rules:
 * - No path traversal (..)
 * - No absolute paths (starting with /)
 * - No null bytes
 * - Only allowed characters: alphanumeric, underscore, hyphen, dot, slash
 * - Reasonable length limit
 */
export function isValidTelegramFilePath(filePath: string): boolean {
  if (!filePath || filePath.length > 200) return false;
  if (filePath.includes("..") || filePath.startsWith("/")) return false;
  if (filePath.indexOf("\0") !== -1) return false;
  if (!/^[a-zA-Z0-9_\.\/-]+$/.test(filePath)) return false;
  return true;
}

// ─── Production Implementation ─────────────────────────────

/** Telegram Bot API base URL. */
const TELEGRAM_API_BASE = "https://api.telegram.org";

/** Maximum text message length for Telegram. */
const MAX_MESSAGE_LENGTH = 4096;

/**
 * Production Telegram Bot API client.
 * Makes real HTTP requests to Telegram servers.
 */
export class RealTelegramBotAPI implements TelegramBotAPI {
  private botToken: string;

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  async sendMessage(params: SendMessageParams): Promise<boolean> {
    try {
      // Truncate if too long
      let text = params.text;
      if (text.length > MAX_MESSAGE_LENGTH) {
        text = text.slice(0, MAX_MESSAGE_LENGTH - 20) + "\n\n…(truncated)";
      }

      const body: Record<string, unknown> = {
        chat_id: params.chat_id,
        text,
      };
      if (params.parse_mode) body.parse_mode = params.parse_mode;
      if (params.reply_markup) body.reply_markup = params.reply_markup;

      const response = await fetch(
        `${TELEGRAM_API_BASE}/bot${this.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown");
        console.error("[api] sendMessage FAILED: status=" + response.status + " chatId=" + params.chat_id + " error=" + errorText.substring(0, 200));
      } else {
        console.log("[api] sendMessage OK: chatId=" + params.chat_id);
      }

      return response.ok;
    } catch (err) {
      console.error("[api] sendMessage EXCEPTION: chatId=" + params.chat_id + " error=" + err);
      return false;
    }
  }

  async sendDocument(params: SendDocumentParams): Promise<boolean> {
    try {
      const formData = new FormData();
      formData.append("chat_id", String(params.chat_id));

      // Handle string content (text as document) or Blob
      if (typeof params.document === "string") {
        const blob = new Blob([params.document], { type: "text/plain" });
        formData.append("document", blob, "config.txt");
      } else {
        formData.append("document", params.document);
      }

      if (params.caption) formData.append("caption", params.caption);
      if (params.parse_mode) formData.append("parse_mode", params.parse_mode);

      const response = await fetch(
        `${TELEGRAM_API_BASE}/bot${this.botToken}/sendDocument`,
        { method: "POST", body: formData }
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  async answerCallbackQuery(
    params: AnswerCallbackQueryParams
  ): Promise<boolean> {
    try {
      const body: Record<string, unknown> = {
        callback_query_id: params.callback_query_id,
      };
      if (params.text) body.text = params.text;
      if (params.show_alert) body.show_alert = params.show_alert;

      const response = await fetch(
        `${TELEGRAM_API_BASE}/bot${this.botToken}/answerCallbackQuery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  async getFile(fileId: string): Promise<TgFileResult | null> {
    try {
      const response = await fetch(
        `${TELEGRAM_API_BASE}/bot${this.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
      );
      if (!response.ok) return null;
      const data = (await response.json()) as { result?: TgFileResult };
      return data.result ?? null;
    } catch {
      return null;
    }
  }

  async downloadFile(filePath: string): Promise<string | null> {
    if (!isValidTelegramFilePath(filePath)) return null;
    try {
      const response = await fetch(
        `${TELEGRAM_API_BASE}/file/bot${this.botToken}/${filePath}`
      );
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  }
}

// ─── Mock Implementation ───────────────────────────────────

/**
 * Mock Telegram Bot API for testing.
 * Records all calls for assertion in tests.
 */
export class MockTelegramBotAPI implements TelegramBotAPI {
  public sendMessageCalls: SendMessageParams[] = [];
  public sendDocumentCalls: SendDocumentParams[] = [];
  public answerCallbackQueryCalls: AnswerCallbackQueryParams[] = [];

  /** If set, sendMessage will return this value. */
  public sendMessageResult = true;
  /** If set, sendDocument will return this value. */
  public sendDocumentResult = true;
  /** If set, answerCallbackQuery will return this value. */
  public answerCallbackQueryResult = true;

  /** Mock file results: fileId → TgFileResult */
  public fileResults: Map<string, TgFileResult> = new Map();
  /** Mock file contents: filePath → text content */
  public fileContents: Map<string, string> = new Map();

  async sendMessage(params: SendMessageParams): Promise<boolean> {
    this.sendMessageCalls.push(params);
    return this.sendMessageResult;
  }

  async sendDocument(params: SendDocumentParams): Promise<boolean> {
    this.sendDocumentCalls.push(params);
    return this.sendDocumentResult;
  }

  async answerCallbackQuery(
    params: AnswerCallbackQueryParams
  ): Promise<boolean> {
    this.answerCallbackQueryCalls.push(params);
    return this.answerCallbackQueryResult;
  }

  async getFile(fileId: string): Promise<TgFileResult | null> {
    return this.fileResults.get(fileId) ?? null;
  }

  async downloadFile(filePath: string): Promise<string | null> {
    return this.fileContents.get(filePath) ?? null;
  }

  /** Reset all recorded calls. */
  reset(): void {
    this.sendMessageCalls = [];
    this.sendDocumentCalls = [];
    this.answerCallbackQueryCalls = [];
    this.fileResults.clear();
    this.fileContents.clear();
  }
}

// ─── Factory ───────────────────────────────────────────────

/**
 * Create a Telegram Bot API client.
 * Uses the real implementation in production.
 * Use MockTelegramBotAPI directly in tests.
 */
export function createTelegramBotAPI(
  botToken: string
): TelegramBotAPI {
  return new RealTelegramBotAPI(botToken);
}
