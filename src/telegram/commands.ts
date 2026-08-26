/**
 * Telegram Bot Command Handlers
 *
 * Implements the basic commands required for Phase 4 & 5:
 * /start — Welcome message and admin notification
 * /help — List available commands and usage
 * /status — System status information
 * /upload — Start config upload flow (Phase 5)
 * /cancel — Cancel pending upload (Phase 5)
 *
 * All commands are admin-only.
 * Non-admin users receive a polite denial message.
 */

import type { TelegramBotAPI } from "./api";
import type { TgMessage, TgInlineKeyboardButton } from "./types";
import { getMessageText } from "./types";
import { isAdmin } from "./auth";
import type { D1Database } from "@cloudflare/workers-types";
import { countConfigs } from "../db/configs";
import { countSources, getAllSources } from "../db/sources";
import { countBatches } from "../db/batches";
import { getAdminStateName, clearAdminState, setAdminState } from "../db/admin-states";
import { addTrustedSource, removeTrustedSource } from "../ingest/channel";
import { generateAllOutputs } from "../output/generator";
import { countActiveConfigs, countConfigsByProtocol, getActiveConfigs, getRecentActiveConfigs } from "../db/configs";
import { publishToGitHub, createPublisherConfig } from "../github/publisher";
import { createGitHubAPI, type GitHubAPI } from "../github/api";
import { getSetting, setSetting } from "../db/settings";
import { publishToTelegramChannel, sendConfigCards } from "./output-publisher";
import {
  buildMainMenuKeyboard,
  buildBackKeyboard,
  buildAutoFetchKeyboard,
  buildSubPromptKeyboard,
  buildFetchLoadingKeyboard,
  buildSendKeyboard,
  MENU_CB,
} from "./keyboard";
import { getSourceByChatId, insertSource, updateSource, deleteSource } from "../db/sources";
import {
  fetchAllSubscriptions,
  registerFetch,
  getActiveFetch,
  cancelFetch,
  getFetchCancellation,
  getFetchAbortSignal,
  unregisterFetch,
} from "../ingest/subscription";
import { applyRemarkToConfigs, DEFAULT_REMARK_TEMPLATE } from "../output/remark";
import { formatConfigCard } from "../output/config-card";
import type { ConfigRow } from "../db/connection";
// ─── Command Context ───────────────────────────────────────

/** Context passed to command handlers. */
export interface CommandContext {
  db: D1Database;
  api: TelegramBotAPI;
  adminUserIds: string | undefined;
  message: TgMessage;
  /** GitHub token from Cloudflare secret (optional, needed for /publish). */
  githubToken?: string;
  /** GitHub API client (optional, injectable for testing). */
  githubApi?: GitHubAPI;
  /** User ID override for callback queries (callbackQuery.from.id). */
  userId?: number;
  /** True when invoked from inline keyboard callback (not a /command). */
  isCallback?: boolean;
}

// ─── /start ────────────────────────────────────────────────

/**
 * Handle /start command.
 * Sends welcome message. Does NOT auto-promote to admin.
 */
export async function handleStart(ctx: CommandContext): Promise<void> {
  const { api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  console.log("[commands] /start: userId=" + userId + " chatId=" + chatId + " isAdmin=" + isAdmin(userId ?? 0, adminUserIds) + " adminIdsConfigured=" + !!adminUserIds);

  if (!userId || !isAdmin(userId, adminUserIds)) {
    console.log("[commands] /start: ACCESS DENIED for userId=" + userId);
    const r1 = await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    console.log("[commands] /start: access denied sendMessage=" + r1);
    return;
  }

  const r2 = await api.sendMessage({
    chat_id: chatId,
    text: [
      "🤖 <b>V2Ray Aggregator Bot</b>",
      "",
      "Welcome! This bot aggregates V2Ray configurations.",
      "",
      "Use /help to see available commands.",
      "",
      "Operator metadata is based on administrator-provided verification.",
    ].join("\n"),
reply_markup: buildMainMenuKeyboard(),
    parse_mode: "HTML",
  });
  console.log("[commands] /start: welcome sendMessage=" + r2);
}

// ─── /menu ─────────────────────────────────────────────────

/**
 * Handle /menu command.
 * Shows the inline keyboard menu for mobile-friendly interaction.
 */
export async function handleMenu(ctx: CommandContext): Promise<void> {
  const { api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  await api.sendMessage({
    chat_id: chatId,
    text: "📱 <b>منوی اصلی</b>\n\nیکی از عملیات زیر را انتخاب کنید:",
    parse_mode: "HTML",
    reply_markup: buildMainMenuKeyboard(),
  });
}
// ─── /help ─────────────────────────────────────────────────

/**
 * Handle /help command.
 * Lists available commands and usage.
 */
export async function handleHelp(ctx: CommandContext): Promise<void> {
  const { api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  await api.sendMessage({
    chat_id: chatId,
    text: [
      "📋 <b>Available Commands</b>",
      "",
      "/start — Welcome message",
      "/help — Show this help",
      "/status — System status",
      "",
      "📥 <b>Ingestion</b>:",
      "/upload — Send V2Ray configs (text or document)",
      "/cancel — Cancel pending upload",
      "",
      "📡 <b>Sources</b> (Phase 6+):",
      "/addsource — Add trusted channel",
      "/removesource — Remove source",
      "/sources — List sources",
      "",
      "📤 <b>Output</b>:",
      "/generate — Generate output files",
      "/publish — Publish to GitHub",
      "",
      "⚙️ <b>Configuration</b>:",
      "/setgithub — Set GitHub repo settings",
      "/setoutput — Set Telegram output channel",
      "/setremark — Set config name template",
      "/setwelcome — Set welcome message",
      "",
      "📤 <b>Send</b>:",
      "/send — Send configs/files to output channel",
    ].join("\n"),
      reply_markup: buildBackKeyboard(),
parse_mode: "HTML",
  });
}

// ─── /status ───────────────────────────────────────────────

/**
 * Handle /status command.
 * Shows system status and statistics.
 */
export async function handleStatus(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  try {
    const [totalConfigs, totalSources, totalBatches, adminState] =
      await Promise.all([
        countConfigs(db),
        countSources(db),
        countBatches(db),
        getAdminStateName(db, userId),
      ]);

    await api.sendMessage({
      chat_id: chatId,
      text: [
        "📊 <b>System Status</b>",
        "",
        `Configurations: ${totalConfigs}`,
        `Sources: ${totalSources}`,
        `Batches: ${totalBatches}`,
        `Your state: ${adminState}`,
        "",
        `Version: 0.1.0`,
        `Timestamp: ${new Date().toISOString()}`,
      ].join("\n"),
      parse_mode: "HTML",
    });
  } catch {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Error retrieving status. Please try again later.",
    });
  }
}

// ─── /upload ───────────────────────────────────────────────

/**
 * Handle /upload command.
 * Instructs the admin to send configs as text or document.
 */
export async function handleUpload(ctx: CommandContext): Promise<void> {
  const { api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  await api.sendMessage({
    chat_id: chatId,
    text: [
      "📥 <b>Upload V2Ray Configs</b>",
      "",
      "Send your configurations as:",
      "• Text message with config links",
      "• .txt file document",
      "",
      "Supported protocols:",
      "vmess, vless, trojan, ss, hysteria2, hy2, hysteria",
      "",
      "After sending, you'll be asked to select the operator.",
    ].join("\n"),
    parse_mode: "HTML",
  });
}

// ─── /cancel ───────────────────────────────────────────────

/**
 * Handle /cancel command.
 * Cancels any pending upload flow.
 */
export async function handleCancel(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.",
    });
    return;
  }

  const activeFlowId = await getActiveFetch(userId, chatId, db);
  if (activeFlowId && await cancelFetch(activeFlowId, userId, chatId, db)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "❌ درخواست لغو دریافت ثبت شد.",
    });
    return;
  }

  const { getAdminState } = await import("../db/admin-states");
  let state: Awaited<ReturnType<typeof getAdminState>> = null;
  try {
    state = await getAdminState(db, userId);
  } catch {
    // If state lookup fails, clear anyway to guarantee cancellation
    await clearAdminState(db, userId);
    await api.sendMessage({
      chat_id: chatId,
      text: "❌ عملیات لغو شد.",
    });
    return;
  }

  if (state && state.state !== "idle") {
    await clearAdminState(db, userId);
    await api.sendMessage({
      chat_id: chatId,
      text: "❌ عملیات لغو شد.",
    });
  } else {
    await api.sendMessage({
      chat_id: chatId,
      text: "چیزی برای لغو وجود ندارد.",
    });
  }
}

