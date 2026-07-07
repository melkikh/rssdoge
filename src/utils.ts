import { Toucan } from 'toucan-js';
import type { Env } from "./config";

/** Newest first. Returns 0 for equal timestamps (a valid, consistent comparator). */
export function sortDate(a: { date: Date | string }, b: { date: Date | string }): number {
  return new Date(b.date).getTime() - new Date(a.date).getTime();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function createPostMarkdown(
  post: { title?: string; tag?: string; link: string },
  bullets: string,
  category?: "whitepaper",
): string {
  const title = escapeHtml(post.title || "");
  const tag = escapeHtml(post.tag || "");
  const categoryPrefix = category === "whitepaper" ? "#whitepaper " : "";
  const header = `${categoryPrefix}#${tag} <a href="${escapeHtml(post.link)}">${title}</a>`;
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


export function initSentry(request: unknown, env: Env, context: ExecutionContext): Toucan {
  return new Toucan({
    dsn: env.SENTRY_DSN,
    release: env.RELEASE,
    context,
    request: request as Request | undefined,
  });
}

/** Uniform Fisher–Yates pick of up to `count` entries — order of the result is random. */
export function randomMapElements(
  input: Record<string, string>,
  count: number,
): Record<string, string> {
  const keys = Object.keys(input);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  const result: Record<string, string> = {};
  for (const key of keys.slice(0, count)) result[key] = input[key];
  return result;
}
