export type WhitepaperFeedEntry =
  | string
  | {
      url: string;
      /** After PASS: fetch PDF (arXiv abs → pdf). */
      readPdf?: boolean;
      /** Before classify when body is short/missing: fetch HTML page. */
      enrichBody?: boolean;
      /** After PASS: fetch HTML page for full text (teaser-only RSS). */
      enrichAfterPass?: boolean;
    };

export type ResolvedWhitepaperFeed = {
  url: string;
  readPdf: boolean;
  enrichBody: boolean;
  enrichAfterPass: boolean;
};

export function resolveWhitepaperFeed(entry: WhitepaperFeedEntry): ResolvedWhitepaperFeed {
  if (typeof entry === "string") {
    return { url: entry, readPdf: false, enrichBody: false, enrichAfterPass: false };
  }
  return {
    url: entry.url,
    readPdf: entry.readPdf ?? false,
    enrichBody: entry.enrichBody ?? false,
    enrichAfterPass: entry.enrichAfterPass ?? false,
  };
}

export function whitepaperFeedsAsUrls(
  feeds: Record<string, WhitepaperFeedEntry>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(feeds).map(([tag, entry]) => [tag, resolveWhitepaperFeed(entry).url]),
  );
}

export function getWhitepaperFeedConfig(
  feeds: Record<string, WhitepaperFeedEntry>,
  tag: string,
): ResolvedWhitepaperFeed | null {
  const entry = feeds[tag];
  if (!entry) return null;
  return resolveWhitepaperFeed(entry);
}

/** arXiv abs URL → PDF URL. */
export function arxivPdfUrl(link: string): string | null {
  const m = link.match(/arxiv\.org\/abs\/([^?#/]+)/i);
  if (!m) return null;
  return `https://arxiv.org/pdf/${m[1]}.pdf`;
}

export function enrichTargetUrl(
  link: string,
  feed: ResolvedWhitepaperFeed,
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
  feed: ResolvedWhitepaperFeed,
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
