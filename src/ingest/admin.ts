/**
 * Admin Upload Orchestration
 *
 * Handles the full admin upload workflow:
 * 1. Admin sends text or document with configs
 * 2. Bot stores configs temporarily in admin_states
 * 3. Bot asks for operator selection via inline keyboard
 * 4. Admin selects operator
 * 5. Bot creates batch, runs pipeline, sends summary
 *
 * Uses admin_states for multi-step conversation flow.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { TelegramBotAPI } from "../telegram/api";
import type { TgMessage } from "../telegram/types";
import { getMessageText } from "../telegram/types";
import { isAdmin } from "../telegram/auth";
import {
  getAdminState,
  setAdminState,
  clearAdminState,
} from "../db/admin-states";
import { createBatch, setBatchOperator, completeBatchRun } from "./batch";
import { runPipeline, formatPipelineSummary } from "./pipeline";
import type { PipelineResult } from "./pipeline";
import { VALID_OPERATORS } from "../db/connection";

// ─── Maximum Document Size ─────────────────────────────────

/** Maximum file size for Telegram Bot API document download (20 MB). */
const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;

// ─── Admin State Names ─────────────────────────────────────

/** State: admin has sent configs, waiting for operator selection. */
const STATE_AWAITING_OPERATOR = "awaiting_operator";

/** Context keys for admin_states. */
const CTX_KEY_CONFIGS = "pending_configs";
const CTX_KEY_BATCH_ID = "batch_id";
const CTX_KEY_COLLECTION_RUN_ID = "collection_run_id";

// ─── Operator Selection Keyboard ───────────────────────────

/** Build the operator selection inline keyboard. */
function buildOperatorKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🇮🇷 Irancell", callback_data: "op:irancell" },
        { text: "📱 MCI", callback_data: "op:mci" },
      ],
      [
        { text: "📡 Rightel", callback_data: "op:rightel" },
        { text: "☎️ Mokhaberat", callback_data: "op:mokhaberat" },
      ],
      [
        { text: "🌐 Other", callback_data: "op:other" },
        { text: "❓ Unknown", callback_data: "op:unknown" },
      ],
    ],
  };
}

// ─── Text Upload Handler ───────────────────────────────────

/**
 * Handle a text message containing V2Ray configs.
 *
 * Flow:
 * 1. Check admin authorization
 * 2. Extract configs from text
 * 3. If no configs found → inform admin
 * 4. Store configs in admin_states temporarily
 * 5. Send operator selection keyboard
 */
export async function handleTextUpload(
  message: TgMessage,
  db: D1Database,
  api: TelegramBotAPI,
  adminUserIds: string
): Promise<void> {
  const chatId = message.chat.id;
  const userId = message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  const text = getMessageText(message);
  if (!text) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ No text content found. Please send V2Ray configuration links.",
    });
    return;
  }

  // Check if there are configs in the text
  const configPattern =
    /(?:vmess|vless|trojan|ss|hysteria2|hy2|hysteria):\/\//gi;
  if (!configPattern.test(text)) {
    await api.sendMessage({
      chat_id: chatId,
      text: [
        "⚠️ No supported configuration links found in your message.",
        "",
        "Supported formats:",
        "• vmess://...",
        "• vless://...",
        "• trojan://...",
        "• ss://...",
        "• hysteria2:// or hy2://...",
        "• hysteria://...",
      ].join("\n"),
    });
    return;
  }

  // Create batch (without operator yet — will be set after selection)
  const batch = await createBatch({
    db,
    sourceType: "admin",
    sourceChatId: chatId,
    sourceMessageId: message.message_id,
    verifiedBy: userId,
  });

  // Store configs temporarily in admin_states
  await setAdminState(db, userId, STATE_AWAITING_OPERATOR, {
    [CTX_KEY_CONFIGS]: text,
    [CTX_KEY_BATCH_ID]: batch.batchId,
    [CTX_KEY_COLLECTION_RUN_ID]: batch.collectionRunId,
  });

  // Send operator selection keyboard
  await api.sendMessage({
    chat_id: chatId,
    text: [
      "📥 <b>Configs received!</b>",
      "",
      "Please select the operator for this batch:",
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: buildOperatorKeyboard(),
  });
}

// ─── Document Upload Handler ───────────────────────────────

/**
 * Handle a document (file) upload containing V2Ray configs.
 *
 * Flow:
 * 1. Check admin authorization
 * 2. Validate file size and type
 * 3. Download file content via Telegram API
 * 4. Process same as text upload
 */
