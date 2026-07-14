// One feed map, one entry type. Bare string = blog with all defaults; object overrides only what differs.
export type FeedEntry =
  | string // blog: date dedup, news prompts, random sampling, no enrichment
  | {
      url: string;
      enrichBody?: boolean;      // fetch page BEFORE classify if body is empty/short (Google)
      enrichAfterPass?: boolean; // fetch full page AFTER PASS (teaser-only RSS: PortSwigger)
      readPdf?: boolean;         // fetch PDF after PASS (arXiv abs→pdf); currently off, see CLAUDE.md
      pdfLink?: boolean;         // Telegram link points at the PDF instead of the article page (arXiv abs→pdf)
      dedup?: "date" | "link";   // "date" — date cursor (default); "link" — by links (arXiv: identical pubDate)
      prompts?: "news" | "whitepaper" | "essay"; // classifier+summary pair (default "news"); "essay" — opinion columns (Schneier, Venables)
      category?: "whitepaper";   // add the #whitepaper tag to the Telegram header
      alwaysRun?: boolean;       // run on every cron invocation, bypassing random sampling (backlog drain)
      maxItems?: number;         // cap posts/run, oldest-first (drain for link dedup)
      maxBodyTotal?: number;     // override the body limit for summarization (default config.maxBodyTotal)
      dropOnSkip?: boolean;      // classifier SKIP → drop entirely, don't send as a bare header (arXiv); still marked seen. See CLAUDE.md
    };

export type ResolvedFeed = {
  url: string;
  readPdf: boolean;
  pdfLink: boolean;
  enrichBody: boolean;
  enrichAfterPass: boolean;
  dedup: "date" | "link";
  prompts: "news" | "whitepaper" | "essay";
  category?: "whitepaper";
  alwaysRun: boolean;
  maxItems?: number;
  maxBodyTotal?: number;
  dropOnSkip: boolean;
};

export function resolveFeed(entry: FeedEntry): ResolvedFeed {
  if (typeof entry === "string") {
    return {
      url: entry,
      readPdf: false,
      pdfLink: false,
      enrichBody: false,
      enrichAfterPass: false,
      dedup: "date",
      prompts: "news",
      alwaysRun: false,
      dropOnSkip: false,
    };
  }
  return {
    url: entry.url,
    readPdf: entry.readPdf ?? false,
    pdfLink: entry.pdfLink ?? false,
    enrichBody: entry.enrichBody ?? false,
    enrichAfterPass: entry.enrichAfterPass ?? false,
    dedup: entry.dedup ?? "date",
    prompts: entry.prompts ?? "news",
    category: entry.category,
    alwaysRun: entry.alwaysRun ?? false,
    maxItems: entry.maxItems,
    maxBodyTotal: entry.maxBodyTotal,
    dropOnSkip: entry.dropOnSkip ?? false,
  };
}

export function feedsAsUrls(feeds: Record<string, FeedEntry>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(feeds).map(([tag, entry]) => [tag, resolveFeed(entry).url]),
  );
}

export function getFeedConfig(
  feeds: Record<string, FeedEntry>,
  tag: string,
): ResolvedFeed | null {
  const entry = feeds[tag];
  if (!entry) return null;
  return resolveFeed(entry);
}

/** arXiv abs URL → PDF URL. */
export function arxivPdfUrl(link: string): string | null {
  const m = link.match(/arxiv\.org\/abs\/([^?#/]+)/i);
  if (!m) return null;
  return `https://arxiv.org/pdf/${m[1]}.pdf`;
}

export function enrichTargetUrl(
  link: string,
  feed: ResolvedFeed,
): { url: string; kind: "pdf" | "page" } | null {
  if (feed.readPdf) {
    const pdf = arxivPdfUrl(link);
    if (pdf) return { url: pdf, kind: "pdf" };
  }
  if (feed.enrichBody || feed.enrichAfterPass) {
    return { url: link, kind: "page" };
  }
  return null;
}

export function documentNameFromUrl(url: string, kind: "pdf" | "page"): string {
  if (kind === "pdf") return "document.pdf";
  try {
    const path = new URL(url).pathname;
    const base = path.split("/").filter(Boolean).pop() ?? "page";
    return base.includes(".") ? base : `${base}.html`;
  } catch {
    return "page.html";
  }
}

export async function fetchDocument(url: string, timeoutMs: number): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; rssdoge/1.0; +https://rss-doge.melkikh.workers.dev/)",
      Accept: "text/html,application/pdf,application/xml,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.arrayBuffer();
}

type ConversionResult = {
  format?: string;
  data?: string;
  error?: string;
};

export async function convertToMarkdown(
  ai: Ai,
  name: string,
  buffer: ArrayBuffer,
): Promise<string> {
  const mime = name.endsWith(".pdf") ? "application/pdf" : "text/html";
  const raw = await ai.toMarkdown({
    name,
    blob: new Blob([buffer], { type: mime }),
  });
  const items: ConversionResult[] = Array.isArray(raw) ? raw : [raw];
  const first = items[0];
  if (!first || first.format === "error") {
    throw new Error(first?.error ?? "toMarkdown conversion failed");
  }
  return (first.data ?? "").trim();
}

export type EnrichBudget = {
  remaining: number;
  spent: number;
};

export function trySpendEnrichBudget(budget?: EnrichBudget): boolean {
  if (!budget) return true;
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  budget.spent += 1;
  return true;
}

export type EnrichResult = {
  body: string;
  success: boolean;
  reason?: "budget" | "neuron_gate" | "fetch_error" | "empty";
  source?: "pdf" | "page";
};

export async function enrichPostBody(
  link: string,
  feed: ResolvedFeed,
  env: { AI: Ai },
  opts: { timeoutMs: number; budget?: EnrichBudget },
): Promise<EnrichResult> {
  if (!trySpendEnrichBudget(opts.budget)) {
    return { body: "", success: false, reason: "budget" };
  }

  const target = enrichTargetUrl(link, feed);
  if (!target) {
    return { body: "", success: false, reason: "fetch_error" };
  }

  try {
    const buffer = await fetchDocument(target.url, opts.timeoutMs);
    const name = documentNameFromUrl(target.url, target.kind);
    const body = await convertToMarkdown(env.AI, name, buffer);
    if (!body) return { body: "", success: false, reason: "empty", source: target.kind };
    return { body, success: true, source: target.kind };
  } catch {
    return { body: "", success: false, reason: "fetch_error" };
  }
}
