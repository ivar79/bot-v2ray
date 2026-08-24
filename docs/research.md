# V2Ray Aggregator — Technology Research

## Cloudflare Workers
- **Verified**: TypeScript, ES modules, 128MB memory
- **Free tier**: 100K req/day, 10ms CPU/request, 50 subrequests
- **Paid tier**: Unlimited requests, 5min CPU, 10K subrequests ($5/month)
- **Source**: https://developers.cloudflare.com/workers/platform/limits/

## Cloudflare D1
- **Verified**: SQLite-based, 500MB free, 5M reads/day, 100K writes/day
- **Paid**: 10GB/DB, 25B reads/mo, 50M writes/mo
- **Batch API**: db.batch() for efficient multi-statement operations
- **Source**: https://developers.cloudflare.com/d1/platform/limits/

## Cloudflare Secrets
- **Verified**: Encrypted env vars, accessed via `env.NAME`
- **Setup**: `npx wrangler secret put <KEY>`
- **Source**: https://developers.cloudflare.com/workers/configuration/secrets/

## Cloudflare Cron Triggers
- **Verified**: 3/worker (free), 5/worker (paid)
- **Handler**: `scheduled(controller, env, ctx)` in Worker
- **Source**: https://developers.cloudflare.com/workers/configuration/cron-triggers/

## Telegram Bot API
- **Webhook**: setWebhook with `secret_token`, `allowed_updates`, `drop_pending_updates`
- **getFile**: 20MB max download
- **sendDocument**: 50MB max upload
- **channel_post**: Available when bot is admin in channel
- **Inline keyboards**: callback_data max 64 bytes
- **Source**: https://core.telegram.org/bots/api

## GitHub REST API — Git Data API
- **Atomic commit**: Create blobs → tree → commit → update ref
- **Endpoint**: PUT /repos/{o}/{r}/git/refs/heads/{branch}
- **Auth**: Fine-grained PAT with Contents: Write
- **Rate limit**: 5,000 req/hr authenticated
- **Source**: https://docs.github.com/en/rest/git

## Telegram Serverless (tgcloud)
- **Verified real** (core.telegram.org/bots/serverless, Jul 2026)
- **Not used**: Too new (~5 weeks), no published limits, vendor lock-in
- **Decision**: Cloudflare Workers + D1 for V1

## V2Ray Share Link Formats
- **VMess**: vmess:// + base64(JSON)
- **VLESS**: vless://{uuid}@{host}:{port}?{params}#{name}
- **Trojan**: trojan://{password}@{host}:{port}?{params}#{name}
- **Shadowsocks**: ss://base64(method:pass)@host:port#name (SIP002) or ss://base64(full)
- **Hysteria2**: hysteria2://{auth}@{host}:{port}?{params}#{name} (also hy2://)
- **Hysteria**: hysteria://{auth}@{host}:{port}?{params}#{name}
