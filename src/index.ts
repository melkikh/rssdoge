import '@cloudflare/workers-types';
import { Router, error, json, type IRequest } from "itty-router";
import type { Toucan } from "toucan-js";
import config, { type Env, type AppConfig } from "./config";
import { Telegram } from "./telegram";
import { KV } from "./kv";
import { fetchFeed } from "./feed";
import type { Post } from "./feed";
import { sortDate, createPostMarkdown, initSentry, randomMapElements, chunkParts } from "./utils";
import { tracePost, bodyPreview, estimateNeurons } from "./pipeline";
import type { PostTrace } from "./pipeline";

/** Cloudflare's ExecutionContext with the app singletons we attach per request/cron. */
type Ctx = ExecutionContext & {
  config: AppConfig;
  kv: KV;
  sentry: Toucan;
};

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
  const ages = await ctx.kv.getAll();
  const tags = Object.keys(ctx.config.feeds)
    .sort()
    .map((tag) => ({ tag, updated_at: ages[tag] ?? null }));
  return json({ tags });
}

async function getContent(ctx: Ctx, feeds: Record<string, string>, ages: Record<string, string>) {
  const failedTags = new Set<string>();
  const results = await Promise.all(
    Object.keys(feeds).map(async (tag) => {
      const sinceDate = ages[tag] ? new Date(ages[tag]) : new Date(0);
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
        return items;
      } catch (err) {
        ctx.sentry.captureException(new Error(`Failed to fetch '${tag}' feed`, { cause: err }));
        failedTags.add(tag);
        return [];
      }
    }),
  );

  const content = results.flat();
  content.sort(sortDate);
  return { content, failedTags };
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

function formatDebugPost(post: Post, trace: PostTrace) {
  return {
    title: post.title,
    link: post.link,
    date: post.date.toISOString(),
    body: bodyPreview(post.body),
    feed_raw: post.feedRaw ?? null,
    pipeline: trace.pipeline,
    classifier: trace.classifier,
    summary: trace.summary,
    would_send: createPostMarkdown(post, trace.bullets),
  };
}

async function debugTagHandler(request: IRequest, env: Env, ctx: Ctx) {
  const tag = request.params?.tag;
  const feeds = ctx.config.feeds;

  if (!tag || !feeds[tag]) {
    return json({ error: "unknown tag", tag }, { status: 400 });
  }

  const feedUrl = feeds[tag];
  const url = new URL(request.url);
  const limitParam = parseInt(url.searchParams.get("limit") || "3", 10);
  const limit = Math.min(Math.max(limitParam || 3, 1), 20);

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

  const traces = await Promise.all(
    posts.map(async (post) => {
      const trace = await tracePost(post, env, ctx, { skipSentry: true });
      return formatDebugPost(post, trace);
    }),
  );

  return json({
    tag,
    feed_url: feedUrl,
    since: since.toISOString(),
    since_source,
    posts: traces,
    neurons_estimate: estimateNeurons(
      traces.map((p) => ({ pipeline: p.pipeline })),
    ),
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
  const feeds = randomMapElements(ctx.config.feeds, ctx.config.updateCount);
  const { content, failedTags } = await getContent(ctx, feeds, ages);

  try {
    for (let i = 0; i < content.length; i += ctx.config.postsPerMessage) {
      const batch = content.slice(i, i + ctx.config.postsPerMessage);
      const parts: { post: Post; text: string }[] = [];

      for (const post of batch) {
        const trace = await tracePost(post, env, ctx);
        logTraceBareHeaders(ctx, post, trace);
        parts.push({ post, text: createPostMarkdown(post, trace.bullets) });
      }

      if (parts.length === 0) continue;

      for (const chunk of chunkParts(parts)) {
        try {
          await bot.sendMessage(chunk.text);
        } catch (err) {
          const chunkTags = [...new Set(chunk.posts.map(p => p.tag))];
          ctx.sentry.captureException(new Error(`Failed to send message to Telegram [${chunkTags.join(', ')}]`, { cause: err }));
          for (const tag of chunkTags) failedTags.add(tag);
        }
      }
    }
  } finally {
    const successfulTags = Object.keys(feeds).filter(tag => !failedTags.has(tag));
    if (successfulTags.length > 0) {
      await ctx.kv.updateValues(successfulTags, now);
    }
  }
}

const router = Router({ base: "/" });

router
  .get("/version", versionHandler)
  .get("/", authMiddleware, indexHandler)
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
    return await processEvent(event, env, ctx);
  },
};
