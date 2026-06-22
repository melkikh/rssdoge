import '@cloudflare/workers-types';
import { Router, error, json } from "itty-router";
import config from "./config";
import { Telegram } from "./telegram";
import { KV } from "./kv";
import { fetchFeed } from "./feed";
import { sortDate, createPostMarkdown, initSentry, randomMapElements } from "./utils";
import { summarizePost } from "./ai";

interface Env {
  RSSDOGE: KVNamespace;
  AI: Ai;
}


const authMiddleware = (request, env, ctx) => {
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

async function statusHandler(request, env, ctx) {
  const ages = await ctx.kv.getAll();
  return json(ages)
}

async function indexHandler(request, env, ctx) {
  const ages = await ctx.kv.getAll();
  const content = await getContent(ctx, ctx.config.feeds, ages);
  return json(content)
}

async function updateHandler(request, env, ctx) {
  await processEvent(request, env, ctx);
  return json({status: 'ok'})
}

async function getContent(ctx, feeds, ages) {
  const results = await Promise.all(
    Object.keys(feeds).map(async (tag) => {
      const sinceDate = ages[tag] ? new Date(ages[tag]) : new Date(0);
      try {
        const url = feeds[tag];
        const start = performance.now();
        const items = await fetchFeed(url, sinceDate, tag, ctx.config.maxBodyTotal, ctx.config.feedTimeoutMs);
        const end = performance.now();
        console.log(`Fetching '${tag}' feed took ${end - start}ms`);
        return items;
      } catch (err) {
        ctx.sentry.captureException(new Error(`Failed to fetch '${tag}' feed`, { cause: err }));
        return [];
      }
    }),
  );

  const content = results.flat();
  content.sort(sortDate);
  return content;
}

async function processEvent(event, env, ctx) {
  const now = new Date();
  const bot = new Telegram({
    token: ctx.config.telegramToken,
    chatID: ctx.config.telegramChatID,
  });
  const ages = await ctx.kv.getAll();
  const feeds = randomMapElements(ctx.config.feeds, ctx.config.updateCount);
  const content = await getContent(ctx, feeds, ages);

  try {
    for (let i = 0; i < content.length; i += ctx.config.postsPerMessage) {
      const batch = content.slice(i, i + ctx.config.postsPerMessage);
      const parts: string[] = [];

      for (const post of batch) {
        if (!post.body) {
          parts.push(createPostMarkdown(post, ""));
          continue;
        }
        let bullets = "";
        let finishReason: string | undefined;
        try {
          const res = await summarizePost(post, env.AI, ctx.config.aiModel, ctx.config.aiPrompt, ctx.config.maxBodyTotal, ctx.config.tailSize);
          bullets = res.bullets;
          finishReason = res.finishReason;
          if (!bullets) {
            ctx.sentry.withScope(scope => {
              scope.setLevel("warning");
              scope.setTag("tag", post.tag);
              scope.setTag("model", ctx.config.aiModel);
              scope.setTag("finish_reason", finishReason ?? "missing");
              scope.setExtra("title", post.title ?? "");
              scope.setExtra("link", post.link);
              scope.setExtra("body_length", post.body.length);
              scope.captureMessage(`Empty summary [${post.tag}] '${post.title}'`);
            });
          }
        } catch (err) {
          ctx.sentry.captureException(new Error(`Failed to summarize post '${post.title}' [${post.tag}]`, { cause: err }));
        }
        if (bullets.trim() === "__SKIP_BULLETS__") bullets = "";
        parts.push(createPostMarkdown(post, bullets));
      }

      if (parts.length > 0) {
        const message = parts.join("\n\n");
        try {
          await bot.sendMessage(message);
        } catch (err) {
          const batchTags = [...new Set(batch.map(p => p.tag))].join(', ');
          ctx.sentry.captureException(new Error(`Failed to send message to Telegram [${batchTags}]`, { cause: err }));
        }
      }
    }
  } finally {
    await ctx.kv.updateValues(Object.keys(feeds), now);
  }
}

const router = Router({ base: "/" });

router
  .get("/ping", statusHandler)
  .get("/", authMiddleware, indexHandler)
  .post("/update", authMiddleware, updateHandler)
  .all("*", () => error(404));

export default {
  async fetch (request, env, context) {
    context.config = config(env);
    context.kv = new KV({ kv: env.RSSDOGE });
    context.sentry = initSentry(request, env, context);
    return await router.handle(request, env, context).then(json).catch(error)
  },
  async scheduled (event, env, context) {
    context.config = config(env);
    context.kv = new KV({ kv: env.RSSDOGE });
    context.sentry = initSentry(event, env, context);
    return await processEvent(event, env, context)
  }
};
