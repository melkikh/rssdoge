# rssdoge

Cloudflare Worker: on a cron schedule fetches RSS feeds, summarizes posts via Workers AI, sends to Telegram.

## Documentation language

| Location | Language |
|----------|----------|
| `CLAUDE.md`, `README.md`, `.claude/skills/**` | **English** |
| `plans/**` (local, gitignored) | **Russian** |

Technical identifiers (`KV`, `bare header`, `captureException`) stay as-is in any language.

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

For each post with a non-empty `body`, `tracePost()` (`src/pipeline.ts`) runs `classifyPostDetailed()` first (`max_completion_tokens: 10`, one token `PASS`/`SKIP`), then — only if not `SKIP` — `summarizePostDetailed()`. Both take an options object (`{ ai, model, prompt, ... }`). Same model (GLM), different prompts (`classifierPrompt` / `aiPrompt`). More reliable than one hybrid prompt: a small focused classifier task vs. a large multi-task summary.

The classifier returns `PASS` / `SKIP` / `UNKNOWN`. On `UNKNOWN` — fall through to summary (don't drop the post) + warning in Glitchtip. `SKIP` is sent silently as a bare header (by design; add logging behind a flag if you want visibility into false-positive skips).

Safety net: if the summary model still outputs `__SKIP_BULLETS__` (the prompt no longer mentions it), `index.ts` catches it and turns it into a bare header.

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

### KV cursor advances only for successful tags

`ctx.kv.updateValues(...)` in `finally` (`src/index.ts`) receives not all `Object.keys(feeds)`, but only those **not in `failedTags`**. A tag is added to `failedTags` on (a) `fetchFeed` failure, (b) `bot.sendMessage` failure on a chunk that included a post from that tag.

Trade-off: if one post from a tag fails but another from the same tag succeeds — the cursor won't move and the second post will be resent on the next cron run (duplicate). Deliberate choice: priority is not losing posts; a duplicate is acceptable. Per-post tracking would require a separate KV key per post.

### Telegram 4096 chars — `chunkParts` in `src/utils.ts`

`sendMessage` limit = 4096 UTF-16 code units. `postsPerMessage: 5` alone doesn't help: 5 posts with bold bullets exceed the limit and TG returns 400. `chunkParts()` splits a batch into sub-chunks ≤`TELEGRAM_MAX_MESSAGE`; if a single post is longer — truncates at the last `\n` with `…` suffix.

On send failure, the **chunk** fails, not the whole batch: only tags of posts in that chunk go into `failedTags`; other posts from the same batch may already have been sent by other chunks.

### Workers AI free tier — 10k neurons/day

Shared budget across models. Rough estimate at current cron schedule (`0,30 9-18 mon-fri`, 20 runs × ~3 posts × ~40 neurons) — ~2400 n/day, 4× headroom. Recalculate when changing models or increasing `updateCount`/`postsPerMessage`. The classifier is cheap (`max_completion_tokens: 10`), its contribution is negligible. Heavy models may not fit the daily limit at the current cron schedule.

### Reasoning models consume `max_completion_tokens` on thinking

GLM-4.7-flash and similar reasoning models default to `enable_thinking=true`. Budget goes to internal CoT, `choices[0].message.content` comes back empty — post is sent as a bare header with no errors in logs. Thinking isn't needed for bullet summaries: keep `chat_template_kwargs: { enable_thinking: false }` in `src/ai.ts`. When switching models — check the input schema for reasoning flags.

### Errors go to Glitchtip, not Sentry

`initSentry`, `ctx.sentry`, `env.SENTRY_DSN`, `toucan-js` — historical names; the DSN actually points to Glitchtip (Sentry-compatible). Error dashboard is Glitchtip, not sentry.io. When working with the SDK, remember Glitchtip covers only a subset of the Sentry API (performance, profiling, etc. may not work).

### Warning-level events don't reach Glitchtip

`scope.setLevel("warning")` + `scope.captureMessage(...)` in toucan-js/Glitchtip is **silently dropped** — 0 warning events in the dashboard over 90 days, only errors. Either toucan doesn't propagate level from scope to event, or Glitchtip filters them. Workaround: for "non-fatal but important" signals use `scope.captureException(new Error("Post ended as bare header: ..."))` — they arrive reliably, at the cost of appearing as errors in the dashboard. For grouping by cause use tag `reason` — Glitchtip filter `tag:reason:summary_cjk` works.

### Debug endpoint — pipeline dry-run

`POST /debug/tag/:tag` (auth = same Bearer / `TELEGRAM_TOKEN` in prod; auth disabled in dev). Runs fetch → classify → summarize, returns JSON with `pipeline.step`, `feed_raw`, `classifier`, `summary`, `would_send`. **Does not send to Telegram, does not advance KV.** Query: `?since=<ISO>` (cursor override), `?limit=N` (default 3, max 20). Post logic — `tracePost()` in `src/pipeline.ts` (same path as cron). Skill client: `dotenvx run -- node .claude/skills/debug/debug.mjs tag <tag>` — needs `TELEGRAM_TOKEN` in `.env` (same value as the worker secret; CLI doesn't read Cloudflare secrets).