// ─── /addsource ───────────────────────────────────────────

/**
 * Handle /addsource command.
 * Usage: /addsource <chat_id> [title] [username]
 * Or: /addsource -1001234567890 MyChannel @mychannel
 */
export async function handleAddSource(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.",
    });
    return;
  }

  const text = getMessageText(message);
  const parts = text.split(/\s+/);
  // parts[0] = "/addsource", parts[1] = chat_id, parts[2] = title, parts[3] = @username

  if (parts.length < 2) {
    await api.sendMessage({
      chat_id: chatId,
      text: [
        "Usage: /addsource <chat_id> [title] [username]",
        "",
        "Example:",
        "/addsource -1001234567890 MyChannel @mychannel",
        "",
        "The chat_id is the numeric ID of the Telegram channel.",
      ].join("\n"),
    });
    return;
  }

  const targetChatId = parseInt(parts[1], 10);
  if (isNaN(targetChatId)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Invalid chat_id. Must be a number.",
    });
    return;
  }

  const title = parts[2] || undefined;
  const username = parts[3]?.replace(/^@/, "") || undefined;

  const result = await addTrustedSource(db, targetChatId, title, username);

  await api.sendMessage({
    chat_id: chatId,
    text: result.message,
    parse_mode: "HTML",
  });
}

// ─── /removesource ─────────────────────────────────────────

/**
 * Handle /removesource command.
 * Usage: /removesource <chat_id>
 */
export async function handleRemoveSource(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.",
    });
    return;
  }

  const text = getMessageText(message);
  const parts = text.split(/\s+/);

  if (parts.length < 2) {
    await api.sendMessage({
      chat_id: chatId,
      text: "Usage: /removesource <chat_id>",
    });
    return;
  }

  const targetChatId = parseInt(parts[1], 10);
  if (isNaN(targetChatId)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Invalid chat_id. Must be a number.",
    });
    return;
  }

  const result = await removeTrustedSource(db, targetChatId);

  await api.sendMessage({
    chat_id: chatId,
    text: result.message,
    parse_mode: "HTML",
  });
}

// ─── /sources ──────────────────────────────────────────────

/**
 * Handle /sources command.
 * Lists all configured sources with their status.
 */
export async function handleSources(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.",
    });
    return;
  }

  try {
    const sources = await getAllSources(db);

    if (sources.length === 0) {
      await api.sendMessage({
        chat_id: chatId,
        text: [
          "📡 <b>Trusted Sources</b>",
          "",
          "No sources configured.",
          "",
          "Use /addsource <chat_id> to add a channel.",
        ].join("\n"),
        parse_mode: "HTML",
      });
      return;
    }

    const lines = sources.map((s) => {
      const status = s.enabled ? (s.trusted ? "✅" : "⚠️ Not trusted") : "❌ Disabled";
      const name = s.username
        ? `@${s.username}`
        : s.title
          ? `${s.title}`
          : `ID:${s.chat_id}`;
      return `${status} ${name} (${s.chat_id})`;
    });

    await api.sendMessage({
      chat_id: chatId,
      text: [
        "📡 <b>Trusted Sources</b>",
        "",
        ...lines,
        "",
        `Total: ${sources.length}`,
      ].join("\n"),
      parse_mode: "HTML",
    });
  } catch {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Error retrieving sources.",
    });
  }
}

// ─── /generate ─────────────────────────────────────────────

/**
 * Handle /generate command.
 * Generates all output files and shows a summary to the admin.
 * Does NOT publish to GitHub — use /publish for that.
 */
