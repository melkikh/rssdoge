#!/usr/bin/env node

const BASE = process.env.RSSDOGE_BASE_URL || "https://rss-doge.melkikh.workers.dev";
const TOKEN = process.env.TELEGRAM_TOKEN?.trim();

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const flags = { json: false, since: null, limit: null, model: null, classifierModel: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") flags.json = true;
    else if (a === "--since") flags.since = argv[++i];
    else if (a === "--limit") flags.limit = argv[++i];
    else if (a === "--model") flags.model = argv[++i];
    else if (a === "--classifier-model") flags.classifierModel = argv[++i];
    else positional.push(a);
  }
  return { flags, positional };
}

function printHuman(data) {
  console.log(
    `tag=${data.tag}  since=${data.since} (${data.since_source})  posts=${data.posts.length}  neurons~${data.neurons_estimate}`,
  );
  if (data.models) {
    console.log(`models: classify=${data.models.classifier}  summary=${data.models.summary}`);
  }
  console.log();

  data.posts.forEach((p, i) => {
    console.log(`[${i + 1}] ${p.title}`);
    console.log(`    step=${p.pipeline.step}  body=${p.body.length}  classifier=${p.classifier.classification}`);
    if (p.feed_raw) {
      console.log(`    feed_raw: ${p.feed_raw.content_type} field=${p.feed_raw.source_field} keys=${p.feed_raw.keys.join(",") || "-"}`);
    }
    if (p.summary.bullets) {
      const preview = p.summary.bullets.split("\n")[0].slice(0, 100);
      console.log(`    bullets: ${preview}${p.summary.bullets.length > 100 ? "…" : ""}`);
    } else if (p.pipeline.bare_header_reason) {
      console.log(`    bare_header: ${p.pipeline.bare_header_reason}`);
    }
    console.log();
  });
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [cmd, tag] = positional;

  if (cmd !== "tag" || !tag) {
    die(
      "usage: node debug.mjs tag <feed_tag> [--since ISO] [--limit N] [--model ID] [--classifier-model ID] [--json]\n" +
        "  env: TELEGRAM_TOKEN (required), RSSDOGE_BASE_URL (optional)",
    );
  }

  if (!TOKEN) {
    die(
      "TELEGRAM_TOKEN not set.\n" +
        "  Same bot token as the worker secret — add to .env for the CLI, or: export TELEGRAM_TOKEN=...\n" +
        "  Then: dotenvx run -- node .claude/skills/debug/debug.mjs tag <tag>",
    );
  }

  const params = new URLSearchParams();
  if (flags.since) params.set("since", flags.since);
  if (flags.limit) params.set("limit", flags.limit);
  if (flags.model) params.set("model", flags.model);
  if (flags.classifierModel) params.set("classifierModel", flags.classifierModel);

  const qs = params.toString();
  const url = `${BASE.replace(/\/$/, "")}/debug/tag/${encodeURIComponent(tag)}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  const data = await res.json();
  if (!res.ok) {
    die(`${res.status}: ${JSON.stringify(data)}`);
  }

  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    printHuman(data);
  }
}

main().catch((err) => die(String(err)));
