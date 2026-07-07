import { extract } from "@extractus/feed-extractor";

export type FeedRawMeta = {
  content_type: "string" | "object" | "undefined";
  source_field: "content:encoded" | "content" | "summary" | "description" | "none";
  keys: string[];
};

export type Post = {
  title: string | undefined;
  link: string;
  date: Date;
  tag: string;
  body: string;
  feedRaw?: FeedRawMeta;
};

export function coerceToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const text = (v as any)["#text"];
    if (typeof text === "string") return text;
  }
  return "";
}

function describeRawContent(raw: unknown): FeedRawMeta {
  if (typeof raw === "string") {
    return { content_type: "string", source_field: "none", keys: [] };
  }
  if (raw && typeof raw === "object") {
    return { content_type: "object", source_field: "none", keys: Object.keys(raw) };
  }
  return { content_type: "undefined", source_field: "none", keys: [] };
}

function pickRawContent(feedEntry: any): { raw: unknown; source_field: FeedRawMeta["source_field"] } {
  const { description, summary, "content:encoded": contentEncoded, content } = feedEntry;
  if (contentEncoded) return { raw: contentEncoded, source_field: "content:encoded" };
  if (content) return { raw: content, source_field: "content" };
  if (summary) return { raw: summary, source_field: "summary" };
  if (description) return { raw: description, source_field: "description" };
  return { raw: "", source_field: "none" };
}

function stripHtml(raw: unknown, limit: number): string {
  const text = coerceToString(raw);
  if (!text) return "";
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/** Shared body + feedRaw extraction: used by fetchFeed's getExtraEntryFields and by tests/debug. */
export function entryBodyFromFeedEntry(
  feedEntry: Record<string, unknown>,
  maxBodyTotal: number,
  captureRaw = false,
): { body: string; feedRaw?: FeedRawMeta } {
  const { raw, source_field } = pickRawContent(feedEntry);
  const feedRaw = captureRaw ? { ...describeRawContent(raw), source_field } : undefined;
  return { body: stripHtml(raw, maxBodyTotal), feedRaw };
}

export async function fetchFeed(
  url: string,
  opts: {
    since: Date;
    tag: string;
    maxBodyTotal: number;
    timeoutMs: number;
    captureRaw?: boolean;
  },
) {
  const { since, tag, maxBodyTotal, timeoutMs, captureRaw = false } = opts;
  console.log(`[fetchFeed] start to fetch feed: ${url} since ${since}`);

  const response = await extract(
    url,
    {
      xmlParserOptions: {
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
      },
      getExtraEntryFields: (feedEntry) => {
        const { link } = feedEntry as any;
        const { body, feedRaw } = entryBodyFromFeedEntry(
          feedEntry as Record<string, unknown>,
          maxBodyTotal,
          captureRaw,
        );
        return {
          links: Array.isArray(link)
            ? link.reduce((acc, cur) => {
                if (cur["@_rel"] === "alternate") {
                  return [...acc, cur["@_href"]];
                }
                return acc;
              }, [])
            : [],
          body,
          feedRaw,
        };
      },
    },
    {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; rssdoge/1.0; +https://rss-doge.melkikh.workers.dev/)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
      },
    },
  );

  const posts: Post[] = [];
  if (!response.entries) return posts;

  const uniqueLinks = new Set();
  for (let item of response.entries) {
    const candidate: Post = {
      title: item.title,
      link: (item as any).links?.length > 0 ? (item as any).links[0] : item.link,
      date: new Date(item.published ?? 0),
      tag: tag,
      body: (item as any).body || "",
      feedRaw: (item as any).feedRaw,
    };

    if (candidate.date <= since || uniqueLinks.has(candidate.link)) {
      continue;
    }

    posts.push(candidate);
    uniqueLinks.add(candidate.link);
  }

  console.log(`Feed was fetched successfully: ${tag} (${posts.length} posts)`);
  return posts;
}