export async function handleGenerate(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  try {
    // Generate all output files
    const manifest = await generateAllOutputs(db);

    // Compute summary stats
    const totalConfigs = await countActiveConfigs(db);
    const protocolCounts = await countConfigsByProtocol(db);

    const fileCount = manifest.size;
    let totalSize = 0;
    for (const [, content] of manifest) {
      totalSize += content.length;
    }

    // Build protocol breakdown
    const protocolLines = Object.entries(protocolCounts)
      .map(([proto, count]) => `  • ${proto}: ${count}`)
      .join("\n");

    await api.sendMessage({
      chat_id: chatId,
      text: [
        "📤 <b>Output Generated</b>",
        "",
        `Total active configs: ${totalConfigs}`,
        `Files generated: ${fileCount}`,
        `Total size: ${(totalSize / 1024).toFixed(1)} KB`,
        "",
        "<b>Protocol breakdown:</b>",
        protocolLines || "  (none)",
        "",
        "Use /publish to push to GitHub.",
      ].join("\n"),
      parse_mode: "HTML",
    });
  } catch {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Error generating output. Please try again later.",
    });
  }
}

// ─── /publish ──────────────────────────────────────────────

/**
 * Handle /publish command.
 * Publishes generated output to GitHub repository.
 * Only admin-authorized users can publish.
 *
 * Flow (§40 Publication):
 * 1. Generate output from D1
 * 2. Publish to GitHub via existing publisher
 * 3. Report result to admin (securely)
 */
export async function handlePublish(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds, githubToken } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  // Show publishing status
  await api.sendMessage({
    chat_id: chatId,
    text: "🚀 <b>Publishing...</b>",
    parse_mode: "HTML",
  });

  try {
    // Generate manifest once for both GitHub and Telegram channel publishing
    let manifest: Map<string, string>;
    try {
      manifest = await generateAllOutputs(db);
    } catch {
      await api.sendMessage({
        chat_id: chatId,
        text: "⚠️ Failed to generate output files.",
      });
      return;
    }

    // ── Step 1: Publish to GitHub (if configured) ──
    let githubResult: { success: boolean; filesChanged: number; filesUnchanged: number; commitSha: string | null } | null = null;
    const config = await createPublisherConfig(db, githubToken ?? "");
    if (config && githubToken) {
      const githubApi_ = ctx.githubApi ?? createGitHubAPI(githubToken);
      githubResult = await publishToGitHub(db, githubApi_, config, manifest);
    }

    // ── Step 2: Publish to Telegram output channel ──
    const tgResult = await publishToTelegramChannel(db, api, manifest);

    // ── Step 3: Report combined results ──
    const lines: string[] = [];

    if (!config) {
      lines.push("ℹ️ <b>GitHub:</b> Not configured (skipped)");
    } else if (githubResult) {
      if (githubResult.success) {
        lines.push("✅ <b>GitHub:</b> Published successfully");
        lines.push(`  Files changed: ${githubResult.filesChanged}`);
        lines.push(`  Files unchanged: ${githubResult.filesUnchanged}`);
        if (githubResult.commitSha) {
          lines.push(`  Commit: <code>${githubResult.commitSha.substring(0, 7)}</code>`);
        }
      } else {
        lines.push("⚠️ <b>GitHub:</b> Publication failed");
      }
    }

    if (tgResult.error) {
      lines.push(`⚠️ <b>Telegram:</b> ${tgResult.error}`);
    } else if (tgResult.sentCount > 0) {
      lines.push(
        `✅ <b>Telegram:</b> Sent ${tgResult.sentCount}/${tgResult.totalCount} files`
      );
    } else if (tgResult.skippedCount > 0) {
      lines.push(
        `ℹ️ <b>Telegram:</b> ${tgResult.skippedCount} files skipped (empty)`
      );
    }

    if (lines.length === 0) {
      lines.push("ℹ️ Nothing to publish — all outputs are empty.");
    }

    await api.sendMessage({
      chat_id: chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
    });
  } catch {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Error during publication. Please try again later.",
    });
  }
}

// ─── /setgithub ────────────────────────────────────────────

/**
 * Handle /setgithub command.
 * Configures GitHub repository settings.
 * Usage: /setgithub <owner> <repo> [branch]
 */
export async function handleSetGithub(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.",
    });
    return;
  }

  const text = getMessageText(message);
  const parts = text.split(/\s+/);

  if (parts.length < 3) {
    await api.sendMessage({
      chat_id: chatId,
      text: [
        "Usage: /setgithub <owner> <repo> [branch]",
        "",
        "Example:",
        "/setgithub myuser v2ray-configs main",
        "",
        "Default branch: main",
      ].join("\n"),
    });
    return;
  }

  const owner = parts[1];
  const repo = parts[2];
  const branch = parts[3] || "main";

  // Basic validation
  if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Invalid owner or repo name. Use alphanumeric characters, hyphens, and dots only.",
    });
    return;
  }

  // Branch name validation (Git ref name rules)
  if (branch.length > 100 || /^\./.test(branch) || /\.\./.test(branch) || /^-/.test(branch) || !/^[a-zA-Z0-9._\/-]+$/.test(branch)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Invalid branch name. Use alphanumeric characters, dots, hyphens, slashes. Max 100 chars. Cannot start with '.' or '-'.",
    });
    return;
  }

  try {
    await setSetting(db, "github_owner", owner);
    await setSetting(db, "github_repo", repo);
    await setSetting(db, "github_branch", branch);

    await api.sendMessage({
      chat_id: chatId,
      text: [
        "✅ <b>GitHub configured</b>",
        "",
        `Owner: ${owner}`,
        `Repo: ${repo}`,
        `Branch: ${branch}`,
        "",
        "Use /publish to push output files.",
      ].join("\n"),
      parse_mode: "HTML",
    });
  } catch {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Error saving GitHub configuration.",
    });
  }
}

// ─── /setoutput ────────────────────────────────────────────

/**
 * Handle /setoutput command.
 * Configures the Telegram output channel for file publication.
 * Usage: /setoutput <channel_id>
 */
