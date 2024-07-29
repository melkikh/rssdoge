import '@cloudflare/workers-types';
import { Router, error, json } from "itty-router";
import config from "./config";
import { Telegram } from "./telegram";
import { KV } from "./kv";
import { fetchFeed } from "./feed";
import { sortDate, createPostMarkdown, initSentry, randomMapElements } from "./utils";

interface Env {
  RSSDOGE: KVNamespace;
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
  const now = new Date();
  const bot = new Telegram({
    token: ctx.config.telegramToken,
    chatID: ctx.config.telegramChatID,
  });
  const ages = await ctx.kv.getAll();
  const content = await getContent(ctx, ctx.config.feeds, ages);
  return json(content)
}

async function updateHandler(request, env, ctx) {
  await processEvent(request, env, ctx);
  return json({status: 'ok'})
}

async function getContent(ctx, feeds, ages) {
  let content = [];
  for (const tag of Object.keys(feeds)) {
    const sinceDate = ages[tag] ? new Date(ages[tag]) : new Date(0);
    try {
      const url = feeds[tag];
      const start = performance.now();
      const items = await fetchFeed(url, sinceDate, tag);
      const end = performance.now();
      console.log(`Fetching '${tag}' feed took ${end - start}ms`);
      content.push(...items);
    } catch (error) {
      ctx.sentry.captureException(new Error(`Failed to fetch '${tag}' feed`, { cause: error }));
    }
  }

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
  for (const post of content) {
    const text = createPostMarkdown(post);
    try {
      await bot.sendMessage(text);
    } catch (error) {
      ctx.sentry.captureException(new Error(`Failed to send message to Telegram`, { cause: error }));
    }
  }

  await ctx.kv.updateValues(Object.keys(feeds), now);
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
