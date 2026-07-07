#!/usr/bin/env node
const BASE = "https://app.glitchtip.com/api/0";
const TOKEN = process.env.GLITCHTIP_TOKEN;
const ORG = process.env.GLITCHTIP_ORG;
const PROJECT = process.env.GLITCHTIP_PROJECT;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!TOKEN) die("GLITCHTIP_TOKEN not set. Run via `dotenvx run -- node ...` or export manually.");

async function api(path, init = {}, { soft = false } = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    if (soft) return null;
    die(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const fmt = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) : "");

function issueCount(i) {
  return Number(i.count) || 0;
}

function printIssueLine(i) {
  console.log(`${i.id}  [${i.level}]  x${i.count}  ${fmt(i.lastSeen)}  ${i.title || "(no title)"}`);
}

function requireProject() {
  if (!ORG || !PROJECT) die("GLITCHTIP_ORG and GLITCHTIP_PROJECT must be set");
}

function parseFlags(args) {
  const flags = { days: null, unresolved: false, tag: null, limit: null };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--days") flags.days = args[++i];
    else if (a === "--unresolved") flags.unresolved = true;
    else if (a === "--tag") flags.tag = args[++i];
    else if (a === "--limit") flags.limit = args[++i];
    else positional.push(a);
  }
  return { flags, positional };
}

function buildQuery(positional, flags) {
  let parts = positional.join(" ").trim();
  if (flags.tag) {
    const tagQuery = `tag:${flags.tag}`;
    parts = parts ? `${parts} ${tagQuery}` : tagQuery;
  }
  if (flags.unresolved) {
    parts = parts ? `${parts} is:unresolved` : "is:unresolved";
  }
  return parts;
}

async function fetchIssues(days, query = "", limit = 50) {
  return api(
    `/projects/${ORG}/${PROJECT}/issues/?query=${encodeURIComponent(query)}&statsPeriod=${days}d&limit=${limit}`,
  );
}

async function fetchLatestEventTags(issueId) {
  const ev = await api(`/issues/${issueId}/events/latest/`, {}, { soft: true });
  return ev?.tags ?? [];
}

async function mapInBatches(items, fn, batchSize = 8) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

function tagValue(tags, key) {
  const t = tags.find((x) => x.key === key);
  return t?.value ?? null;
}

function extraSnippet(ev) {
  const extra =
    ev.entries?.find((e) => e.type === "extra")?.data ?? ev.context ?? ev.contexts?.extra;
  if (!extra || !Object.keys(extra).length) return "";
  const parts = [];
  for (const k of ["title", "link", "body_length", "finish_reason"]) {
    if (extra[k] != null) parts.push(`${k}=${JSON.stringify(extra[k])}`);
  }
  if (parts.length) return parts.join(" ");
  const keys = Object.keys(extra).slice(0, 3);
  return keys.map((k) => `${k}=${JSON.stringify(extra[k])}`).join(" ");
}

function tagsSnippet(tags, keys = ["tag", "reason", "model"]) {
  return tags
    .filter((t) => keys.includes(t.key))
    .map((t) => `${t.key}=${t.value}`)
    .join(" ");
}

async function cmdList(args) {
  requireProject();
  const { flags } = parseFlags(args);
  const days = flags.days ?? "1";
  const query = buildQuery([], flags);
  const issues = await fetchIssues(days, query, 50);
  for (const i of issues) printIssueLine(i);
  const scope = flags.unresolved ? "unresolved" : "all";
  console.log(`\n${issues.length} issue(s), last ${days}d, ${scope}`);
}

async function cmdSearch(args) {
  requireProject();
  const { flags, positional } = parseFlags(args);
  const days = flags.days ?? "30";
  const query = buildQuery(positional, flags);
  const issues = await fetchIssues(days, query, 50);
  for (const i of issues) printIssueLine(i);
  console.log(`\n${issues.length} issue(s) for query: ${query || "(all)"}`);
}