export async function handleSetOutput(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.",
    });
    return;
  }

  const text = getMessageText(message);
  const parts = text.split(/\s+/);

  if (parts.length < 2) {
    await api.sendMessage({
      chat_id: chatId,
      text: [
        "Usage: /setoutput <channel_id>",
        "",
        "Example:",
        "/setoutput -1001234567890",
        "",
        "The channel_id is the numeric ID of your Telegram output channel.",
      ].join("\n"),
    });
    return;
  }

  const channelId = parts[1];

  // Validate it's a number
  if (!/^-?\d+$/.test(channelId)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Invalid channel_id. Must be a number.",
    });
    return;
  }

  try {
    await setSetting(db, "output_channel_id", channelId);

    await api.sendMessage({
      chat_id: chatId,
      text: [
        "✅ <b>Output channel configured</b>",
        "",
        `Channel ID: <code>${channelId}</code>`,
        "",
        "Generated files will be sent to this channel during /publish.",
      ].join("\n"),
      parse_mode: "HTML",
    });
  } catch {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ Error saving output channel configuration.",
    });
  }
}


// ─── /setremark ────────────────────────────────────────────

/**
 * Handle /setremark command.
 * Sets the remark template applied to configs at send/generate time.
 * Usage: /setremark <template>  (or tap the menu button)
 * Placeholders: {location} {flag} {country} {protocol}
 */
export async function handleSetRemark(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  const text = getMessageText(message);
  const parts = text.split(/\s+/);

  // Direct template argument (only from typed command)
  if (!ctx.isCallback && parts.length >= 2) {
    const template = parts.slice(1).join(" ").trim();
    if (template.length > 120) {
      await api.sendMessage({
        chat_id: chatId,
        text: "⚠️ متن طولانی است (حداکثر ۱۲۰ کاراکتر).",
        reply_markup: buildBackKeyboard(),
      });
      return;
    }
    try {
      await setSetting(db, "remark_template", template);
      await api.sendMessage({
        chat_id: chatId,
        text: [
          "✅ <b>قالب نام ذخیره شد:</b>",
          "",
          "📌 " + template,
          "",
          "متغیرها: {location} {flag} {country} {protocol}",
        ].join("\n"),
        parse_mode: "HTML",
        reply_markup: buildBackKeyboard(),
      });
    } catch {
      await api.sendMessage({
        chat_id: chatId,
        text: "⚠️ خطا در ذخیره قالب نام.",
        reply_markup: buildBackKeyboard(),
      });
    }
    return;
  }

  // Conversation mode — prompt for the template
  await setAdminState(db, userId, "awaiting_remark_template", { flow: "setremark" });
  const current = await getSetting(db, "remark_template");
  await api.sendMessage({
    chat_id: chatId,
    text: [
      "🏷️ <b>قالب نام کانفیگ</b>",
      "",
      "قالب جدید را ارسال کنید. متغیرها:",
      "{location} {flag} {country} {protocol}",
      "",
      current ? "قالب فعلی: <code>" + current + "</code>" : "قالبی تنظیم نشده است.",
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: buildSubPromptKeyboard(),
  });
}

// ─── /setwelcome ───────────────────────────────────────────

/**
 * Handle /setwelcome command.
 * Sets the welcome message sent when new members join a group.
 * Usage: /setwelcome <text>  (or tap the menu button)
 * Placeholders: {name} {group}
 */
export async function handleSetWelcome(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  const text = getMessageText(message);
  const parts = text.split(/\s+/);

  // Direct text argument (only from typed command)
  if (!ctx.isCallback && parts.length >= 2) {
    const welcome = parts.slice(1).join(" ").trim();
    try {
      await setSetting(db, "welcome_message", welcome);
      await api.sendMessage({
        chat_id: chatId,
        text: "✅ پیام خوش‌آمد ذخیره شد.\n\nپیش‌نمایش:\n" + welcome,
        parse_mode: "HTML",
        reply_markup: buildBackKeyboard(),
      });
    } catch {
      await api.sendMessage({
        chat_id: chatId,
        text: "⚠️ خطا در ذخیره پیام خوش‌آمد.",
        reply_markup: buildBackKeyboard(),
      });
    }
    return;
  }

  // Conversation mode — prompt for the text
  await setAdminState(db, userId, "awaiting_welcome_text", { flow: "setwelcome" });
  const current = await getSetting(db, "welcome_message");
  await api.sendMessage({
    chat_id: chatId,
    text: [
      "👋 <b>پیام خوش‌آمد</b>",
      "",
      "متن جدید را ارسال کنید. متغیرها:",
      "{name} {group}",
      "",
      current ? "متن فعلی:" : "متن‌ای تنظیم نشده است.",
      current ? current : "",
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: buildSubPromptKeyboard(),
  });
}

// ─── /send ─────────────────────────────────────────────────

/**
 * Handle /send command.
 * Shows options for sending configs to the configured output channel:
 * - files (all.txt, per-protocol, per-operator) as documents
 * - recent configs as individual cards
 * - all configs as batch cards
 * Usage: /send [files|recent|all]
 */
export async function handleSendCommand(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  const text = getMessageText(message);
  const parts = text.split(/\s+/);
  if (!ctx.isCallback && parts.length >= 2) {
    const action = parts[1].toLowerCase();
    if (["files", "recent", "all"].includes(action)) {
      await handleSendAction(action, ctx);
      return;
    }
  }

  await api.sendMessage({
    chat_id: chatId,
    text: "📤 <b>ارسال به کانال خروجی</b>\n\nگزینه مورد نظر را انتخاب کنید:",
    parse_mode: "HTML",
    reply_markup: buildSendKeyboard(),
  });
}

/**
 * Handle send:* callback actions from the send menu.
 * Actions: files, recent, all, cancel
 */
export async function handleSendAction(action: string, ctx: CommandContext): Promise<void> {
  const { db, api, message } = ctx;
  const chatId = message.chat.id;

  switch (action) {
    case "files": {
      await api.sendMessage({ chat_id: chatId, text: "⏳ در حال ساخت و ارسال فایل‌ها...", parse_mode: "HTML" });
      try {
        const manifest = await generateAllOutputs(db);
        const result = await publishToTelegramChannel(db, api, manifest);
        await api.sendMessage({
          chat_id: chatId,
          text: result.error
            ? "⚠️ " + result.error
            : [
                "✅ <b>ارسال فایل‌ها انجام شد</b>",
                "",
                "📄 ارسال‌شده: " + result.sentCount,
                "⏭️ ردشده (خالی/بزرگ): " + result.skippedCount,
                "❌ ناموفق: " + result.failedCount,
              ].join("\n"),
          parse_mode: "HTML",
          reply_markup: buildBackKeyboard(),
        });
      } catch {
        await api.sendMessage({
          chat_id: chatId,
          text: "⚠️ خطا در ساخت یا ارسال فایل‌ها.",
          reply_markup: buildBackKeyboard(),
        });
      }
      break;
    }

    case "recent": {
      const configs = await getRecentActiveConfigs(db, 10);
      if (configs.length === 0) {
        await api.sendMessage({ chat_id: chatId, text: "📭 کانفیگ فعالی وجود ندارد.", reply_markup: buildBackKeyboard() });
        break;
      }
      await sendConfigsAsCards(db, api, configs, chatId);
      break;
    }

    case "all": {
      const configs = await getActiveConfigs(db);
      if (configs.length === 0) {
        await api.sendMessage({ chat_id: chatId, text: "📭 کانفیگ فعالی وجود ندارد.", reply_markup: buildBackKeyboard() });
        break;
      }
      await sendConfigsAsCards(db, api, configs, chatId);
      break;
    }

    case "cancel":
      await api.sendMessage({
        chat_id: chatId,
        text: "❌ ارسال لغو شد.",
        reply_markup: buildBackKeyboard(),
      });
      break;

    default:
      await api.sendMessage({ chat_id: chatId, text: "❓ گزینه ناشناخته.", reply_markup: buildBackKeyboard() });
      break;
  }
}

/**
 * Send configs to the output channel as formatted cards.
 * The remark template (if configured) is applied to every URI first,
 * so published configs carry our own channel name.
 */
async function sendConfigsAsCards(
  db: D1Database,
  api: TelegramBotAPI,
  configs: ConfigRow[],
  chatId: number
): Promise<void> {
  const template = (await getSetting(db, "remark_template")) ?? DEFAULT_REMARK_TEMPLATE;
  const uris = applyRemarkToConfigs(configs, template);
  const cards = configs.map((c, i) => formatConfigCard({ ...c, raw: uris[i] }));

  const result = await sendConfigCards(db, api, cards);
  await api.sendMessage({
    chat_id: chatId,
    text: result.error
      ? "⚠️ " + result.error
      : [
          "✅ <b>ارسال کانفیگ‌ها انجام شد</b>",
          "",
          "📤 ارسال‌شده: " + result.sentCount,
          "❌ ناموفق: " + result.failedCount,
          "",
          "📌 نام کانفیگ‌ها با قالب تنظیم‌شده بازنویسی شد.",
        ].join("\n"),
    parse_mode: "HTML",
    reply_markup: buildBackKeyboard(),
  });
}

// ─── /delsub (callback) ──────────────────────────────────

/**
 * Handle del_sub:<chat_id> callback — single-click subscription delete.
 * Only deletes subscription sources (rows with sub_url); trusted channel
 * sources are managed via /removesource.
 */
export async function handleDeleteSub(
  subChatId: number,
  ctx: CommandContext
): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  try {
    const src = await getSourceByChatId(db, subChatId);
    if (!src || !src.sub_url) {
      await api.sendMessage({
        chat_id: chatId,
        text: "❓ این اشتراک دیگر وجود ندارد.\nبرای مشاهده لیست، /menu بزنید.",
        reply_markup: buildBackKeyboard(),
      });
      return;
    }

    const title = src.title || src.sub_url || "Sub";
    await deleteSource(db, subChatId);

    await api.sendMessage({
      chat_id: chatId,
      text: [
        "🗑️ <b>اشتراک حذف شد</b>",
        "",
        "📌 " + title,
      ].join("\n"),
      parse_mode: "HTML",
      reply_markup: buildBackKeyboard(),
    });
  } catch {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ خطا در حذف اشتراک. لطفاً دوباره تلاش کنید.",
      reply_markup: buildBackKeyboard(),
    });
  }
}

