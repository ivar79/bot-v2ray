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
import type { TgMessage } from "./types";
import { getMessageText } from "./types";
import { isAdmin } from "./auth";
import type { D1Database } from "@cloudflare/workers-types";
import { countConfigs } from "../db/configs";
import { countSources, getAllSources } from "../db/sources";
import { countBatches } from "../db/batches";
import { getAdminStateName, clearAdminState } from "../db/admin-states";
import { addTrustedSource, removeTrustedSource } from "../ingest/channel";
import { generateAllOutputs } from "../output/generator";
import { countActiveConfigs, countConfigsByProtocol } from "../db/configs";
import { publishToGitHub, createPublisherConfig } from "../github/publisher";
import { createGitHubAPI, type GitHubAPI } from "../github/api";
import { getSetting, setSetting } from "../db/settings";
import { publishToTelegramChannel } from "./output-publisher";

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
}

// ─── /start ────────────────────────────────────────────────

/**
 * Handle /start command.
 * Sends welcome message. Does NOT auto-promote to admin.
 */
export async function handleStart(ctx: CommandContext): Promise<void> {
  const { api, message, adminUserIds } = ctx;
  const chatId = message.chat.id;
  const userId = message.from?.id;

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
      "🤖 <b>V2Ray Aggregator Bot</b>",
      "",
      "Welcome! This bot aggregates V2Ray configurations.",
      "",
      "Use /help to see available commands.",
      "",
      "Operator metadata is based on administrator-provided verification.",
    ].join("\n"),
    parse_mode: "HTML",
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
  const userId = message.from?.id;

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
    ].join("\n"),
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
  const userId = message.from?.id;

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
  const userId = message.from?.id;

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
  const userId = message.from?.id;

  if (!userId || !isAdmin(userId, adminUserIds)) {
    await api.sendMessage({
      chat_id: chatId,
      text: "⛔ Access denied.",
    });
    return;
  }

  const { getAdminState } = await import("../db/admin-states");
  const state = await getAdminState(db, userId);
  
  if (state?.state !== "idle") {
    await clearAdminState(db, userId);
    await api.sendMessage({
      chat_id: chatId,
      text: "❌ Upload cancelled.",
    });
  } else {
    await api.sendMessage({
      chat_id: chatId,
      text: "Nothing to cancel.",
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
  const userId = message.from?.id;

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
  const userId = message.from?.id;

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
  const userId = message.from?.id;

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
  const userId = message.from?.id;

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
  const userId = message.from?.id;

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
  const userId = message.from?.id;

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
  const userId = message.from?.id;

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

// ─── Command Registry ──────────────────────────────────────

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