async function cmdStats(args) {
  requireProject();
  const { flags } = parseFlags(args);
  const days = flags.days ?? "30";
  const issues = await fetchIssues(days, "", 50);

  const byLevel = {};
  const byTitle = new Map();
  let totalEvents = 0;

  for (const i of issues) {
    byLevel[i.level] = (byLevel[i.level] ?? 0) + 1;
    const n = issueCount(i);
    totalEvents += n;
    const title = i.title || "(no title)";
    byTitle.set(title, (byTitle.get(title) ?? 0) + n);
  }

  const tagCounts = new Map();
  await mapInBatches(issues, async (issue) => {
    const tags = await fetchLatestEventTags(issue.id);
    const feedTag = tagValue(tags, "tag");
    if (feedTag) tagCounts.set(feedTag, (tagCounts.get(feedTag) ?? 0) + issueCount(issue));
    return null;
  });

  const topTitles = [...byTitle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  console.log("by level:");
  for (const level of ["error", "warning", "info"]) {
    if (byLevel[level]) console.log(`  ${level}=${byLevel[level]}`);
  }
  for (const [level, n] of Object.entries(byLevel).sort()) {
    if (!["error", "warning", "info"].includes(level)) console.log(`  ${level}=${n}`);
  }

  if (tagCounts.size) {
    console.log("\nby tag:");
    for (const [tag, n] of [...tagCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${tag}=${n}`);
    }
  }

  console.log("\ntop titles:");
  for (const [title, n] of topTitles) {
    console.log(`  "${title}" x${n}`);
  }

  console.log(`\nissues: ${issues.length}  events: ${totalEvents}  period: ${days}d`);
}

async function cmdEvents(args) {
  const { flags, positional } = parseFlags(args);
  const id = positional[0];
  if (!id) die("usage: gt events <issue_id> [--limit N]");
  const limit = Math.min(parseInt(flags.limit ?? "10", 10) || 10, 50);
  const events = await api(`/issues/${id}/events/?limit=${limit}`);
  if (!events?.length) {
    console.log("no events");
    return;
  }
  for (const ev of events) {
    const when = fmt(ev.dateCreated ?? ev.dateReceived) || ev.id || "?";
    const tags = tagsSnippet(ev.tags ?? []);
    const extra = extraSnippet(ev);
    console.log(`${when}  [${ev.level ?? "?"}]  ${tags || "(no tags)"}`);
    if (extra) console.log(`  ${extra}`);
  }
  console.log(`\n${events.length} event(s)`);
}

async function cmdBytag(args) {
  requireProject();
  const { flags, positional } = parseFlags(args);
  const tagKey = positional[0];
  if (!tagKey) die("usage: gt bytag <tag_key> [--days N]");
  const days = flags.days ?? "30";
  const issues = await fetchIssues(days, "", 50);

  const groups = new Map();
  await mapInBatches(issues, async (issue) => {
    const tags = await fetchLatestEventTags(issue.id);
    const value = tagValue(tags, tagKey);
    if (!value) return null;
    if (!groups.has(value)) groups.set(value, { events: 0, ids: [] });
    const g = groups.get(value);
    g.events += issueCount(issue);
    if (g.ids.length < 5) g.ids.push(issue.id);
    return null;
  });

  console.log(`${tagKey}:`);
  for (const [value, g] of [...groups.entries()].sort((a, b) => b[1].events - a[1].events)) {
    console.log(`  ${value}  x${g.events}  (ids: ${g.ids.join(", ")})`);
  }
  console.log(`\n${groups.size} value(s), ${issues.length} issues scanned, ${days}d`);
}

async function cmdShow(args) {
  const id = args[0];
  if (!id) die("usage: gt show <issue_id>");
  const ev = await api(`/issues/${id}/events/latest/`);
  console.log(`# ${ev.title || ev.message || "(no title)"}`);
  console.log(`level=${ev.level}  platform=${ev.platform}  at=${fmt(ev.dateCreated)}`);

  if (ev.tags?.length) {
    console.log("\n## tags");
    for (const t of ev.tags) console.log(`  ${t.key}=${t.value}`);
  }

  const extraEntry =
    ev.entries?.find((e) => e.type === "extra")?.data ?? ev.context ?? ev.contexts?.extra;
  if (extraEntry && Object.keys(extraEntry).length) {
    console.log("\n## extra");
    console.log(JSON.stringify(extraEntry, null, 2));
  }

  const ex = ev.entries?.find((e) => e.type === "exception");
  if (ex?.data?.values?.length) {
    console.log("\n## exception");
    for (const v of ex.data.values) {
      console.log(`  ${v.type}: ${v.value}`);
      const frames = v.stacktrace?.frames || [];
      for (const f of frames.slice(-3).reverse()) {
        console.log(`    ${f.filename || "?"}:${f.lineno ?? "?"}  ${f.function || ""}`);
      }
    }
  }

  const bc = ev.entries?.find((e) => e.type === "breadcrumbs");
  if (bc?.data?.values?.length) {
    console.log("\n## breadcrumbs (last 5)");
    for (const b of bc.data.values.slice(-5)) {
      console.log(`  [${fmt(b.timestamp)}] ${b.category || ""}: ${b.message || ""}`);
    }
  }
}

const cmd = process.argv[2];
const args = process.argv.slice(3);

switch (cmd) {
  case "list":
    await cmdList(args);
    break;
  case "search":
    await cmdSearch(args);
    break;
  case "stats":
    await cmdStats(args);
    break;
  case "events":
    await cmdEvents(args);
    break;
  case "bytag":
    await cmdBytag(args);
    break;
  case "show":
    await cmdShow(args);
    break;
  case "resolve": {
    const id = args[0];
    if (!id) die("usage: gt resolve <issue_id>");
    await api(`/issues/${id}/`, { method: "PUT", body: JSON.stringify({ status: "resolved" }) });
    console.log(`resolved ${id}`);
    break;
  }
  case "orgs": {
    const orgs = await api(`/organizations/`);
    for (const o of orgs) {
      console.log(`org: ${o.slug}  (${o.name})`);
      const projects = await api(`/organizations/${o.slug}/projects/`);
      for (const p of projects) console.log(`  project: ${p.slug}  (${p.name})`);
    }
    break;
  }
  default:
    die(
      "usage: node gt.mjs <cmd> [args]\n" +
        "  list [--days N] [--unresolved]       issues, default all, 1d\n" +
        "  search <query> [--days N] [--unresolved] [--tag key:value]\n" +
        "  stats [--days N]                     aggregate by level/tag/title\n" +
        "  events <issue_id> [--limit N]        event history\n" +
        "  bytag <tag_key> [--days N]           group issues by tag value\n" +
        "  show <issue_id>                      latest event details\n" +
        "  resolve <issue_id>                   mark resolved\n" +
        "  orgs                                 list orgs + projects",
    );
}
