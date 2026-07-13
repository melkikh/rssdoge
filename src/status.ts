import type { AppConfig, Env } from "./config";
import type { Stats } from "./kv";
import { feedFor } from "./pipeline";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

type Freshness = "fresh" | "aging" | "stale" | "unknown";

function freshnessBadge(lastPostAt: string | null): { label: string; cls: Freshness } {
  if (!lastPostAt) return { label: "no data", cls: "unknown" };
  const days = (Date.now() - new Date(lastPostAt).getTime()) / 86_400_000;
  const label = `${Math.floor(days)}d`;
  if (days < 2) return { label, cls: "fresh" };
  if (days < 7) return { label, cls: "aging" };
  return { label, cls: "stale" };
}

export interface TagStatus {
  tag: string;
  url: string;
  dedup: "date" | "link";
  updated_at: string | null;
  last_post_at: string | null;
  last_run_at: string | null;
  last_post_count: number | null;
  seen_count: number | null;
  freshness: Freshness;
}

export function buildTagStatuses(
  config: AppConfig,
  stats: Stats | null,
  ages: Record<string, string>,
  seen: Record<string, string[]>,
): TagStatus[] {
  return Object.keys(config.feeds)
    .map((tag) => {
      const feedStat = stats?.feeds[tag];
      const feed = feedFor(config, tag);
      const dedup = feed?.dedup ?? "date";
      const lastPostAt = feedStat?.lastPostAt ?? ages[tag] ?? null;
      return {
        tag,
        url: feed?.url ?? "",
        dedup,
        updated_at: ages[tag] ?? null,
        last_post_at: lastPostAt,
        last_run_at: feedStat?.lastRunAt ?? null,
        last_post_count: feedStat?.lastPostCount ?? null,
        seen_count: dedup === "link" ? (seen[tag]?.length ?? 0) : null,
        freshness: freshnessBadge(lastPostAt).cls,
      };
    })
    .sort((a, b) => {
      const ta = a.last_post_at ? new Date(a.last_post_at).getTime() : 0;
      const tb = b.last_post_at ? new Date(b.last_post_at).getTime() : 0;
      return ta - tb;
    });
}

export function renderStatusHtml(
  env: Env,
  config: AppConfig,
  stats: Stats | null,
  tags: TagStatus[],
  neuronsToday: number,
): string {
  const badgeColors: Record<Freshness, string> = {
    fresh: "#3d9970",
    aging: "#d4a017",
    stale: "#c0392b",
    unknown: "#666",
  };
  const neuronPct = Math.min(100, Math.round((neuronsToday / config.neuronDailyLimit) * 100));
  const rows = tags
    .map((t) => {
      const badge = freshnessBadge(t.last_post_at);
      const seenCol =
        t.dedup === "link"
          ? `<td class="num">${t.seen_count ?? 0}</td>`
          : `<td class="muted">—</td>`;
      return `<tr>
        <td><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener"><code>${escapeHtml(t.tag)}</code></a></td>
        <td>${formatTs(t.last_post_at)}</td>
        <td>${formatTs(t.last_run_at)}</td>
        <td class="num">${t.last_post_count ?? "—"}</td>
        ${seenCol}
        <td><span class="badge" style="background:${badgeColors[badge.cls]}">${badge.label}</span></td>
      </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rssdoge status</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #0d1117; color: #c9d1d9; margin: 0; padding: 1.5rem; line-height: 1.5; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 1rem; color: #e6edf3; }
  h1 a { color: inherit; text-decoration: none; }
  .meta { display: flex; flex-wrap: wrap; gap: 1rem 2rem; margin-bottom: 1.5rem; font-size: 0.85rem; color: #8b949e; }
  .meta strong { color: #c9d1d9; }
  .bar-wrap { margin-bottom: 1.5rem; }
  .bar-label { font-size: 0.85rem; margin-bottom: 0.35rem; color: #8b949e; }
  .bar { height: 8px; background: #21262d; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; background: #388bfd; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-weight: 500; }
  td.num { text-align: right; }
  td.muted { color: #484f58; text-align: center; }
  code { color: #79c0ff; }
  .badge { display: inline-block; padding: 0.1rem 0.45rem; border-radius: 3px; font-size: 0.7rem; color: #fff; }
  a { color: #58a6ff; }
</style>
</head>
<body>
<h1><a href="https://github.com/melkikh/rssdoge" target="_blank" rel="noopener">rssdoge</a></h1>
<div class="meta">
  <span><strong>env</strong> ${escapeHtml(env.ENVIRONMENT ?? "—")}</span>
  <span><strong>release</strong> ${escapeHtml(env.RELEASE ?? "—")}</span>
  <span><strong>built</strong> ${escapeHtml(env.BUILD_TIME ?? "—")}</span>
  <span><strong>last run</strong> ${formatTs(stats?.lastRunAt)}</span>
  <span><strong>runs today</strong> ${stats?.today.runs ?? 0}</span>
</div>
<div class="bar-wrap">
  <div class="bar-label">neurons today: ${neuronsToday} / ${config.neuronDailyLimit}</div>
  <div class="bar"><div class="bar-fill" style="width:${neuronPct}%"></div></div>
</div>
<table>
  <thead><tr>
    <th>tag</th><th>last post</th><th>last run</th><th>posts (last)</th><th>seen</th><th>freshness</th>
  </tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
<p style="margin-top:1.5rem;font-size:0.75rem;color:#484f58"><a href="?format=json">json</a></p>
</body>
</html>`;
}
