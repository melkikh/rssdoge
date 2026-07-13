import '@cloudflare/workers-types';
import { Router, error, json, type IRequest } from "itty-router";
import type { Toucan } from "toucan-js";
import config, { type Env, type AppConfig } from "./config";
import { Telegram } from "./telegram";
import { KV } from "./kv";
import { fetchFeed } from "./feed";
import type { Post } from "./feed";
import { feedsAsUrls, resolveFeed, arxivPdfUrl } from "./enrich";
import { sortDate, createPostMarkdown, initSentry, randomMapElements, chunkParts } from "./utils";
import { tracePost, bodyPreview, estimateNeurons, feedFor, buildCursorUpdates } from "./pipeline";
import type { PostTrace } from "./pipeline";
import { buildTagStatuses, renderStatusHtml } from "./status";

/** Cloudflare's ExecutionContext with the app singletons we attach per request/cron. */
type Ctx = ExecutionContext & {
  config: AppConfig;
  kv: KV;
  sentry: Toucan;
};

/** Oldest-first cap for feeds that set `maxItems` (link-dedup drain); others pass through. */
function limitPosts(posts: Post[], tag: string, config: AppConfig): Post[] {
  const max = feedFor(config, tag)?.maxItems;
  if (max === undefined) return posts;
  return [...posts]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, max);
}

function postCategory(config: AppConfig, tag: string): "whitepaper" | undefined {
  return feedFor(config, tag)?.category;
}

// Telegram href for a post: PDF for pdfLink feeds (arXiv), page otherwise.
// post.link stays canonical (dedup); only the displayed link changes. See CLAUDE.md.
function displayLink(config: AppConfig, post: Post): string {
  if (!feedFor(config, post.tag)?.pdfLink) return post.link;
  return arxivPdfUrl(post.link) ?? post.link;
}

const authMiddleware = (request: IRequest, env: Env, ctx: Ctx) => {
  const authn = ctx.config.authentication;
  if (!authn) return;

  const secret = ctx.config.telegramToken;
  if (!secret) return error(500, "Internal error");

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return error(401, "Unauthorized");

  const [tokenType, tokenValue] = authHeader.split(" ", 2);
  if (tokenType !== "Bearer") return error(401, "Unauthorized");

  const isValid = tokenType === "Bearer" && tokenValue == secret;
  if (!isValid) return error(401, "Unauthorized");
};

async function versionHandler(request: IRequest, env: Env) {
  return json({
    built_at: env.BUILD_TIME ?? null,
    release: env.RELEASE ?? null,
    environment: env.ENVIRONMENT ?? null,
  });
}

