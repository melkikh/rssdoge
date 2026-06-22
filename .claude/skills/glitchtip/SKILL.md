---
name: glitchtip
description: Inspect Glitchtip (app.glitchtip.com) error logs for the rssdoge worker — list unresolved issues, fetch event details, search by tags/level, mark resolved. Use when the user asks about errors, observability, "что в glitchtip / в логах / почему упало" or wants to triage warnings. Glitchtip is Sentry-API-compatible; do NOT use a Sentry MCP or any other SDK.
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

- `list [--days N]` — open issues for the last N days (default 1). Compact one-line-per-issue output: `id  [level]  xCount  last_seen  title`.
- `search <query> [--days N]` — Sentry-style query (default 30 days). Examples:
  - `search 'is:unresolved level:warning'`
  - `search 'tag:netsec'`
  - `search 'model:"@cf/zai-org/glm-4.7-flash"'`
- `show <issue_id>` — latest event for that issue: tags, extras, last 3 stack frames, last 5 breadcrumbs. Trimmed to keep context lean.
- `resolve <issue_id>` — mark resolved. **Only on explicit user request.** Never auto-resolve as side-effect.
- `orgs` — list all orgs and their projects. Use once during setup to find slugs.

## Workflow

1. User asks "что в glitchtip" / "посмотри ошибки" / "почему упало" → start with `list`.
2. Pick the most relevant issue from the list (highest count, recent, or matching the user's question).
3. Deep-dive with `show <id>` for stack + tags + extras + breadcrumbs.
4. For targeted triage (e.g. the empty-summary warnings from `src/index.ts`): `search 'tag:<feed_tag> level:warning'`.
5. Cross-reference with code — tags include `tag` (feed name), `model`, `finish_reason`; extras include `title`, `link`, `body_length`.

## What the skill is NOT for

- Don't use it to inspect production state, KV contents, Workers AI quotas, or Telegram queue — Glitchtip only knows about captured errors/messages.
- Don't auto-resolve issues to "clean up the dashboard" — that's a user decision.
- Don't paginate beyond `limit=50` — if the user genuinely needs more, narrow with `search` instead.

## Quirks

- Glitchtip implements a subset of the Sentry API. Performance/profiling endpoints don't exist; some Sentry fields may be empty in `show` output (handled gracefully).
- `extra` data structure varies between event versions — script checks both `entries[type=extra]` and `context`/`contexts.extra`.
- Auth errors (401/403) usually mean the token has insufficient scopes or expired.
