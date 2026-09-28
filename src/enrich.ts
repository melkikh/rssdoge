import type { Post } from "./feed";
import type { CandidateKind, SourceTier } from "./curation";

export type FeedEntry =
  | string
  | {
      url: string;
      enrichBody?: boolean;
      enrichAfterPass?: boolean;
      readPdf?: boolean;
      pdfLink?: boolean;
      dedup?: "date" | "link";
      maxItems?: number;
      maxBodyTotal?: number;
      categoryPriority?: Record<string, number>;
      categoryPriorityThreshold?: number;
      kind?: CandidateKind;
      tier?: SourceTier;
    };

export type ResolvedFeed = {
  url: string;
  readPdf: boolean;
  pdfLink: boolean;
  enrichBody: boolean;
  enrichAfterPass: boolean;
  dedup: "date" | "link";
  maxItems?: number;
  maxBodyTotal?: number;
  categoryPriority?: Record<string, number>;
  categoryPriorityThreshold?: number;
  kind: CandidateKind;
  tier: SourceTier;
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
      kind: "story",
      tier: "core",
    };
  }
  return {
    url: entry.url,
    readPdf: entry.readPdf ?? false,
    pdfLink: entry.pdfLink ?? false,
    enrichBody: entry.enrichBody ?? false,
    enrichAfterPass: entry.enrichAfterPass ?? false,
    dedup: entry.dedup ?? "date",
    maxItems: entry.maxItems,
    maxBodyTotal: entry.maxBodyTotal,
    categoryPriority: entry.categoryPriority,
    categoryPriorityThreshold: entry.categoryPriorityThreshold,
    kind: entry.kind ?? "story",
    tier: entry.tier ?? "core",
  };
}

export function primaryCategoryWeight(
  category: string | undefined,
  priorityMap: Record<string, number>,
): number {
  if (!category) return 0;
  return priorityMap[category] ?? 0;
}

/** Deterministic pre-LLM gate: keep posts whose primary category meets the weight threshold. */
export function categoryPriorityFilter(posts: Post[], feed: ResolvedFeed): Post[] {
  if (!feed.categoryPriority) return posts;
  const threshold = feed.categoryPriorityThreshold ?? 0;
  return posts.filter((post) => {
    const weight = primaryCategoryWeight(post.categories?.[0], feed.categoryPriority!);
    return weight >= threshold;
  });
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