// ─── Command Registry ──────────────────────────────────────

// ─── Menu Action Dispatcher ────────────────────────────────

/**
 * Dispatch a menu callback action to the appropriate handler.
 * Used by processCallbackQuery for menu:* callbacks.
 * Returns true if the action was handled.
 */
export async function handleMenuAction(
  action: string,
  ctx: CommandContext
): Promise<boolean> {
  switch (action) {
    case "help":
      await handleHelp(ctx);
      return true;
    case "back":
      await handleMenu(ctx);
      return true;
    // Phase 5 placeholders:
    case "addsub":
      await handleAddSub(ctx);
      return true;
    case "listsub":
      await handleListSub(ctx);
      return true;
    case "fetch":
      await handleFetchNow(ctx);
      return true;
    case "autofetch":
      await handleAutoFetch(ctx);
      return true;
    case "send":
      await handleSendCommand(ctx);
      return true;
    case "setremark":
      await handleSetRemark(ctx);
      return true;
    case "setwelcome":
      await handleSetWelcome(ctx);
      return true;
    default:
      return false;
  }
}

/**
 * Temporary placeholder for Phase 5 features.
 * Shows "coming soon" message with back-to-menu button.
 */
async function handleMenuPlaceholder(
  ctx: CommandContext,
  featureName: string
): Promise<void> {
  const { api, message } = ctx;
  await api.sendMessage({
    chat_id: message.chat.id,
    text: "🚧 <b>" + featureName + "</b>\n\nدر حال حاضر این قابلیت به\u200cزودی اضافه خواهد شد.",
    parse_mode: "HTML",
    reply_markup: buildBackKeyboard(),
  });
}
// ─── /addsub ──────────────────────────────────────────────

/**
 * Handle /addsub command.
 * Adds a subscription URL to the sources table.
 * Usage: /addsub <url> [title]
 */
