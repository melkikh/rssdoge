---
name: debug
description: Dry-run rssdoge pipeline for a feed tag — fetch, classify, summarize without Telegram or KV cursor updates. Use when diagnosing why a post was empty, skipped, or misclassified (e.g. "почему пост пустой").
---

# Debug skill

Runs `POST /debug/tag/:tag` on the deployed worker (or local `wrangler dev`).

## Setup

`debug.mjs` is an HTTP client to the worker. In prod the endpoint is behind `authMiddleware`: requires `Authorization: Bearer <TELEGRAM_TOKEN>`.

**The token in `.env` is not the same thing as the Cloudflare secret**, but it is **the same value** (Telegram bot token). The CLI can't see the worker secret — put it in `.env` for `debug.mjs` (dotenvx encryption is fine) or one-off `export TELEGRAM_TOKEN=...`.

```bash
# .env
TELEGRAM_TOKEN=<bot token, same as wrangler secret>
```

Optional: `RSSDOGE_BASE_URL` (default `https://rss-doge.melkikh.workers.dev`).

In `wrangler dev` with `ENVIRONMENT=development` auth is disabled on the worker — but the client still sends Bearer if the token is in env.

## Invocation

```bash
dotenvx run -- node .claude/skills/debug/debug.mjs tag bruce_schneier
dotenvx run -- node .claude/skills/debug/debug.mjs tag unskilled --since 2026-07-01
dotenvx run -- node .claude/skills/debug/debug.mjs tag netsec --limit 5 --json
```

Local dev (same token in `.env`):

```bash
RSSDOGE_BASE_URL=http://127.0.0.1:3000 dotenvx run -- node .claude/skills/debug/debug.mjs tag cloudflare_workers
```

## Output fields

| Field | Meaning |
|-------|---------|
| `pipeline.step` | Where processing stopped: `no_body`, `body_too_short`, `classified_skip`, `summary_cjk`, `summary_empty`, `ok` |
| `feed_raw` | Atom/RSS raw content shape (`content_type`, `source_field`, `keys`) — for atom `#text` issues |
| `classifier` | Raw model output + `PASS`/`SKIP`/`UNKNOWN` |
| `summary` | Raw output, sanitized bullets, `rejected_reason` |
| `would_send` | Exact Telegram HTML (not sent) |
| `neurons_estimate` | Rough AI cost (~0 / ~2 / ~40 per post) |

## Workflow

1. User asks why a post is empty → identify feed tag from channel (`#bruce_schneier` → `bruce_schneier`).
2. Run debug with `--since` near post date if KV cursor is ahead.
3. Read `pipeline.step` + `feed_raw` + `classifier` to pinpoint root cause.
4. Cross-reference with Glitchtip (`tag:reason:...`) if needed.

## What this does NOT do

- Does not send to Telegram
- Does not advance KV cursor
- Does not send to Glitchtip (`skipSentry`)
- Does not search by post URL (use `--since` + scan titles in output)

## Default limit

3 posts (newest first). Use `--limit` up to 20. Each full pipeline post costs ~40 neurons.
