# rssdoge

Cloudflare Worker: on a cron schedule fetches RSS feeds, summarizes posts via Workers AI, sends to Telegram.

## Documentation language

| Location | Language |
|----------|----------|
| `CLAUDE.md`, `README.md`, `.claude/skills/**` | **English** |
| `plans/**` (local, gitignored) | **Russian** |

Technical identifiers (`KV`, `bare header`, `captureException`) stay as-is in any language.

## Code comments

Keep comments minimal: only what a human can't easily infer from the code itself (a non-obvious invariant, a gotcha, why-not-the-obvious-thing). Do **not** narrate what the code does or restate design rationale in the source. Rationale, trade-offs, and "why" belong in this file (`CLAUDE.md`) — reference it from a one-line comment (`// … see CLAUDE.md`) instead of duplicating it inline.

## Local agent-loop artifacts (`plans/`)

Session drafts — feature plans, backlog, "what's left" notes — **only in `plans/`**, not in the repo root. The directory is in `.gitignore`; do not commit it.

**Where to put things**

| Type | Path | Example |
|------|------|---------|
| Implementation plan | `plans/<topic>-plan.md` | `plans/whitepapers-plan.md` |
| Backlog / open session questions | `plans/issues.md` | ad-hoc, one file or by topic |
| Done | `plans/done/` or delete | archive or simply delete |

**Plan status** — YAML frontmatter at the top of the file:

```yaml
---
status: active   # active | done | cancelled
created: 2026-07-07
---
```

`done` → move to `plans/done/` or delete. Stable conclusions from a plan go here (CLAUDE.md), into `.claude/skills/`, into code, or README — don't leave them only in `plans/`.

**Agents:** do not create `*-plan.md`, `issues.md`, or drafts in the repo root; new local markdown only under `plans/`.

## Non-obvious behavior

### `src/config.ts`: only four fields differ between prod and dev

`config(env)` spreads one `shared` object into both environments and overrides only `authentication`, `baseURL`, `telegramChatID`, and `feeds`. Prompts and feed maps are module-level consts (`AI_PROMPT`, `CLASSIFIER_PROMPT`, `FEEDS_PRODUCTION`, `FEEDS_DEVELOPMENT`). Add a shared setting once in `shared` — there is no prod/dev duplication left to sync by hand.

### Workers AI: response shape depends on the model

OpenAI-style models (e.g. `@cf/zai-org/glm-4.7-flash`) return `result.choices[0].message.content`. Llama-style models return a flat `result.response`. The `extractContent()` helper in `src/ai.ts` intentionally handles both. When switching models, verify what the model actually returns and extend the chain if needed — don't replace it blindly.

### Two-step LLM pipeline: classify → summarize

For each post with a non-empty `body`, `tracePost()` (`src/pipeline.ts`) runs `classifyPostDetailed()` first (`max_completion_tokens: 10`, one token `PASS`/`SKIP`), then — only if not `SKIP` — `summarizePostDetailed()`. Both take an options object (`{ ai, model, prompt, ... }`). Same model (GLM), different prompts. **Prompt pair is chosen per tag** via `resolvePrompts(config, tag)`: whitepaper feeds (`whitepaperFeeds`) get `whitepaperClassifierPrompt` / `whitepaperPrompt`; everything else gets `classifierPrompt` / `aiPrompt`. More reliable than one hybrid prompt: a small focused classifier task vs. a large multi-task summary.