export async function handleAddSub(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "\u26D4 Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  // Button press -> always enter conversation mode
  if (ctx.isCallback) {
    await setAdminState(db, userId, "awaiting_sub_url", { flow: "addsub" });
    await api.sendMessage({
      chat_id: chatId,
      text: "لینک اشتراک را ارسال کنید:\n\nمثال: https://example.com/sub.txt",
      reply_markup: buildSubPromptKeyboard(),
    });
    return;
  }

  const text = getMessageText(message);
  const parts = text.split(/\s+/);

  if (parts.length < 2) {
    await setAdminState(db, userId, "awaiting_sub_url", { flow: "addsub" });
    await api.sendMessage({
      chat_id: chatId,
      text: "🔗 لینک اشتراک را ارسال کنید:\n\nمثال: https://example.com/sub.txt",
      reply_markup: buildSubPromptKeyboard(),
    });
    return;
  }
  const subUrl = parts[1];
  const title = parts.slice(2).join(" ") || undefined;

  // Validate URL
  try {
    new URL(subUrl);
  } catch {
    await api.sendMessage({
      chat_id: chatId,
      text: "\u26A0\uFE0F \u0644\u06CC\u0646\u06A9 \u0627\u0631\u062A\u0641\u0627\u0639\u06CC \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u06CC\u06A9 URL \u0645\u0639\u062A\u0628\u0631 \u0648\u0627\u0631\u062F \u06A9\u0646\u06CC\u062F.",
      reply_markup: buildBackKeyboard(),
    });
    return;
  }

  try {
    // Use a unique chat_id based on URL hash for subscription sources
    const urlHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(subUrl)
    );
    const hashHex = Array.from(new Uint8Array(urlHash))
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const sourceChatId = parseInt(hashHex, 16);

    // Check if already exists
    const existing = await getSourceByChatId(db, sourceChatId);
    if (existing) {
      await api.sendMessage({
        chat_id: chatId,
        text: "\u2139\uFE0F \u0627\u06CC\u0646 \u0627\u0634\u062A\u0631\u0627\u06A9 \u0642\u0628\u0644\u0627\u064B \u0627\u0636\u0627\u0641\u0647 \u0634\u062F\u0647 \u0627\u0633\u062A.",
        reply_markup: buildBackKeyboard(),
      });
      return;
    }

    await insertSource(db, {
      chat_id: sourceChatId,
      title: title,
      type: "subscription",
      enabled: 1,
      trusted: 1,
    });

    // Update with subscription fields
    await updateSource(db, sourceChatId, {
      sub_url: subUrl,
      sub_status: "active",
      auto_fetch: 1,
    });

    const displayTitle = title || subUrl.substring(0, 40);

    await api.sendMessage({
      chat_id: chatId,
      text: [
        "\u2705 <b>\u0627\u0634\u062A\u0631\u0627\u06A9 \u0627\u0636\u0627\u0641\u0647 \u0634\u062F</b>",
        "",
        "\uD83D\uDCCB " + displayTitle,
        "\uD83D\uDD17 " + subUrl,
        "",
        "\u26A1 \u062F\u0631\u06CC\u0627\u0641\u062A \u062E\u0648\u062F\u06A9\u0627\u0631: \u0641\u0639\u0627\u0644",
      ].join("\n"),
      parse_mode: "HTML",
      reply_markup: buildBackKeyboard(),
    });
  } catch {
    await api.sendMessage({
      chat_id: chatId,
      text: "\u26A0\uFE0F \u062E\u0637\u0627 \u062F\u0631 \u0627\u0636\u0627\u0641\u0647 \u0627\u0634\u062A\u0631\u0627\u06A9. \u0644\u0637\u0641\u0627\u064B \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.",
      reply_markup: buildBackKeyboard(),
    });
  }
}

// ─── /listsub ─────────────────────────────────────────────

/**
 * Handle /listsub command.
 * Lists all subscription sources with their status.
 */
export async function handleListSub(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "\u26D4 Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  try {
    const sources = await getAllSources(db);
    const subs = sources.filter((s) => s.sub_url);

    if (subs.length === 0) {
      await api.sendMessage({
        chat_id: chatId,
        text: [
          "\uD83D\uDCCB <b>\u0644\u06CC\u0633\u062A \u0627\u0634\u062A\u0631\u0627\u06A9\u200C\u0647\u0627</b>",
          "",
          "\u0647\u06CC\u0686 \u0627\u0634\u062A\u0631\u0627\u06A9\u06CC \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.",
          "",
          "\u0628\u0631\u0627\u06CC \u0627\u0636\u0627\u0641\u0647\u0646 \u0627\u0634\u062A\u0631\u0627\u06A9 \u062C\u062F\u06CC\u062F \u0627\u0632:",
          "/addsub <url> [\u0646\u0627\u0645]",
        ].join("\n"),
        parse_mode: "HTML",
        reply_markup: buildBackKeyboard(),
      });
      return;
    }

    const lines: string[] = [
      "\uD83D\uDCCB <b>\u0644\u06CC\u0633\u062A \u0627\u0634\u062A\u0631\u0627\u06A9\u200C\u0647\u0627</b>",
      "",
    ];

    for (const sub of subs) {
      const statusIcon =
        sub.auto_fetch && sub.sub_status === "active"
          ? "\u26A1"
          : sub.sub_status === "inactive"
            ? "\u274C"
            : "\u23F8\uFE0F";
      const title = sub.title || sub.sub_url?.substring(0, 30) || "Sub";
      const autoFetch = sub.auto_fetch ? "\u26A1" : "";
      const lastFetch = sub.last_fetched_at
        ? "\n    \uD83D\uDCC5 " + new Date(sub.last_fetched_at).toLocaleDateString()
        : "";
      const configCount = sub.last_config_count
        ? " | \uD83D\uDCCA " + sub.last_config_count + " \u06A9\u0646\u0641\u06CC\u06AF"
        : "";
      const failures =
        sub.consecutive_failures > 0
          ? " | \u26A0\uFE0F " + sub.consecutive_failures + " \u062E\u0637\u0627"
          : "";

      lines.push(
        statusIcon + " <b>" + title + "</b> " + autoFetch,
        "  \uD83D\uDD17 " + (sub.sub_url || "").substring(0, 50),
        "  " + (sub.sub_status || "unknown") + configCount + failures + lastFetch,
        ""
      );
    }

    lines.push("\uD83D\uDCCF \u06A9\u0644: " + subs.length);
    lines.push("");
    lines.push("\uD83D\uDDD1\uFE0F \u0628\u0631\u0627\u06CC \u062D\u0630\u0641 \u06CC\u06A9 \u0627\u0634\u062A\u0631\u0627\u06A9\u060C \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \u0622\u0646 \u0628\u0632\u0646\u06CC\u062F:");

    // One delete button per subscription (single-click delete)
    const kbRows: TgInlineKeyboardButton[][] = subs.map((sub) => {
      const btnTitle = sub.title || sub.sub_url?.substring(0, 25) || "Sub";
      return [{ text: "\uD83D\uDDD1\uFE0F " + btnTitle, callback_data: "del_sub:" + sub.chat_id }];
    });
    kbRows.push([{ text: "\u25C0\uFE0F \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648", callback_data: MENU_CB.BACK }]);

    await api.sendMessage({
      chat_id: chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: kbRows },
    });
  } catch {
    await api.sendMessage({
      chat_id: chatId,
      text: "\u26A0\uFE0F \u062E\u0637\u0627 \u062F\u0631 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0644\u06CC\u0633\u062A.",
      reply_markup: buildBackKeyboard(),
    });
  }
}

