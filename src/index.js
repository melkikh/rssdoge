import { extract } from "@extractus/feed-extractor";
import Telegram from "./telegram";

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  const request = event.request;
  const path = new URL(request.url).pathname;

  let lastUpdate;
  if (path === "/") {
    lastUpdate = await RSSDOGE.get("last-update-date");
  } else if (path === "/refresh" && request.method.toUpperCase() === "POST") {
    try {
      authenticate(request);
    } catch (error) {
      return new Response(error, { status: 401 });
    }
    lastUpdate = await handleScheduled(event);
  } else {
    return new Response(`Not found`, { status: 404 });
  }

  return new Response(`Feed was refreshed at ${lastUpdate}`, { status: 200 });
}

function authenticate(request) {
  const authzHeader = request.headers.get("Authorization");
  if (authzHeader === null) {
    throw "There is no Authorization header";
  }

  const [tokenType, tokenValue] = authzHeader.split(" ", 2);
  if (tokenType === "Bearer" && tokenValue === TELEGRAM_TOKEN) {
    return;
  } else {
    throw "Invalid Authorization header";
  }
}

addEventListener("scheduled", (event) => {
  event.waitUntil(handleScheduled(event));
});

async function handleScheduled(event) {
  const sinceRaw = await RSSDOGE.get("last-update-date");
  const sinceDate = sinceRaw !== null ? new Date(sinceRaw) : new Date(0);
  const now = new Date();
  const feeds = JSON.parse(FEEDS);
  const bot = new Telegram({
    token: TELEGRAM_TOKEN,
    chatID: TELEGRAM_CHANNEL,
  });

  const content = [];
  for (const [tag, url] of Object.entries(feeds)) {
    try {
      items = await fetchFeed(url, sinceDate, tag);
    } catch (error) {
      console.log(`Failed to fetch ${url}`);
      console.log(error);
    }
    content.push(...items);
  }

  content.sort((a, b) => {
    let aDate = new Date(a.date);
    let bDate = new Date(b.date);
    if (aDate < bDate) {
      return 1;
    } else if (aDate === bDate) {
      return 0;
    } else {
      return -1;
    }
  });

  for (const post of content) {
    const text = createPostMarkdown(post);
    try {
      await bot.sendMessage(text);
    } catch (error) {
      console.log(`Failed to send message to Telegram`);
      console.log(error);
    }
  }

  await RSSDOGE.put("last-update-date", now.toISOString());
  return now;
}

async function fetchFeed(url, since, tag) {
  console.log(`[fetchFeed] start to fetch feed: ${url} since ${since}`);

  const response = await extract(url);
  const posts = [];
  for (let item of response.entries) {
    const postDate = new Date(item.published);
    if (postDate > since) {
      posts.push({
        title: item.title,
        link: item.link,
        date: item.published,
        tag: tag,
      });
    }
  }
  console.log(`Feed was fetched successfully: ${tag} (${posts.length} posts)`);
  return posts;
}

function createPostMarkdown(post) {
  return `<b>${post.title}</b>
<a href="${post.link}">Read.</a>
    
- \#${post.tag}`;
}
