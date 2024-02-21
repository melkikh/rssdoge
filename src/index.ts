import { Router, error, json, text, withParams } from "itty-router";
import { config } from "./config";
import { Telegram } from "./telegram";
import { fetchFeed } from "./feed"
import { sortDate, buildProxyURL, createPostMarkdown } from "./utils"

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
  const lastUpdate = await env.RSSDOGE.get("last-update-date");
  return json({status: lastUpdate})
}

async function refreshHandler(request, env, ctx) {
  const lastUpdate = await processEvent({}, env, ctx);
  return json({status: lastUpdate})
}

async function proxyHandler(request, env, ctx) {
  const feeds = ctx.config.feeds;
  const { feed } = request;

  const remoteUrl = feeds[feed];
  if (!remoteUrl) return error(404, "Not found");

  const response = await fetch(remoteUrl, {
    cf: {
      cacheTtl: 60 * 60,
      cacheEverything: true,
    },
  });
  return response;
}


async function processEvent(event, env, ctx) {
  const sinceRaw = await env.RSSDOGE.get("last-update-date");
  const sinceDate = sinceRaw !== null ? new Date(sinceRaw) : new Date(0);
  const now = new Date();
  const feeds = ctx.config.feeds;
  const bot = new Telegram({
    token: ctx.config.telegramToken,
    chatID: ctx.config.telegramChatID,
  });

  let content = [];
  for (const tag of Object.keys(feeds)) {
    try {
      const url = buildProxyURL(ctx.config.baseURL, tag);
      const items = await fetchFeed(url, tag, sinceDate);
      content.push(...items);
    } catch (error) {
      console.log(`Failed to fetch ${tag}: ${error.message}`);
    }
  }

  content.sort(sortDate);

  for (const post of content) {
    const text = createPostMarkdown(post);
    try {
      await bot.sendMessage(text);
    } catch (error) {
      console.log(`Failed to send message to Telegram: ${error.message}`);
    }
  }

  const newDate = now.toISOString();
  await env.RSSDOGE.put("last-update-date", newDate);
  return newDate;
}

const router = Router({ base: "/" });

router
  .get("/ping", () => text("pong"))
  .get("/", statusHandler)
  .get("/proxy/:feed", withParams, proxyHandler)
  .post("/refresh", authMiddleware, refreshHandler)
  .all("*", () => error(404));

export default {
  async fetch (request, env, context) {
    context.config = config(env);
    return await router.handle(request, env, context).then(json).catch(error)
  },
  async scheduled (event, env, context) {
    context.config = config(env);
    return await processEvent(event, env, context)
  }
};
