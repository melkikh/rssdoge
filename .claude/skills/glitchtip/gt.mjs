#!/usr/bin/env node
const BASE = "https://app.glitchtip.com/api/0";
const TOKEN = process.env.GLITCHTIP_TOKEN;
const ORG = process.env.GLITCHTIP_ORG;
const PROJECT = process.env.GLITCHTIP_PROJECT;

function die(msg) { console.error(msg); process.exit(1); }

if (!TOKEN) die("GLITCHTIP_TOKEN not set. Run via `dotenvx run -- node ...` or export manually.");

async function api(path, init = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) die(`${res.status} ${res.statusText}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

const fmt = (d) => d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) : "";

function printIssueLine(i) {
  console.log(`${i.id}  [${i.level}]  x${i.count}  ${fmt(i.lastSeen)}  ${i.title || "(no title)"}`);
}

function requireProject() {
  if (!ORG || !PROJECT) die("GLITCHTIP_ORG and GLITCHTIP_PROJECT must be set");
}

const cmd = process.argv[2];
const args = process.argv.slice(3);

switch (cmd) {
  case "list": {
    requireProject();
    const idx = args.indexOf("--days");
    const days = idx >= 0 ? args[idx + 1] : "1";
    const issues = await api(`/projects/${ORG}/${PROJECT}/issues/?query=${encodeURIComponent("is:unresolved")}&statsPeriod=${days}d&limit=50`);
    for (const i of issues) printIssueLine(i);
    console.log(`\n${issues.length} issue(s), last ${days}d, unresolved`);
    break;
  }

  case "search": {
    requireProject();
    const idx = args.indexOf("--days");
    const days = idx >= 0 ? args[idx + 1] : "30";
    const query = args.filter((a, i) => i !== idx && i !== idx + 1).join(" ") || "is:unresolved";
    const issues = await api(`/projects/${ORG}/${PROJECT}/issues/?query=${encodeURIComponent(query)}&statsPeriod=${days}d&limit=50`);
    for (const i of issues) printIssueLine(i);
    console.log(`\n${issues.length} issue(s) for query: ${query}`);
    break;
  }

  case "show": {
    const id = args[0];
    if (!id) die("usage: gt show <issue_id>");
    const ev = await api(`/issues/${id}/events/latest/`);
    console.log(`# ${ev.title || ev.message || "(no title)"}`);
    console.log(`level=${ev.level}  platform=${ev.platform}  at=${fmt(ev.dateCreated)}`);

    if (ev.tags?.length) {
      console.log("\n## tags");
      for (const t of ev.tags) console.log(`  ${t.key}=${t.value}`);
    }

    const extraEntry = ev.entries?.find(e => e.type === "extra")?.data
      ?? ev.context
      ?? ev.contexts?.extra;
    if (extraEntry && Object.keys(extraEntry).length) {
      console.log("\n## extra");
      console.log(JSON.stringify(extraEntry, null, 2));
    }

    const ex = ev.entries?.find(e => e.type === "exception");
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

    const bc = ev.entries?.find(e => e.type === "breadcrumbs");
    if (bc?.data?.values?.length) {
      console.log("\n## breadcrumbs (last 5)");
      for (const b of bc.data.values.slice(-5)) {
        console.log(`  [${fmt(b.timestamp)}] ${b.category || ""}: ${b.message || ""}`);
      }
    }
    break;
  }

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
    die("usage: node gt.mjs <cmd> [args]\n  list [--days N]              open issues, default 1d\n  search <query> [--days N]    sentry-style query, default 30d\n  show <issue_id>              latest event details\n  resolve <issue_id>           mark resolved\n  orgs                         list orgs + projects (first-time setup)");
}
