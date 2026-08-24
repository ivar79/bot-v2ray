# Production Readiness Checklist

V2Ray Aggregator — Cloudflare Workers + D1 + Telegram Bot + GitHub Publication

---

## Audit Summary

| Area | Status | Notes |
|------|--------|-------|
| wrangler.jsonc | ✅ | Valid JSONC, correct schema reference |
| D1 binding | ⚠️ | Must be uncommented and filled before deploy |
| Secrets (4) | ✅ | All referenced in `Env` interface |
| Webhook endpoint | ✅ | `POST /webhook` with secret validation |
| Scheduled trigger | ⚠️ | Must be uncommented to enable cron |
| Migration | ✅ | Single file, 8 tables, all indexes present |
| Node.js compat | ✅ | `nodejs_compat` flag required for crypto |
| Build size | ✅ | 143.82 KiB / 26.99 KiB gzip |
| Tests | ✅ | 573 tests, all passing |
| Typecheck | ✅ | Clean, no errors |

---

## 1. wrangler.jsonc

### Current state

The D1 binding and cron trigger are commented out (template mode). They must be configured before deployment.

### Required changes

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "v2ray-aggregator",
      "database_id": "<paste from wrangler d1 create>"
    }
  ]
}
```

### Optional: Enable cron trigger

```jsonc
{
  "triggers": {
    "crons": ["0 3 * * 0"]  // Weekly, Sunday 03:00 UTC
  }
}
```

### Verified

- `name`: `"v2ray-aggregator"`
- `main`: `"src/index.ts"`
- `compatibility_date`: `"2025-08-20"`
- `compatibility_flags`: `["nodejs_compat"]` — required for `node:crypto` (SHA-256) and `process` polyfills

---

## 2. D1 Bindings

### Binding name

The binding is named `DB` in `wrangler.jsonc` and referenced as `env.DB` throughout the codebase:

- `src/index.ts` — health endpoint, scheduled handler
- `src/telegram/webhook.ts` — webhook processing
- `src/db/*.ts` — all query modules

### Migration

Single migration file: `migrations/0001_initial.sql`

| Table | Purpose | Indexes |
|-------|---------|---------|
| `configs` | Deduplicated configs (by `config_hash`) | `protocol`, `config_hash`, `(active, is_valid)` |
| `occurrences` | Config-to-batch links | `config_id`, `batch_id`, `(source_type, source_chat_id)` |
| `sources` | Trusted ingestion channels | `chat_id` (UNIQUE) |
| `batches` | Ingestion sessions with operator | `operator`, `(source_type, source_chat_id)` |
| `collection_runs` | Pipeline audit trail | None (id-only lookups) |
| `processed_updates` | Webhook idempotency | Primary key on `update_id` |
| `settings` | Key-value config store | Primary key on `key` |
| `admin_states` | Conversation flow state | Primary key on `user_id` |

### Apply migration

```bash
npx wrangler d1 migrations apply v2ray-aggregator --remote
```

### Verify

```bash
npx wrangler d1 execute v2ray-aggregator --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

---

## 3. Secrets

All secrets are set via `wrangler secret put`. None are stored in code, `.env`, or D1 settings.

| Secret | Env Interface | Source | Required |
|--------|--------------|--------|----------|
| `TELEGRAM_BOT_TOKEN` | `env.TELEGRAM_BOT_TOKEN` | @BotFather | **Yes** |
| `TELEGRAM_WEBHOOK_SECRET` | `env.TELEGRAM_WEBHOOK_SECRET` | User-defined | **Yes** |
| `GITHUB_TOKEN` | `env.GITHUB_TOKEN` | GitHub PAT | No* |
| `ADMIN_USER_IDS` | `env.ADMIN_USER_IDS` | @userinfobot | **Yes** |

\* Required only for `/publish` command.

### ADMIN_USER_IDS format

Comma-separated numeric Telegram user IDs. Example: `"123456789,987654321"`

- If empty or unset → **nobody is authorized** (safe default)
- Parsed in `src/telegram/auth.ts` via `parseAdminUserIds()`
- Authorization is by numeric ID only, never by username

### Verification

```bash
# Check all secrets are set
npx wrangler secret list
```

Expected: 4 secrets listed (or 3 if GitHub not configured).

---

## 4. Webhook Endpoint

### Path

`POST https://<worker>.workers.dev/webhook`

### Flow

1. Verify `X-Telegram-Bot-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`
2. Parse JSON body (max 1 MB)
3. Check idempotency via `processed_updates` table
4. Route to handler (message / channel_post / callback_query)
5. Mark as processed
6. Return 200 OK

### Security

- Missing or wrong secret → 403
- Malformed JSON → 400
- Oversized payload (>1 MB) → 413
- Invalid update structure → 400
- Processing errors → still return 200 (prevent Telegram infinite retries)
- No stack traces or internal errors exposed

### Register webhook

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<worker>.workers.dev/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "channel_post", "callback_query"],
    "max_connections": 40
  }'
```

### Verify

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

---

## 5. Scheduled Trigger

### Current state

Commented out in `wrangler.jsonc`. The `scheduled()` handler exists in `src/index.ts` and performs:

```typescript
const { cleanupOldUpdates } = await import("./db/updates");
const deleted = await cleanupOldUpdates(env.DB, 90);
```

### Behavior

- Deletes `processed_updates` rows older than 90 days
- Prevents unbounded table growth
- Uses dynamic import (tree-shakeable)
- Error-safe: catches and logs failures

### Enable

```jsonc
{
  "triggers": {
    "crons": ["0 3 * * 0"]  // Sunday 03:00 UTC
  }
}
```

### Cloudflare limits

- Minimum interval: once per minute
- Maximum: 3 scheduled triggers per Worker (Free plan)
- Jitter: up to 60 seconds
- Weekly schedule (`0 3 * * 0`) is well within limits

---

## 6. Required Cloudflare Settings

| Setting | Value | Where |
|---------|-------|-------|
| Workers plan | Free or Paid | Cloudflare dashboard |
| D1 enabled | Yes | Cloudflare dashboard → D1 |
| `nodejs_compat` | Enabled | `wrangler.jsonc` → `compatibility_flags` |
| D1 binding | `DB` | `wrangler.jsonc` → `d1_databases` |
| Cron trigger | Optional | `wrangler.jsonc` → `triggers` |

### API limits (no action needed)

| Resource | Limit | Impact |
|----------|-------|--------|
| Worker CPU time | 30s (Free) / 30s (Paid) | Ingestion + publish must complete within budget |
| D1 read rows | 5M/day (Free) | Adequate for typical usage |
| D1 write rows | 100K/day (Free) | Adequate for typical usage |
| Request body | 100 MB | We enforce 1 MB at webhook level |
| Secrets | 100 per Worker | We use 4 |

---

## 7. Environment Variables Reference

### Cloudflare Secrets (set via `wrangler secret put`)

```bash
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_WEBHOOK_SECRET=<your chosen secret>
GITHUB_TOKEN=<fine-grained PAT, Contents: Write>
ADMIN_USER_IDS=<comma-separated numeric Telegram user IDs>
```

### D1 Settings (stored in database, set via bot commands)

| Key | Set by | Description |
|-----|--------|-------------|
| `github_owner` | `/setgithub` | GitHub repository owner |
| `github_repo` | `/setgithub` | GitHub repository name |
| `github_branch` | `/setgithub` | Git branch (default: `main`) |
| `output_channel_id` | `/setoutput` | Telegram channel for file delivery |

---

## 8. First Deploy Verification

After deployment, run through these checks in order:

### 8.1 Health check

```bash
curl https://<worker>.workers.dev/
# Expected: {"status":"ok","service":"v2ray-aggregator","version":"0.1.0",...}
```

### 8.2 Bot responsiveness

Open Telegram, find your bot, send `/start`.

- ✅ Welcome message with bot description
- ✅ No error in Cloudflare Workers logs

### 8.3 Admin authorization

From a **non-admin** account, send `/upload`.

- ✅ "⛔ Access denied"

### 8.4 Config ingestion

From an **admin** account, send `/upload` then a V2Ray config.

- ✅ Config parsed and stored
- ✅ Deduplication works (send same config twice → 1 record)

### 8.5 Output generation

```
/generate
```

- ✅ File count and protocol breakdown reported

### 8.6 Source management

```
/addsource -1001234567890
/sources
/removesource -1001234567890
```

- ✅ Source added, listed, and removed

### 8.7 GitHub publication (if configured)

```
/setgithub owner repo main
/publish
```

- ✅ Publication status reported
- ✅ No tokens or secrets in Telegram messages

### 8.8 Status

```
/status
```

- ✅ Config count, source count, batch count reported

---

## 9. Security Posture

| Check | Status | Evidence |
|-------|--------|----------|
| No hardcoded secrets | ✅ | All secrets via `wrangler secret put` |
| No `.env` in git | ✅ | `.gitignore` includes `.env` and `.env.*` |
| Webhook secret validation | ✅ | `X-Telegram-Bot-Secret-Token` checked before processing |
| Admin auth by numeric ID | ✅ | `parseAdminUserIds()` in `src/telegram/auth.ts` |
| D1 parameterized queries | ✅ | All queries use `.bind()` — zero string interpolation |
| No secret leakage | ✅ | Tokens never in Telegram messages, logs, or error responses |
| No stack trace exposure | ✅ | Errors return generic messages |
| Idempotent webhook processing | ✅ | `processed_updates` UNIQUE constraint |
| File path validation | ✅ | `isValidTelegramFilePath()` guards `downloadFile()` |
| Branch name validation | ✅ | Git ref rules enforced in `/setgithub` |
| Oversized payload rejection | ✅ | 1 MB at webhook, 1 MB at SHA-256, 20 MB at file download |
| Source spoofing prevention | ✅ | chat_id validation, enabled+trusted checks |

---

## 10. Build Metrics

| Metric | Value |
|--------|-------|
| Bundle size | 143.82 KiB |
| Gzip size | 26.99 KiB |
| Test count | 573 |
| Test files | 32 |
| Typecheck | Clean |

---

## 11. Known Limitations

1. **D1 binding must be uncommented** — the template ships with it commented out
2. **Cron trigger must be uncommented** — cleanup only runs if cron is enabled
3. **GitHub token is optional** — `/publish` returns "not configured" if missing
4. **Telegram channel publication** — requires `/setoutput` and bot as channel admin
5. **No rate limiting** — relies on Cloudflare's built-in protection; no per-user limits
6. **Single migration** — future schema changes require new migration files
7. **No rollback mechanism** — D1 migrations are forward-only
