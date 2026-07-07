---
name: glitchtip
description: Inspect Glitchtip (app.glitchtip.com) error logs for the rssdoge worker — list issues, stats, search by tags/level, event history, mark resolved. Use when the user asks about errors, observability, "что в glitchtip / в логах / почему упало" or wants to triage warnings. Glitchtip is Sentry-API-compatible; do NOT use a Sentry MCP or any other SDK.
---

# Glitchtip skill

Tiny Node script over the Glitchtip REST API. Zero external deps — uses stdlib `fetch`.

## Setup (one-time, by user)

1. Generate a personal API token: https://app.glitchtip.com/profile/auth-tokens. Scopes: `project:read`, `event:read`, `issue:write` (last one only if you want `resolve`).
2. Find org/project slugs — if unknown, run `orgs` once (see below).
3. Add to project `.env`:

   ```
   GLITCHTIP_TOKEN=<token>
   GLITCHTIP_ORG=<org-slug>
   GLITCHTIP_PROJECT=<project-slug>
   ```

   The project already uses `@dotenvx/dotenvx`, so this fits the existing pattern. If `.env` is dotenvx-encrypted, that's fine — `dotenvx run --` will decrypt at invocation time.

## How Claude should invoke it

Always wrap with `dotenvx run --` so env vars from `.env` are loaded:

```bash
dotenvx run -- node .claude/skills/glitchtip/gt.mjs <subcommand> [args]
```

If the user has already exported the vars in their shell, plain `node .claude/skills/glitchtip/gt.mjs ...` works too.

## Subcommands

- `list [--days N] [--unresolved]` — issues for the last N days (default 1). **By default shows all issues**, not only unresolved. Compact: `id  [level]  xCount  last_seen  title`.
- `search <query> [--days N] [--unresolved] [--tag key:value]` — Sentry-style query (default 30 days, empty query = all). Examples:
  - `search --unresolved`
  - `search --tag reason:summary_cjk`
  - `search 'tag:netsec' --days 7`
- `stats [--days N]` — one-shot overview: by level, by feed `tag`, top titles, total events (default 30d, up to 100 issues).
- `events <issue_id> [--limit N]` — event history (default 10): date, level, tags, extras snippet.
- `bytag <tag_key> [--days N]` — group issues by tag value (e.g. `bytag reason` for bare-header causes).
- `show <issue_id>` — latest event: tags, extras, last 3 stack frames, last 5 breadcrumbs.
- `resolve <issue_id>` — mark resolved. **Only on explicit user request.** Never auto-resolve as side-effect.
- `orgs` — list all orgs and their projects. Use once during setup to find slugs.

## Workflow

1. User asks about errors / logs / Glitchtip (e.g. "что в glitchtip", "посмотри ошибки") → start with `stats` or `list`.
2. `stats` first when you need level distribution or "are there any warnings".
3. Pick the most relevant issue → `show <id>` or `events <id>` if count grew.
4. Bare-header triage: `bytag reason` or `search --tag reason:summary_cjk`.
5. Cross-reference with code — tags include `tag` (feed name), `reason`, `model`, `finish_reason`; extras include `title`, `link`, `body_length`.

## What the skill is NOT for

- Don't use it to inspect production state, KV contents, Workers AI quotas, or Telegram queue — Glitchtip only knows about captured errors/messages.
- Don't auto-resolve issues to "clean up the dashboard" — that's a user decision.
- `stats` / `bytag` scan up to 100 issues and fetch latest event tags — slow but bounded.

## Quirks

- Glitchtip implements a subset of the Sentry API. Performance/profiling endpoints don't exist; some Sentry fields may be empty in `show` output (handled gracefully).
- `extra` data structure varies between event versions — script checks both `entries[type=extra]` and `context`/`contexts.extra`.
- Auth errors (401/403) usually mean the token has insufficient scopes or expired.
- Warning-level events may not appear in Glitchtip — see CLAUDE.md; bare-header signals use `captureException` as error.
