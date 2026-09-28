import "@cloudflare/workers-types";
import { Router, error, json, type IRequest } from "itty-router";
import type { Toucan } from "toucan-js";
import config, { type AppConfig, type Env } from "./config";
import { editorialGateDetailed } from "./ai";
import { passesQualityFloor } from "./curation";
import { fetchFeed } from "./feed";
import {
  enrichPostBody,
  getFeedConfig,
  primaryCategoryWeight,
  type EnrichBudget,
} from "./enrich";
import { KV } from "./kv";
import { runScheduled } from "./run";
import { buildTagStatuses, renderStatusHtml } from "./status";
import { initSentry, sortDate } from "./utils";

type Ctx = ExecutionContext & {
  config: AppConfig;
  kv: KV;
  sentry: Toucan;
};

const authMiddleware = (request: IRequest, _env: Env, ctx: Ctx) => {
  if (!ctx.config.authentication) return;
  if (!ctx.config.telegramToken) return error(500, "Internal error");
  const [type, value] = request.headers.get("Authorization")?.split(" ", 2) ?? [];
  if (type !== "Bearer" || value !== ctx.config.telegramToken) return error(401, "Unauthorized");
};

async function versionHandler(_request: IRequest, env: Env) {
  return json({
    built_at: env.BUILD_TIME ?? null,
    release: env.RELEASE ?? null,
    environment: env.ENVIRONMENT ?? null,
  });
}

async function indexHandler(request: IRequest, env: Env, ctx: Ctx) {
  const [stats, ages, seen, neuronsToday, curation] = await Promise.all([
    ctx.kv.getStats(),
    ctx.kv.getAll(),
    ctx.kv.getSeen(),
    ctx.kv.getNeuronEstimate(),
    ctx.kv.getCurationState(),
  ]);
  const tags = buildTagStatuses(ctx.config, stats, ages, seen);
  const pools = {
    stories: curation.candidates.filter((candidate) => candidate.kind !== "paper").length,
    papers: curation.candidates.filter((candidate) => candidate.kind === "paper").length,
    last_daily: curation.editions.daily ?? null,
    last_research: curation.editions.research ?? null,
    source_stats: curation.sourceStats,
  };

  const url = new URL(request.url);
  if (url.searchParams.get("format") === "json") {
    return json({
      last_run_at: stats?.lastRunAt ?? null,
      today: stats?.today ?? null,
      neurons_today: neuronsToday,
      neuron_daily_limit: ctx.config.neuronDailyLimit,
      curation: pools,
      tags,
    });
  }
  return new Response(renderStatusHtml(env, ctx.config, stats, tags, neuronsToday, pools), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function bodyPreview(body: string) {
  return {
    length: body.length,
    preview_head: body.slice(0, 160),
    preview_tail: body.length > 240 ? body.slice(-80) : "",
  };
}

async function debugTagHandler(request: IRequest, env: Env, ctx: Ctx) {
  const tag = request.params?.tag;
  const feed = tag ? getFeedConfig(ctx.config.feeds, tag) : null;
  if (!tag || !feed) return json({ error: "unknown tag", tag }, { status: 400 });

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "3", 10) || 3, 1), 10);
  const gateModel = url.searchParams.get("model") ?? ctx.config.gateModel;
  const ages = await ctx.kv.getAll();
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam
    ? new Date(sinceParam)
    : feed.dedup === "link"
      ? new Date(0)
      : new Date(ages[tag] ?? 0);

  let posts;
  try {
    posts = await fetchFeed(feed.url, {
      since,
      tag,
      maxBodyTotal: feed.maxBodyTotal ?? ctx.config.maxBodyTotal,
      timeoutMs: ctx.config.feedTimeoutMs,
      captureRaw: true,
    });
  } catch (err) {
    return json({ error: String(err), tag, feed_url: feed.url }, { status: 502 });
  }
  posts.sort(sortDate);
  const enrichBudget: EnrichBudget = { remaining: 2, spent: 0 };
  const results = [];
  for (const post of posts.slice(0, limit)) {
    const categoryWeight = feed.categoryPriority
      ? primaryCategoryWeight(post.categories?.[0], feed.categoryPriority)
      : null;
    const categoryDropped = categoryWeight !== null
      && categoryWeight < (feed.categoryPriorityThreshold ?? 0);
    let body = post.body;
    let enrich = null;
    if (feed.enrichBody) {
      enrich = await enrichPostBody(post.link, feed, env, {
        timeoutMs: ctx.config.feedTimeoutMs,
        budget: enrichBudget,
      });
      if (enrich.success) body = enrich.body;
    }
    let gate = null;
    if (!categoryDropped && post.title && body.length >= ctx.config.minBodyChars) {
      try {
        gate = await editorialGateDetailed(
          { title: post.title, body, source: tag, kind: feed.kind },
          {
            ai: env.AI,
            model: gateModel,
            prompt: ctx.config.editorialGatePrompt,
            maxBodyChars: ctx.config.gateMaxBodyChars,
          },
        );
      } catch (err) {
        gate = { verdict: null, rawOutput: "", error: String(err) };
      }
    }
    results.push({
      title: post.title,
      link: post.link,
      date: post.date.toISOString(),
      kind: feed.kind,
      tier: feed.tier,
      categories: post.categories ?? null,
      category_weight: categoryWeight,
      category_dropped: categoryDropped,
      body: bodyPreview(body),
      feed_raw: post.feedRaw ?? null,
      enrich,
      gate,
      would_pool: !!gate?.verdict && passesQualityFloor(feed.kind, gate.verdict),
    });
  }

  return json({
    tag,
    feed_url: feed.url,
    since: since.toISOString(),
    model: gateModel,
    posts: results,
    enrich_spent: enrichBudget.spent,
    dry_run: true,
  });
}

const router = Router({ base: "/" });
router
  .get("/version", versionHandler)
  .get("/", indexHandler)
  .post("/debug/tag/:tag", authMiddleware, debugTagHandler)
  .all("*", () => error(404));

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const ctx = context as Ctx;
    ctx.config = config(env);
    ctx.kv = new KV({ kv: env.RSSDOGE });
    ctx.sentry = initSentry(request, env, ctx);
    return router.handle(request, env, ctx).then(json).catch(error);
  },
  async scheduled(event: ScheduledController, env: Env, context: ExecutionContext) {
    const ctx = context as Ctx;
    ctx.config = config(env);
    ctx.kv = new KV({ kv: env.RSSDOGE });
    ctx.sentry = initSentry(event, env, ctx);
    try {
      await runScheduled(event, env, ctx);
    } catch (err) {
      ctx.sentry.captureException(new Error("scheduled() failed", { cause: err }));
      throw err;
    }
  },
};