// ─── /fetch ───────────────────────────────────────────────

/**
 * Handle /fetch command.
 * Triggers manual fetch of all enabled subscriptions.
 */
export async function handleFetchNow(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;
  const instrumentationEnabled = ctx.isCallback === true;
  const flowId = crypto.randomUUID();
  const flowLog = (event: string, details = "") => {
    if (instrumentationEnabled) {
      console.log(event + " flow_id=" + flowId + (details ? " " + details : ""));
    }
  };

  flowLog("FETCH_HANDLER_STARTED", "user_id=" + (userId ?? "unavailable") + " chat_id=" + chatId);

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "\u26D4 Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  const activeFlowId = await getActiveFetch(userId, chatId, db);
  if (activeFlowId) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⏳ یک دریافت دیگر برای شما در حال اجراست.",
    });
    return;
  }

  if (!await registerFetch(flowId, userId, chatId, db)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ شروع دریافت ممکن نیست. دوباره تلاش کنید.",
    });
    return;
  }

  flowLog("LOADING_SEND_STARTED");
  const loadingSent = await api.sendMessage({
    chat_id: chatId,
    text: "🔄 <b>در حال دریافت...</b>",
    parse_mode: "HTML",
    reply_markup: buildFetchLoadingKeyboard(flowId),
  });
  flowLog("LOADING_SEND_FINISHED", "success=" + loadingSent);

  try {
    flowLog("FETCH_ALL_STARTED");
    const fetchStartedAt = Date.now();
    const result = await fetchAllSubscriptions(
      db,
      api,
      { flowId, abortSignal: getFetchAbortSignal(flowId) ?? undefined },
      getFetchCancellation(flowId, db, userId) ?? undefined
    );
    flowLog("FETCH_ALL_FINISHED", "duration_ms=" + (Date.now() - fetchStartedAt) + " total=" + result.totalProcessed + " success_count=" + result.successCount + " fail_count=" + result.failCount + " skip_count=" + result.skipCount);

    const lines: string[] = [
      result.cancelled
        ? "❌ <b>دریافت لغو شد</b>"
        : "\u2705 <b>\u0646\u062A\u06CC\u062C\u0647 \u062F\u0631\u06CC\u0627\u0641\u062A</b>",
      "",
      "\uD83D\uDCCA \u06A9\u0644 \u067E\u0631\u062F\u0627\u0632\u0634: " + result.totalProcessed,
      "\u2705 \u0645\u0648\u0641\u0642: " + result.successCount,
      "\u274C \u0646\u0627\u0645\u0648\u0641\u0642: " + result.failCount,
    ];

    if (result.skipCount > 0) {
      lines.push("\u23F8\uFE0F \u0631\u062E\u0634\u062F\u0647: " + result.skipCount);
    }
    if (result.errors && result.errors.length > 0) {
      lines.push("");
      lines.push("💡 <b>دلیل شکست:</b>");
      for (const err of result.errors.slice(0, 5)) {
        lines.push("  • " + err);
      }
    }
    if (result.published && result.published.published) {
      lines.push("");
      if (result.published.sentCount > 0) {
        lines.push("📤 " + result.published.sentCount + " کانفیگ جدید به کانال خروجی ارسال شد.");
      }
    }

    flowLog("RESULT_SEND_STARTED");
    const resultSent = await api.sendMessage({
      chat_id: chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      reply_markup: buildBackKeyboard(),
    });
    flowLog("RESULT_SEND_FINISHED", "success=" + resultSent);
    flowLog("FLOW_COMPLETED");
  } catch {
    flowLog("FETCH_HANDLER_FAILED", "error_code=fetch_handler_error");
    await api.sendMessage({
      chat_id: chatId,
      text: "\u26A0\uFE0F \u062E\u0637\u0627 \u062F\u0631 \u062F\u0631\u06CC\u0627\u0641\u062A. \u0644\u0637\u0641\u0627\u064B \u0628\u0639\u062F\u0627 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.",
      reply_markup: buildBackKeyboard(),
    });
  } finally {
    const cancelled = (await getFetchCancellation(flowId, db, userId))?.isCancelled() === true;
    await unregisterFetch(flowId, db, userId, cancelled ? "cancelled" : "completed");
  }
}

// ─── /autofetch ───────────────────────────────────────────

/**
 * Handle /autofetch command.
 * Configures auto-fetch settings.
 * Usage: /autofetch [on|off|interval <hours>]
 */
