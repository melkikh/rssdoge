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
  return `${header}\n${escapeHtml(bullets)}`;
}

export const TELEGRAM_MAX_MESSAGE = 4096;

export interface PostPart {
  post: { tag: string };
  text: string;
}

export interface MessageChunk {
  text: string;
  posts: PostPart["post"][];
}

export function chunkParts(parts: PostPart[], max: number = TELEGRAM_MAX_MESSAGE): MessageChunk[] {
  const chunks: MessageChunk[] = [];
  let current: PostPart[] = [];
  let currentLen = 0;
  const SEP = "\n\n";

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      text: current.map(p => p.text).join(SEP),
      posts: current.map(p => p.post),
    });
    current = [];
    currentLen = 0;
  };

  for (const part of parts) {
    const addLen = part.text.length + (current.length > 0 ? SEP.length : 0);
    if (part.text.length > max) {
      flush();
      chunks.push({ text: truncateOnNewline(part.text, max), posts: [part.post] });
      continue;
    }
    if (currentLen + addLen > max) flush();
    current.push(part);
    currentLen += part.text.length + (current.length > 1 ? SEP.length : 0);
  }
  flush();
  return chunks;
}

function truncateOnNewline(text: string, max: number): string {
  if (text.length <= max) return text;
  const suffix = "\n…";
  const room = max - suffix.length;
  const cut = text.slice(0, room);
  const lastNewline = cut.lastIndexOf("\n");
  if (lastNewline > 0) return cut.slice(0, lastNewline) + suffix;
  return cut + suffix;
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