export async function handleDocumentUpload(
  message: TgMessage,
  db: D1Database,
  api: TelegramBotAPI,
  adminUserIds: string
): Promise<void> {
  const chatId = message.chat.id;
  const userId = message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  const doc = message.document;
  if (!doc) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ No document found in the message.",
    });
    return;
  }

  // Check file size
  if (doc.file_size && doc.file_size > MAX_DOCUMENT_SIZE) {
    await api.sendMessage({
      chat_id: chatId,
      text: [
        "⚠️ File is too large for Telegram Bot API processing.",
        `File size: ${(doc.file_size / 1024 / 1024).toFixed(1)} MB`,
        "Maximum supported: 20 MB",
        "",
        "Please split the file into smaller batches.",
      ].join("\n"),
    });
    return;
  }

  // Get file info from Telegram
  const fileInfo = await api.getFile(doc.file_id);
  if (!fileInfo) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Failed to retrieve file from Telegram. Please try again.",
    });
    return;
  }

  // Download file content
  const content = await api.downloadFile(fileInfo.file_path);
  if (content === null) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Failed to download file content. Please try again.",
    });
    return;
  }

  // Check if there are configs in the file
  const configPattern =
    /(?:vmess|vless|trojan|ss|hysteria2|hy2|hysteria):\/\//gi;
  if (!configPattern.test(content)) {
    await api.sendMessage({
      chat_id: chatId,
      text: [
        "⚠️ No supported configuration links found in the file.",
        "",
        "Supported formats: vmess, vless, trojan, ss, hysteria2, hy2, hysteria",
      ].join("\n"),
    });
    return;
  }

  // Create batch
  const batch = await createBatch({
    db,
    sourceType: "admin",
    sourceChatId: chatId,
    sourceMessageId: message.message_id,
    verifiedBy: userId,
  });

  // Store configs temporarily in admin_states
  await setAdminState(db, userId, STATE_AWAITING_OPERATOR, {
    [CTX_KEY_CONFIGS]: content,
    [CTX_KEY_BATCH_ID]: batch.batchId,
    [CTX_KEY_COLLECTION_RUN_ID]: batch.collectionRunId,
  });

  // Send operator selection keyboard
  await api.sendMessage({
    chat_id: chatId,
    text: [
      "📥 <b>File received!</b>",
      `📄 ${doc.file_name ?? "configs.txt"}`,
      "",
      "Please select the operator for this batch:",
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: buildOperatorKeyboard(),
  });
}

// ─── Operator Selection Handler ────────────────────────────

/**
 * Handle operator selection callback from inline keyboard.
 *
 * Flow:
 * 1. Validate the operator value
 * 2. Retrieve pending configs from admin_states
 * 3. Set operator on the batch
 * 4. Run the ingestion pipeline
 * 5. Send summary to admin
 * 6. Clear admin state
 */
export async function handleOperatorSelection(
  callbackQueryId: string,
  operator: string,
  userId: number,
  chatId: number,
  db: D1Database,
  api: TelegramBotAPI,
  adminUserIds?: string
): Promise<void> {
  // Validate admin authorization (defense-in-depth)
  if (!isAdmin(userId, adminUserIds)) {
    await api.answerCallbackQuery({
      callback_query_id: callbackQueryId,
      text: "Access denied.",
      show_alert: true,
    });
    return;
  }

  // Validate operator
  if (!VALID_OPERATORS.includes(operator as typeof VALID_OPERATORS[number])) {
    await api.answerCallbackQuery({
      callback_query_id: callbackQueryId,
      text: "Invalid operator selection.",
      show_alert: true,
    });
    return;
  }

  // Get pending state
  const state = await getAdminState(db, userId);
  if (!state || state.state !== STATE_AWAITING_OPERATOR) {
    await api.answerCallbackQuery({
      callback_query_id: callbackQueryId,
      text: "No pending upload found. Please send configs first.",
      show_alert: true,
    });
    return;
  }

  // Parse context
  let context: Record<string, unknown>;
  try {
    context = JSON.parse(state.context ?? "{}") as Record<string, unknown>;
  } catch {
    await api.answerCallbackQuery({
      callback_query_id: callbackQueryId,
      text: "Error reading upload data. Please try again.",
      show_alert: true,
    });
    await clearAdminState(db, userId);
    return;
  }

  const pendingConfigs = context[CTX_KEY_CONFIGS] as string | undefined;
  const batchId = context[CTX_KEY_BATCH_ID] as number | undefined;
  const collectionRunId = context[CTX_KEY_COLLECTION_RUN_ID] as
    | number
    | undefined;

  if (!pendingConfigs || batchId === undefined || collectionRunId === undefined) {
    await api.answerCallbackQuery({
      callback_query_id: callbackQueryId,
      text: "Upload data expired or invalid. Please send configs again.",
      show_alert: true,
    });
    await clearAdminState(db, userId);
    return;
  }

  // Acknowledge the callback
  await api.answerCallbackQuery({
    callback_query_id: callbackQueryId,
    text: `Processing with operator: ${operator}`,
  });

  // Set operator on the batch
  await setBatchOperator(db, batchId, operator, userId);

  // Run the pipeline
  try {
    const result = await runPipeline(pendingConfigs, {
      db,
      batchId,
      sourceType: "admin",
      sourceChatId: chatId,
    });

    // Complete the collection run
    await completeBatchRun(db, collectionRunId, result);

    // Send summary
    const summary = formatPipelineSummary(result);
    await api.sendMessage({
      chat_id: chatId,
      text: [
        summary,
        "",
        `Operator: <b>${operator}</b>`,
        "Verification: Admin supplied",
      ].join("\n"),
      parse_mode: "HTML",
    });
  } catch {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Error processing configs. Please try again.",
    });
  } finally {
    // Always clear the state
    await clearAdminState(db, userId);
  }
}

// ─── Cancel Handler ────────────────────────────────────────

/**
 * Handle cancel during operator selection.
 * Admin can send /cancel to abort the upload.
 */
export async function handleCancel(
  userId: number,
  chatId: number,
  db: D1Database,
  api: TelegramBotAPI
): Promise<void> {
  const state = await getAdminState(db, userId);
  if (state?.state === STATE_AWAITING_OPERATOR) {
    await clearAdminState(db, userId);
    await api.sendMessage({
      chat_id: chatId,
      text: "❌ Upload cancelled.",
    });
  }
}