export async function handleAutoFetch(ctx: CommandContext): Promise<void> {
  const { db, api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = ctx.userId ?? message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "\u26D4 Access denied.\nThis bot is for authorized administrators only.",
    });
    return;
  }

  const text = getMessageText(message);
  const parts = text.split(/\s+/);

  // No arguments — show current settings
  if (parts.length < 2) {
    const sources = await getAllSources(db);
    const subs = sources.filter((s) => s.sub_url);
    const activeCount = subs.filter(
      (s) => s.auto_fetch && s.sub_status === "active"
    ).length;
    const interval =
      subs.length > 0 ? subs[0].fetch_interval_hours : 24;

    await api.sendMessage({
      chat_id: chatId,
      text: [
        "\u2699\uFE0F <b>\u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u062F\u0631\u06CC\u0627\u0641\u062A \u062E\u0648\u062F\u06A9\u0627\u0631</b>",
        "",
        "\u0627\u0634\u062A\u0631\u0627\u06A9\u200C\u0647\u0627 \u0628\u0627 \u062F\u0631\u06CC\u0627\u0641\u062A \u062E\u0648\u062F\u06A9\u0627\u0631: " + activeCount + "/" + subs.length,
        "\u0628\u0632\u0645\u0627\u0646 \u062F\u0631\u06CC\u0627\u0641\u062A: " + interval + " \u0633\u0627\u0639\u062A",
        "",
        "\u0627\u0633\u062A\u0641\u0627\u062F\u0647:",
        "/autofetch on — \u0641\u0639\u0627\u0644 \u06A9\u0631\u062F\u0646",
        "/autofetch off — \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u06A9\u0631\u062F\u0646",
        "/autofetch interval <\u0633\u0627\u0639\u062A> — \u062A\u063A\u06CC\u06CC\u0631 \u0628\u0632\u0645\u0627\u0646",
      ].join("\n"),
      parse_mode: "HTML",
      reply_markup: buildAutoFetchKeyboard(),
    });
    return;
  }

  const action = parts[1].toLowerCase();

  if (action === "on") {
    const sources = await getAllSources(db);
    const subs = sources.filter((s) => s.sub_url);
    let count = 0;
    for (const sub of subs) {
      if (!sub.auto_fetch) {
        await updateSource(db, sub.chat_id, { auto_fetch: 1 });
        count++;
      }
    }
    await api.sendMessage({
      chat_id: chatId,
      text: "\u2705 \u062F\u0631\u06CC\u0627\u0641\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u0628\u0631\u0627\u06CC " + count + " \u0627\u0634\u062A\u0631\u0627\u06A9 \u0641\u0639\u0627\u0644 \u0634\u062F.",
      reply_markup: buildBackKeyboard(),
    });
    return;
  }

  if (action === "off") {
    const sources = await getAllSources(db);
    const subs = sources.filter((s) => s.sub_url);
    let count = 0;
    for (const sub of subs) {
      if (sub.auto_fetch) {
        await updateSource(db, sub.chat_id, { auto_fetch: 0 });
        count++;
      }
    }
    await api.sendMessage({
      chat_id: chatId,
      text: "\u274C \u062F\u0631\u06CC\u0627\u0641\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u0628\u0631\u0627\u06CC " + count + " \u0627\u0634\u062A\u0631\u0627\u06A9 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u0634\u062F.",
      reply_markup: buildBackKeyboard(),
    });
    return;
  }

  if (action === "interval" && parts.length >= 3) {
    const hours = parseInt(parts[2], 10);
    if (isNaN(hours) || hours < 1 || hours > 168) {
      await api.sendMessage({
        chat_id: chatId,
        text: "\u26A0\uFE0F \u0628\u0632\u0645\u0627\u0646 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A. \u0645\u0642\u062F\u0645: 1 \u062A\u0627 168 \u0633\u0627\u0639\u062F.",
        reply_markup: buildBackKeyboard(),
      });
      return;
    }
    const sources = await getAllSources(db);
    const subs = sources.filter((s) => s.sub_url);
    for (const sub of subs) {
      await db
        .prepare("UPDATE sources SET fetch_interval_hours = ? WHERE chat_id = ?")
        .bind(hours, sub.chat_id)
        .run();
    }
    await api.sendMessage({
      chat_id: chatId,
      text: "\u2705 \u0628\u0632\u0645\u0627\u0646 \u062F\u0631\u06CC\u0627\u0641\u062A \u0628\u0647 " + hours + " \u0633\u0627\u0639\u062A \u062A\u063A\u06CC\u06CC\u0631 \u06A9\u0631\u062F.",
      reply_markup: buildBackKeyboard(),
    });
    return;
  }

  // Unknown subcommand
  await api.sendMessage({
    chat_id: chatId,
    text: "\u26A0\uFE0F \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0646\u0627\u0634\u0646\u0627\u062E\u062A\u0647. \u0628\u0631\u0627\u06CC \u0631\u0627\u0647\u0646\u0645\u0627\u06CC\u06CC /autofetch \u062A\u0648\u0633\u06CC\u0637 \u06A9\u0646\u06CC\u062F.",
    reply_markup: buildBackKeyboard(),
  });
}

/** Command handler function signature. */
export type CommandHandler = (ctx: CommandContext) => Promise<void>;

/** Map of command names to handlers. */
const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  start: handleStart,
  help: handleHelp,
  status: handleStatus,
  upload: handleUpload,
  cancel: handleCancel,
  addsource: handleAddSource,
  removesource: handleRemoveSource,
  sources: handleSources,
  generate: handleGenerate,
  publish: handlePublish,
  setgithub: handleSetGithub,
  setoutput: handleSetOutput,
  menu: handleMenu,
  addsub: handleAddSub,
  listsub: handleListSub,
  fetch: handleFetchNow,
  autofetch: handleAutoFetch,
  send: handleSendCommand,
  setremark: handleSetRemark,
  setwelcome: handleSetWelcome,
};

/**
 * Execute a bot command by name.
 * Returns true if the command was found and executed.
 */
export async function executeCommand(
  command: string,
  ctx: CommandContext
): Promise<boolean> {
  const handler = COMMAND_HANDLERS[command];
  if (!handler) {
    return false;
  }

  await handler(ctx);
  return true;
}

/**
 * Get the list of registered command names.
 */
export function getRegisteredCommands(): string[] {
  return Object.keys(COMMAND_HANDLERS);
}
