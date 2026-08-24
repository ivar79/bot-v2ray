# V2Ray Aggregator

A V2Ray configuration aggregation system built on Cloudflare Workers.

## Architecture

- **Cloudflare Worker** — Webhook receiver, parser pipeline, output generation
- **Cloudflare D1** — Source of truth for configs, batches, occurrences, sources
- **GitHub REST API** — Atomic publishing to public repository
- **Telegram Bot API** — Admin interface + output channel publishing
- **Cloudflare Cron** — Periodic regeneration and cleanup

## Features

- Parse VMess, VLESS, Trojan, Shadowsocks, Hysteria, Hysteria2
- Deterministic canonicalization and SHA-256 deduplication
- Admin upload via Telegram bot (text + file)
- Trusted channel ingestion (event-driven, no history scraping)
- Operator classification (admin-provided, never guessed)
- No network testing from server
- GitHub atomic publishing via Git Data API
- Independent Telegram output publishing

## Development

```bash
npm install
npm run dev       # Start local development
npm run test      # Run tests
npm run typecheck # TypeScript validation
```

## Deployment

See `docs/deployment.md` for full deployment instructions.
