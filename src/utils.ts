import { Toucan } from 'toucan-js';

export function sortDate (a, b) {
  let aDate = new Date(a.date);
  let bDate = new Date(b.date);
  if (aDate < bDate) {
    return 1;
  } else if (aDate === bDate) {
    return 0;
  } else {
    return -1;
  }
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function createPostMarkdown(post, bullets: string): string {
  const title = escapeHtml(post.title || "");
  const tag = escapeHtml(post.tag || "");
  const header = `#${tag} <a href="${post.link}">${title}</a>`;
  if (!bullets) return header;
  return `${header}\n${bullets}`;
}


export function initSentry(request, env, context) {
  const sentry = new Toucan({
    dsn: env.SENTRY_DSN,
    release: '1.0.2',
    context,
    request,
  });
  return sentry;
};

export function randomMapElements(input, count) {
  const map = new Map(Object.entries(input));
  const keys = Array.from(map.keys());
  const shuffled = keys.sort(() => 0.5 - Math.random());
  const result = new Map(shuffled.slice(0, count).map(key => [key, map.get(key)]));
  return Object.fromEntries(result);
}