The classifier returns `PASS` / `SKIP` / `UNKNOWN`. On `UNKNOWN` — fall through to summary (don't drop the post) + warning in Glitchtip. `SKIP` is sent silently as a bare header (by design; add logging behind a flag if you want visibility into false-positive skips).

Safety net: if the summary model still outputs `__SKIP_BULLETS__` (the prompt no longer mentions it), `tracePost()` (`src/pipeline.ts`) catches it and turns it into a bare header.

### Empty bullets are a feature — five causes

A post goes to Telegram as a bare header (`createPostMarkdown(post, "")`) in five cases:
1. `!post.body` — feed didn't return a body;
2. `post.body.length < minBodyChars` — body too short (e.g. reddit `[removed]` with template `[link] [comments]` ≈ 17 chars). Filtered **before** LLM calls so the model doesn't hallucinate content from the title alone;
3. `classification === "SKIP"` — classifier filtered it out;
4. `sanitizeBullets` rejected the output (CJK ≥2 chars or empty after normalization);
5. `bullets.trim() === "__SKIP_BULLETS__"` (legacy safety net).

Each case is logged via `logBareHeader()`: always `console.log('[bare-header] <reason>...')` (visible in `wrangler tail`), plus — for all except `classified_skip` — `captureException` with tag `reason` (groups in Glitchtip under a single issue "Post ended as bare header"). `classified_skip` is intentionally silent — too much filtered marketing would clutter the dashboard.

Do not add `continue` / skip logic: every post must reach the channel at least as a title with a link.

### Summary output sanitizer (`src/ai.ts`)

After `ai.run`, the result goes through `sanitizeBullets()`:
- `hasTooManyCJK` — if the text has ≥2 CJK characters (Chinese/Japanese/Korean), bullets are dropped entirely. Threshold `>=2` because the model hallucinates CJK in pairs (`全球`, `攻击`); a single character might be legitimate (author name, etc.).
- `stripMarkdown` — removes backticks, `**bold**`, `*italic*`, `## headings`, code fences. Reason: `parse_mode: html` in Telegram; markdown renders as literals.
- `normalizeBullets` — adds `- ` prefix to each non-empty line if the model forgot the format.

On rejection (CJK), `SummaryResult.rejectedReason = "cjk"` — this tag goes to Glitchtip as a warning to track frequency.

### KV cursor (news) vs link-dedup (whitepaper)

Two different dedup mechanisms by feed type:

**News feeds — date cursor.** `ctx.kv.updateValues(...)` in `finally` (`src/index.ts`) receives a **per-tag** `Record<string, Date>`. `buildCursorUpdates()` sets the cursor to `now` for **news tags only** (whitepaper tags are excluded). Only tags **not in `failedTags`** are updated. A tag is added to `failedTags` on (a) `fetchFeed` failure, (b) `bot.sendMessage` failure on a chunk that included a post from that tag.

**Whitepaper feeds — link-dedup (KV `seen`), NOT a date cursor.** arXiv gives every entry the same daily `pubDate` (verified) and re-announces old papers (v2/v3, cross-list) with today's date, so a date cursor can neither dedup re-announcements nor keep the same-date backlog. Instead `KV.updateSeen(sent, feedLinks)` stores, per whitepaper tag, the set of already-sent **links**, pruned to **what is currently in the feed**: `seen[tag] = uniq((seen ∪ sent) ∩ feedLinks)`. Retention needs no TTL/cap magic number — a link that dropped out of the feed can't be re-fetched, so it's forgotten; the set self-bounds to feed size. `getContent` filters posts with `link ∈ seen[tag]` before the `whitepaperMaxItemsPerRun` cap. Whitepaper tags therefore always fetch with `since = epoch` (no `ages[tag]` entry). Failure-mode: a link that left the feed and later reappears (weeks-later update) is re-sent once — treated as a legitimately-resurfaced new version.

Trade-off (both mechanisms): if one post from a tag fails but another from the same tag succeeds — the cursor / `seen` won't advance for that tag and the succeeded post is resent next run (duplicate). Deliberate: priority is not losing posts; a duplicate is acceptable.

### Telegram 4096 chars — `chunkParts` in `src/utils.ts`

`sendMessage` limit = 4096 UTF-16 code units. `postsPerMessage: 5` alone doesn't help: 5 posts with bold bullets exceed the limit and TG returns 400. `chunkParts()` splits a batch into sub-chunks ≤`TELEGRAM_MAX_MESSAGE`; if a single post is longer — truncates at the last `\n` with `…` suffix.

On send failure, the **chunk** fails, not the whole batch: only tags of posts in that chunk go into `failedTags`; other posts from the same batch may already have been sent by other chunks.

### Workers AI free tier — 10k neurons/day

Shared budget across models. Rough estimate at current cron schedule (`0,30 9-18 mon-fri`, ~20 runs): blog path ~2400 n/day (4× headroom); whitepaper feeds now run **every** invocation (3 feeds, `whitepaperMaxItemsPerRun` 10/tag) — classify is negligible (`max_completion_tokens: 10`), summarize is the cost (~40 n each) but bounded by the daily new-post count (arXiv ~59/day, most SKIP → maybe ~20–40 summarize/day). Still well under 10k — see **Quotas and limits** below. Recalculate when changing models, `updateCount`, `whitepaperMaxItemsPerRun`, or cron. Heavy models may not fit the daily limit at the current cron schedule.

### Reasoning models consume `max_completion_tokens` on thinking

GLM-4.7-flash and similar reasoning models default to `enable_thinking=true`. Budget goes to internal CoT, `choices[0].message.content` comes back empty — post is sent as a bare header with no errors in logs. Thinking isn't needed for bullet summaries: keep `chat_template_kwargs: { enable_thinking: false }` in `src/ai.ts`. When switching models — check the input schema for reasoning flags.

### Errors go to Glitchtip, not Sentry

`initSentry`, `ctx.sentry`, `env.SENTRY_DSN`, `toucan-js` — historical names; the DSN actually points to Glitchtip (Sentry-compatible). Error dashboard is Glitchtip, not sentry.io. When working with the SDK, remember Glitchtip covers only a subset of the Sentry API (performance, profiling, etc. may not work).

### Warning-level events don't reach Glitchtip

`scope.setLevel("warning")` + `scope.captureMessage(...)` in toucan-js/Glitchtip is **silently dropped** — 0 warning events in the dashboard over 90 days, only errors. Either toucan doesn't propagate level from scope to event, or Glitchtip filters them. Workaround: for "non-fatal but important" signals use `scope.captureException(new Error("Post ended as bare header: ..."))` — they arrive reliably, at the cost of appearing as errors in the dashboard. For grouping by cause use tag `reason` — Glitchtip filter `tag:reason:summary_cjk` works.

### Whitepaper sources (abstract-first)

Body comes straight from RSS where available; fuller text via `env.AI.toMarkdown()` when configured.

Feeds in `WHITEPAPER_FEEDS` (`src/config.ts`):
- **arXiv cs.CR** — **abstract-only** (string entry, no `readPdf`). The abstract is clean author-written know-how; the full PDF via `toMarkdown` is noisy and made the model return empty summaries (`finish_reason=missing`). `arxivPdfUrl()`/`readPdf` still exist but are unused by default — re-enable only with a fallback for empty output.
- **Google Research blog** — no body in RSS (only a category ~15 chars); fetches page before classify (`enrichBody: true`). URL uses trailing slash `…/blog/rss/` (avoids a redirect).
- **PortSwigger Research** — RSS teaser ~250 chars; fetches full page after PASS (`enrichAfterPass: true`)

**Moved out:** **Elastic Security Labs** → regular `feeds` (`FEEDS_PRODUCTION`), not a whitepaper source — it's a marketing/GA-heavy vendor blog. Goes through the strict news `CLASSIFIER_PROMPT` + shorter `AI_PROMPT`, no `#whitepaper` tag. **Rejected earlier:** IACR ePrint (pure theory + fetch issues).

Flow: `fetchFeed()` → `tracePost()`. Enrichment (`src/enrich.ts`): our `fetch(link)` → blob → `env.AI.toMarkdown()` — converter only, not a crawler. Runs before classify (missing body) or after PASS (PDF/full page). Budget: `pdfMaxItemsPerRun` (default 5/run) + KV neuron gate (`neuronGateThreshold` 8000, key `neurons:<UTC-date>`).

Whitepaper posts share the same `Post` type. Domain filter: `whitepaperClassifierPrompt` (strict on product/GA/tech-preview/marketing). Summary via `whitepaperPrompt` (know-how focus, 2–6 bullets). Input cap: `whitepaperMaxItemsPerRun` (10), **oldest-first**; body cap `whitepaperMaxBodyTotal` (4000, vs 10000 news) to curb long full-page summaries. CJK sanitizer uses the **default threshold 2** everywhere — the old per-whitepaper relaxed threshold was wrong (the sanitizer runs on the Russian *output*, not the source abstract, so CJK is always a hallucination).

Whitepaper feeds run **every cron invocation** (`processEvent`: `randomMapElements(config.feeds, ...)` is spread with the full `whitepaperFeedsAsUrls(config.whitepaperFeeds)`) — they're few, and the 50-subrequest cap forbids classifying a full day's arXiv in one run, so the daily backlog is drained across the ~20 runs/day within the feed's window.

### Prompt routing by tag

`isWhitepaperTag(config, tag)` and `resolvePrompts(config, tag)` in `src/pipeline.ts`. Whitepaper tags → `whitepaperClassifierPrompt` / `whitepaperPrompt`; else → default pair. Same check drives Telegram category tag (single source of truth).

### Category tag `#whitepaper` in Telegram

`createPostMarkdown(post, bullets, category?)` (`src/utils.ts`): whitepaper tags get `#whitepaper #<tag> <title>` instead of `#<tag> <title>`. Applied on bare headers too.

### Tag-scoped RSS feeds

`feeds` / `whitepaperFeeds` are already `tag → url`. Topic slices work as separate tags (e.g. `simonwillison.net/tags/security.atom`). Optional helper pattern: `tagFeeds(base, prefix, tags[])` in config. **Cross-feed dedup:** `fetchFeed` dedupes by `link` within one feed only; overlapping tag feeds from the same source may duplicate (same trade-off as resend-on-partial-failure).

### Quotas and limits (Cloudflare free tier)

| Limit | Free | Where it bites |
|-------|------|----------------|
| CPU per cron | 10 ms | XML parse + `stripHtml` on large feeds (arXiv ~50–100 entries) |
| Wall-time per cron | 15 min | Total fetch + AI per run |
| **Subrequests / invocation** | **50** | **Main ceiling** for future PDF stage |
| Workers AI neurons/day | 10 000 | Summarize; classify negligible |

Resets at **00:00 UTC**. Subrequests count: `fetch(feed)`, `fetch(pdf/page)`, `bot.sendMessage`, `ai.run`, `env.AI.toMarkdown()`.

**KV neuron counter:** `KV.neuronsKey()` → `neurons:<YYYY-MM-DD>` (UTC). `addNeuronEstimate()` after each post in cron; `canSpendNeurons()` gates enrich before `fetch`+`toMarkdown`. Estimate only (~2 classify, ~40 summarize per post), not exact billing.

**Enrich budget:** `pdfMaxItemsPerRun` (5) caps `fetch`+`toMarkdown` per cron/debug run — main guard on free-tier 50 subrequests/invocation.

### Debug endpoint — pipeline dry-run

`POST /debug/tag/:tag` (auth = same Bearer / `TELEGRAM_TOKEN` in prod; auth disabled in dev). Runs fetch → classify → summarize, returns JSON with `pipeline.step`, `feed_raw`, `classifier`, `summary`, `would_send`. **Does not send to Telegram, does not advance KV.** Works for both blog and whitepaper tags (`allFeeds`). Query: `?since=<ISO>` (cursor override), `?limit=N` (default 3, max 20). Post logic — `tracePost()` in `src/pipeline.ts` (same path as cron). Skill client: `dotenvx run -- node .claude/skills/debug/debug.mjs tag <tag>` — needs `TELEGRAM_TOKEN` in `.env` (same value as the worker secret; CLI doesn't read Cloudflare secrets). Example: `tag arxiv_cscr`.

### Running locally — three loops, fastest first

1. **Logic only (offline, no Cloudflare):** `npm test` / `npm run check`. Tests are plain `vitest run` — no config file, no workerd, no `@cloudflare/vitest-pool-workers` (not installed). They import `src/*` directly and run in node. This is the main inner loop; most pipeline logic (`sanitizeBullets`, `tracePost`, feed parsing, `chunkParts`) is covered here without booting a worker.
2. **Pipeline via `wrangler dev` (no Telegram, no KV writes):** terminal A `npm run dev` (dotenvx decrypts `.env` → `wrangler dev --port 3000`, `ENVIRONMENT=development` → `development` config branch: `authentication: false`, dev feeds, dev chatID). Terminal B: `RSSDOGE_BASE_URL=http://127.0.0.1:3000 dotenvx run -- node .claude/skills/debug/debug.mjs tag <tag>`. Uses the debug endpoint (above) — dry-run, no send, no cursor move.

**Gotcha — Workers AI has no local emulation.** `wrangler dev` proxies every `ai.run(...)` to the real Cloudflare API, so local dev needs an authenticated wrangler (`wrangler login`, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in env). Without it AI calls fail and posts come back as bare headers with no obvious error — the usual reason "local debug doesn't work". KV, in contrast, runs locally from `.wrangler/` (dev cursors, not prod).

**tsconfig `types`:** keep it at `["@cloudflare/workers-types"]`. Do **not** re-add `@cloudflare/vitest-pool-workers` or `vite/client` — neither is installed, and listing an uninstalled package in `types` makes `tsc` fail. The vitest pool isn't used (see loop 1).

### Deploy runs a gate: typecheck + tests

All of `src/` is TypeScript and `tsc --noEmit` is clean — keep it that way (no CI enforces it; the gate is at deploy time). `npm run deploy` runs `npm run check` (`tsc --noEmit` + `vitest run`) **and** the dry-run `build` before the real `wrangler deploy`; any failure aborts the deploy. Run `npm run check` yourself before finishing a change — a type error or a failing test will block the next manual deploy. Tests are in `tests/` (vitest): `sanitizeBullets`, `tracePost`, feed body extraction, and `chunkParts` / `createPostMarkdown` / `sortDate`.

Functions with many similar-typed params take an options object (`classifyPostDetailed`/`summarizePostDetailed` in `src/ai.ts`, `fetchFeed` in `src/feed.ts`) — pass named fields, not positional args.