async function indexHandler(request: IRequest, env: Env, ctx: Ctx) {
  const [stats, ages, seen, neuronsToday] = await Promise.all([
    ctx.kv.getStats(),
    ctx.kv.getAll(),
    ctx.kv.getSeen(),
    ctx.kv.getNeuronEstimate(),
  ]);
  const tags = buildTagStatuses(ctx.config, stats, ages, seen);

  const url = new URL(request.url);
  if (url.searchParams.get("format") === "json") {
    return json({
      last_run_at: stats?.lastRunAt ?? null,
      today: stats?.today ?? null,
      neurons_today: neuronsToday,
      neuron_daily_limit: ctx.config.neuronDailyLimit,
      tags,
    });
  }

  const html = renderStatusHtml(env, ctx.config, stats, tags, neuronsToday);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function getContent(
  ctx: Ctx,
  feeds: Record<string, string>,
  ages: Record<string, string>,
  seen: Record<string, string[]>,
  now: Date,
) {
  const failedTags = new Set<string>();
  // Full link set per link-dedup feed (pre-filter), used to prune KV `seen` to the feed.
  const feedLinksByTag: Record<string, string[]> = {};
  const lookbackFloor = now.getTime() - ctx.config.maxLookbackDays * 86_400_000;
  const results = await Promise.all(
    Object.keys(feeds).map(async (tag) => {
      const linkDedup = feedFor(ctx.config, tag)?.dedup === "link";
      // Never look back further than the lookback floor: caps backlog when the KV cursor is
      // stale (a frozen cursor otherwise snowballs into runs too big to finish). See CLAUDE.md.
      const cursor = ages[tag] ? new Date(ages[tag]).getTime() : 0;
      const sinceDate = linkDedup ? new Date(0) : new Date(Math.max(cursor, lookbackFloor));
      try {
        const url = feeds[tag];
        const start = performance.now();
        const items = await fetchFeed(url, {
          since: sinceDate,
          tag,
          maxBodyTotal: ctx.config.maxBodyTotal,
          timeoutMs: ctx.config.feedTimeoutMs,
        });
        const end = performance.now();
        console.log(`Fetching '${tag}' feed took ${end - start}ms`);
        if (!linkDedup) return items;
        feedLinksByTag[tag] = items.map((p) => p.link);
        const seenSet = new Set(seen[tag] ?? []);
        const fresh = items.filter((p) => !seenSet.has(p.link));
        return limitPosts(fresh, tag, ctx.config);
      } catch (err) {
        ctx.sentry.captureException(new Error(`Failed to fetch '${tag}' feed`, { cause: err }));
        failedTags.add(tag);
        return [];
      }
    }),
  );

  const content = results.flat();
  content.sort(sortDate);
  return { content, failedTags, feedLinksByTag };
}

const ALERT_REASONS = new Set(["no_body", "body_too_short", "classified_unknown", "summary_empty", "summary_cjk"]);

function logBareHeader(ctx: Ctx, post: Post, reason: string, extra?: Record<string, any>) {
  const bodyLen = post.body?.length ?? 0;
  console.log(`[bare-header] ${reason} [${post.tag}] '${post.title}' body_len=${bodyLen}`);
  if (!ALERT_REASONS.has(reason)) return;
  ctx.sentry.withScope(scope => {
    scope.setTag("tag", post.tag);
    scope.setTag("reason", reason);
    scope.setExtra("title", post.title ?? "");
    scope.setExtra("link", post.link);
    scope.setExtra("body_length", bodyLen);
    if (extra) for (const [k, v] of Object.entries(extra)) scope.setExtra(k, v);
    scope.captureException(new Error(`Post ended as bare header: ${reason}`));
  });
}

function logTraceBareHeaders(ctx: Ctx, post: Post, trace: PostTrace) {
  for (const reason of trace.pipeline.logged_reasons) {
    const extra =
      reason === "summary_empty" || reason === "summary_cjk"
        ? {
            finish_reason: trace.summary.finish_reason ?? "missing",
            classification: trace.classifier.classification,
          }
        : undefined;
    logBareHeader(ctx, post, reason, extra);
  }
}

// Log-only quality signal on a sent post (not a bare header): stray Latin inside a
// Cyrillic word. Measured now to size the problem; escalate to a summarize-retry if
// it turns out frequent. Grouped in Glitchtip under tag reason:mixed_script. See CLAUDE.md.
function logMixedScript(ctx: Ctx, post: Post, trace: PostTrace) {
  const tokens = trace.summary.mixed_script;
  if (!tokens || tokens.length === 0) return;
  console.log(`[mixed-script] [${post.tag}] '${post.title}' tokens=${tokens.join(",")}`);
  ctx.sentry.withScope(scope => {
    scope.setTag("tag", post.tag);
    scope.setTag("reason", "mixed_script");
    scope.setExtra("title", post.title ?? "");
    scope.setExtra("link", post.link);
    scope.setExtra("tokens", tokens.join(", "));
    scope.setExtra("model", ctx.config.summaryModel);
    scope.captureException(new Error(`Summary has mixed-script tokens: ${tokens.slice(0, 5).join(", ")}`));
  });
}

function formatDebugPost(post: Post, trace: PostTrace, config: AppConfig) {
  const category = postCategory(config, post.tag);
  return {
    title: post.title,
    link: post.link,
    date: post.date.toISOString(),
    body: bodyPreview(post.body),
    feed_raw: post.feedRaw ?? null,
    pipeline: trace.pipeline,
    classifier: trace.classifier,
    summary: trace.summary,
    enrich: trace.enrich ?? null,
    would_send: createPostMarkdown(post, trace.bullets, category, displayLink(config, post)),
  };
}

async function debugTagHandler(request: IRequest, env: Env, ctx: Ctx) {
  const tag = request.params?.tag;
  const feeds = feedsAsUrls(ctx.config.feeds);

  if (!tag || !feeds[tag]) {
    return json({ error: "unknown tag", tag }, { status: 400 });
  }

  const feedUrl = feeds[tag];
  const url = new URL(request.url);
  const limitParam = parseInt(url.searchParams.get("limit") || "3", 10);
  const limit = Math.min(Math.max(limitParam || 3, 1), 20);

  // Model overrides for A/B testing candidate models — ?model= swaps summarize
  // (the CJK-prone stage), ?classifierModel= swaps classify. See CLAUDE.md.
  const summaryModel = url.searchParams.get("model") ?? undefined;
  const classifierModel = url.searchParams.get("classifierModel") ?? undefined;

  const ages = await ctx.kv.getAll();
  let since: Date;
  let since_source: "query" | "kv" | "epoch";
  const sinceParam = url.searchParams.get("since");
  if (sinceParam) {
    since = new Date(sinceParam);
    since_source = "query";
  } else if (ages[tag]) {
    since = new Date(ages[tag]);
    since_source = "kv";
  } else {
    since = new Date(0);
    since_source = "epoch";
  }

  let posts: Post[];
  try {
    posts = await fetchFeed(feedUrl, {
      since,
      tag,
      maxBodyTotal: ctx.config.maxBodyTotal,
      timeoutMs: ctx.config.feedTimeoutMs,
      captureRaw: true,
    });
  } catch (err) {
    return json({ error: String(err), tag, feed_url: feedUrl }, { status: 502 });
  }

  posts.sort(sortDate);
  posts = posts.slice(0, limit);

  const enrichBudget = { remaining: ctx.config.pdfMaxItemsPerRun, spent: 0 };

  const traces = await Promise.all(
    posts.map(async (post) => {
      const trace = await tracePost(post, env, { ...ctx, enrichBudget }, {
        skipSentry: true,
        skipNeuronAccounting: true,
        classifierModel,
        summaryModel,
      });
      return formatDebugPost(post, trace, ctx.config);
    }),
  );

  return json({
    tag,
    feed_url: feedUrl,
    since: since.toISOString(),
    since_source,
    models: {
      classifier: classifierModel ?? ctx.config.classifierModel,
      summary: summaryModel ?? ctx.config.summaryModel,
    },
    posts: traces,
    neurons_estimate: estimateNeurons(
      traces.map((p) => ({ pipeline: p.pipeline })),
    ),
    enrich_spent: enrichBudget.spent,
    dry_run: true,
  });
}

async function processEvent(event: ScheduledController, env: Env, ctx: Ctx) {
  const now = new Date();
  const bot = new Telegram({
    token: ctx.config.telegramToken,
    chatID: ctx.config.telegramChatID,
  });
  const ages = await ctx.kv.getAll();
  const seen = await ctx.kv.getSeen();
  // Sampled feeds picked randomly; `alwaysRun` feeds run every time (see CLAUDE.md).
  const sampledUrls: Record<string, string> = {};
  const alwaysRunUrls: Record<string, string> = {};
  for (const [tag, entry] of Object.entries(ctx.config.feeds)) {
    const resolved = resolveFeed(entry);
    (resolved.alwaysRun ? alwaysRunUrls : sampledUrls)[tag] = resolved.url;
  }
  const feeds = {
    ...randomMapElements(sampledUrls, ctx.config.updateCount),
    ...alwaysRunUrls,
  };
  const { content, failedTags, feedLinksByTag } = await getContent(ctx, feeds, ages, seen, now);
  const fetchedTags = new Set(content.map((p) => p.tag));
  // Oldest-first drain, then a hard per-run cap: bounds subrequests so the run finishes and
  // its `finally` KV writes land. Cut posts are re-fetched next run (cursor advances only to
  // what we processed). See CLAUDE.md.
  content.sort((a, b) => a.date.getTime() - b.date.getTime());
  const posts = content.slice(0, ctx.config.maxPostsPerRun);
  const ranTags = Object.keys(feeds).filter((t) => !failedTags.has(t));
  const postsByTag: Record<string, { count: number; maxDate: Date }> = {};
  for (const post of content) {
    const prev = postsByTag[post.tag];
    if (!prev) {
      postsByTag[post.tag] = { count: 1, maxDate: post.date };
    } else {
      prev.count++;
      if (post.date > prev.maxDate) prev.maxDate = post.date;
    }
  }
  const sentLinksByTag: Record<string, string[]> = {};
  // Newest post date we actually processed, per date-dedup tag → the cursor we persist.
  const maxProcessedDate: Record<string, Date> = {};
  const enrichBudget = { remaining: ctx.config.pdfMaxItemsPerRun, spent: 0 };
  // Accumulated in memory, flushed once in `finally` — a per-post KV write here burns
  // 2 subrequests/post toward the 50/invocation cap and, uncaught, could abort the run
  // and drop the `seen` write. See CLAUDE.md.
  let neuronDelta = 0;

  try {
    for (let i = 0; i < posts.length; i += ctx.config.postsPerMessage) {
      const batch = posts.slice(i, i + ctx.config.postsPerMessage);
      const parts: { post: Post; text: string }[] = [];

      for (const post of batch) {
        const trace = await tracePost(post, env, { ...ctx, enrichBudget });
        neuronDelta += estimateNeurons([trace]);
        logTraceBareHeaders(ctx, post, trace);
        logMixedScript(ctx, post, trace);
        const category = postCategory(ctx.config, post.tag);
        parts.push({ post, text: createPostMarkdown(post, trace.bullets, category, displayLink(ctx.config, post)) });
        if (feedFor(ctx.config, post.tag)?.dedup === "link") {
          (sentLinksByTag[post.tag] ??= []).push(post.link);
        } else {
          const prev = maxProcessedDate[post.tag];
          if (!prev || post.date > prev) maxProcessedDate[post.tag] = post.date;
        }
      }

      if (parts.length === 0) continue;

      for (const chunk of chunkParts(parts)) {
        // Suppress the web-page preview when a PDF link (arXiv) is in the chunk, so Telegram
        // doesn't try to render/fetch the PDF. sendMessage can't attach files regardless.
        const disablePreview = chunk.posts.some(p => feedFor(ctx.config, p.tag)?.pdfLink);
        try {
          await bot.sendMessage(chunk.text, { disablePreview });
        } catch (err) {
          const chunkTags = [...new Set(chunk.posts.map(p => p.tag))];
          ctx.sentry.captureException(new Error(`Failed to send message to Telegram [${chunkTags.join(', ')}]`, { cause: err }));
          for (const tag of chunkTags) failedTags.add(tag);
        }
      }
    }
  } finally {
    // Each KV write is isolated: one failing must not skip the others. Notably the date
    // cursor and the link-dedup `seen` are independent — a throw in `updateValues` used to
    // silently prevent `updateSeen`, resending link-dedup feeds (arXiv) forever. See CLAUDE.md.
    const successfulTags = Object.keys(feeds).filter(tag => !failedTags.has(tag));
    if (successfulTags.length > 0) {
      const updates = buildCursorUpdates(successfulTags, ctx.config, now, { maxProcessedDate, fetchedTags });
      if (Object.keys(updates).length > 0) {
        try {
          await ctx.kv.updateValues(updates);
        } catch (err) {
          ctx.sentry.captureException(new Error("Failed to persist date cursors", { cause: err }));
        }
      }
    }
    const sentForSuccess: Record<string, string[]> = {};
    const feedLinksForSuccess: Record<string, string[]> = {};
    for (const tag of Object.keys(feedLinksByTag)) {
      if (failedTags.has(tag)) continue;
      feedLinksForSuccess[tag] = feedLinksByTag[tag];
      if (sentLinksByTag[tag]) sentForSuccess[tag] = sentLinksByTag[tag];
    }
    if (Object.keys(feedLinksForSuccess).length > 0) {
      try {
        await ctx.kv.updateSeen(sentForSuccess, feedLinksForSuccess);
      } catch (err) {
        ctx.sentry.captureException(new Error("Failed to persist seen links", { cause: err }));
      }
    }
    if (neuronDelta > 0) {
      try {
        await ctx.kv.addNeuronEstimate(neuronDelta);
      } catch (err) {
        ctx.sentry.captureException(new Error("Failed to persist neuron estimate", { cause: err }));
      }
    }
    try {
      await ctx.kv.updateStats({ now, ranTags, postsByTag });
    } catch (err) {
      ctx.sentry.captureException(new Error("Failed to persist stats", { cause: err }));
    }
  }
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
    return await router.handle(request, env, ctx).then(json).catch(error);
  },
  async scheduled(event: ScheduledController, env: Env, context: ExecutionContext) {
    const ctx = context as Ctx;
    ctx.config = config(env);
    ctx.kv = new KV({ kv: env.RSSDOGE });
    ctx.sentry = initSentry(event, env, ctx);
    // scheduled() has no router/capture wrapper — an uncaught throw here (resource limit,
    // KV error) is invisible in Glitchtip. Capture, then rethrow so CF marks the cron failed.
    try {
      return await processEvent(event, env, ctx);
    } catch (err) {
      ctx.sentry.captureException(new Error("scheduled() failed", { cause: err }));
      throw err;
    }
  },
};
