# Production Deployment Guide

V2Ray Aggregator — Cloudflare Workers + D1 + Telegram Bot + GitHub Publication

---

## Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npx wrangler` or global install)
- Cloudflare account with Workers and D1 enabled
- Telegram bot token (from [@BotFather](https://t.me/BotFather))
- GitHub Personal Access Token (fine-grained, `Contents: Write` on target repo)

---

## 1. Cloudflare D1 Database

### 1.1 Create the database

```bash
npx wrangler d1 create v2ray-aggregator
```

Copy the `database_id` from the output.

### 1.2 Configure wrangler.jsonc

Uncomment and fill in the `d1_databases` section in `wrangler.jsonc`:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "v2ray-aggregator",
      "database_id": "YOUR_DATABASE_ID_HERE"  // paste from step 1.1
    }
  ]
}
```

### 1.3 Apply migrations

```bash
npx wrangler d1 migrations apply v2ray-aggregator --remote
```

Verify:

```bash
npx wrangler d1 execute v2ray-aggregator --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

Expected tables: `configs`, `occurrences`, `sources`, `batches`, `collection_runs`, `processed_updates`, `settings`, `admin_states`.

---

## 2. Cloudflare Secrets

Set each secret via Wrangler. **Never hard-code values.**

```bash
# Telegram bot token from @BotFather
npx wrangler secret put TELEGRAM_BOT_TOKEN
# Paste the token when prompted

# Webhook secret (set in BotFather: /setwebhook secret_token)
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
# Paste the secret when prompted

# GitHub Personal Access Token (Contents: Write)
npx wrangler secret put GITHUB_TOKEN
# Paste the token when prompted

# Comma-separated admin Telegram user IDs
npx wrangler secret put ADMIN_USER_IDS
# Paste the IDs when prompted (e.g., "123456789,987654321")
```

### Getting your Telegram user ID

Send any message to [@userinfobot](https://t.me/userinfobot) — it replies with your numeric ID.

---

## 3. Deploy the Worker

### 3.1 Dry-run (verify before deploy)

```bash
npx wrangler deploy --dry-run
```

### 3.2 Deploy

```bash
npx wrangler deploy
```

Note the output URL (e.g., `https://v2ray-aggregator.<subdomain>.workers.dev`).

---

## 4. Telegram Webhook Registration

### 4.1 Set the webhook

Replace `YOUR_WORKER_URL` with your deployed worker URL and `YOUR_WEBHOOK_SECRET` with the value you set in step 2:

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "YOUR_WORKER_URL/webhook",
    "secret_token": "YOUR_WEBHOOK_SECRET",
    "allowed_updates": ["message", "channel_post", "callback_query"],
    "max_connections": 40
  }'
```

### 4.2 Verify webhook registration

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

Check that:
- `url` points to your worker URL + `/webhook`
- `has_custom_certificate` is `false`
- `last_error_message` is empty or null
- `pending_update_count` is `0` or small

### 4.3 Test the webhook

Open Telegram, find your bot, and send `/start`.

If the bot replies with the welcome message, the webhook is working.

---

## 5. GitHub Token Setup

### 5.1 Create a fine-grained Personal Access Token

1. Go to [GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)
2. Give it a descriptive name (e.g., `v2ray-aggregator-deploy`)
3. Set repository access to the target repository
4. Under **Permissions → Repository permissions**, grant **Contents: Read and write**
5. Generate the token

### 5.2 Configure via bot command

After deployment, message your bot:

```
/setgithub owner-name repo-name main
```

This stores the GitHub repository configuration in D1 settings.

### 5.3 Output channel (optional)

To publish generated files to a Telegram channel, add the bot as admin to the channel, then:

```
/setoutput -1001234567890
```

Replace with your channel's numeric ID (get it from [@userinfobot](https://t.me/userinfobot) or channel info).

---

## 6. Enable Cron Trigger (Optional)

For automatic `processed_updates` cleanup (weekly), uncomment the triggers section in `wrangler.jsonc`:

```jsonc
{
  "triggers": {
    "crons": ["0 3 * * 0"]
  }
}
```

This runs every Sunday at 03:00 UTC, cleaning up update records older than 90 days.

After enabling, redeploy:

```bash
npx wrangler deploy
```

---

## 7. First Production Verification Checklist

Run through this checklist after deployment:

### 7.1 Health endpoint

```bash
curl https://YOUR_WORKER_URL/
```

Expected: `{"status":"ok","service":"v2ray-aggregator","version":"0.1.0",...}`

### 7.2 Bot commands

Open Telegram, message your bot:

| Command | Expected Response |
|---------|-------------------|
| `/start` | Welcome message with bot description |
| `/help` | List of all available commands |
| `/status` | Config count, source count, batch count |

### 7.3 Admin authorization

From a **non-admin** account, try `/upload`:
- Expected: "⛔ Access denied"

### 7.4 Config ingestion

From an **admin** account:
1. Send `/upload`
2. Send a V2Ray config (e.g., `vmess://...`)
3. Bot should confirm ingestion

### 7.5 Output generation

```
/generate
```

Bot should report generated file count and protocol breakdown.

### 7.6 GitHub publication (if configured)

```
/publish
```

Bot should report GitHub publication status and Telegram channel delivery.

### 7.7 Source management

```
/addsource -1001234567890
/sources
/removesource -1001234567890
```

### 7.8 Scheduled cleanup

If cron is enabled, check Cloudflare dashboard → Workers → your worker → Logs for:

```
Cleaned up N old processed update records
```

### 7.9 Security checks

- Bot does **not** respond to non-admin users
- Webhook rejects requests without valid `secret_token`
- No error messages contain tokens, secrets, or stack traces
- Invalid/malicious configs are rejected gracefully

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Bot doesn't respond | Check `getWebhookInfo` for errors; verify webhook secret matches |
| "Access denied" for admin | Verify your user ID is in `ADMIN_USER_IDS` secret |
| `/publish` fails | Check `GITHUB_TOKEN` has `Contents: Write` permission |
| D1 errors | Verify migration was applied to the correct database |
| Worker 500 errors | Check Cloudflare Workers dashboard → Logs |

---

## Environment Variables Reference

| Variable | Type | Source | Required |
|----------|------|--------|----------|
| `DB` | D1 binding | `wrangler.jsonc` | Yes |
| `TELEGRAM_BOT_TOKEN` | Secret | `wrangler secret put` | Yes |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | `wrangler secret put` | Yes |
| `GITHUB_TOKEN` | Secret | `wrangler secret put` | No* |
| `ADMIN_USER_IDS` | Secret | `wrangler secret put` | Yes |

\* Required only for GitHub publication (`/publish`).

### D1 Settings (stored in database)

| Key | Description | Set by |
|-----|-------------|--------|
| `github_owner` | GitHub repository owner | `/setgithub` |
| `github_repo` | GitHub repository name | `/setgithub` |
| `github_branch` | Git branch (default: `main`) | `/setgithub` |
| `output_channel_id` | Telegram channel ID for output | `/setoutput` |
