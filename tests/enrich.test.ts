import { describe, expect, it } from "vitest";
import {
  arxivPdfUrl,
  categoryPriorityFilter,
  documentNameFromUrl,
  enrichTargetUrl,
  primaryCategoryWeight,
  resolveFeed,
  trySpendEnrichBudget,
} from "../src/enrich";
import type { Post } from "../src/feed";
import { KV } from "../src/kv";

describe("arxivPdfUrl", () => {
  it("converts abs URL to pdf URL", () => {
    expect(arxivPdfUrl("https://arxiv.org/abs/2607.02615")).toBe(
      "https://arxiv.org/pdf/2607.02615.pdf",
    );
  });

  it("returns null for non-arXiv links", () => {
    expect(arxivPdfUrl("https://example.com/paper")).toBeNull();
  });
});

describe("resolveFeed", () => {
  it("parses string shorthand into a plain news feed", () => {
    expect(resolveFeed("https://example.com/feed.xml")).toEqual({
      url: "https://example.com/feed.xml",
      readPdf: false,
      pdfLink: false,
      enrichBody: false,
      enrichAfterPass: false,
      dedup: "date",
      maxItems: undefined,
      maxBodyTotal: undefined,
      categoryPriority: undefined,
      categoryPriorityThreshold: undefined,
      kind: "story",
      tier: "core",
    });
  });

  it("parses object with flags, defaulting the rest", () => {
    expect(
      resolveFeed({
        url: "https://arxiv.org/rss",
        readPdf: true,
        enrichBody: true,
        dedup: "link",
        kind: "paper",
      }),
    ).toEqual({
      url: "https://arxiv.org/rss",
      readPdf: true,
      pdfLink: false,
      enrichBody: true,
      enrichAfterPass: false,
      dedup: "link",
      maxItems: undefined,
      maxBodyTotal: undefined,
      categoryPriority: undefined,
      categoryPriorityThreshold: undefined,
      kind: "paper",
      tier: "core",
    });
  });
});

describe("enrichTargetUrl", () => {
  it("returns pdf target for readPdf feeds", () => {
    const feed = resolveFeed({ url: "x", readPdf: true });
    expect(enrichTargetUrl("https://arxiv.org/abs/1234.5678", feed)).toEqual({
      url: "https://arxiv.org/pdf/1234.5678.pdf",
      kind: "pdf",
    });
  });

  it("returns page target for enrichBody feeds", () => {
    const feed = resolveFeed({ url: "x", enrichBody: true });
    expect(enrichTargetUrl("https://research.google/blog/post", feed)).toEqual({
      url: "https://research.google/blog/post",
      kind: "page",
    });
  });
});

describe("trySpendEnrichBudget", () => {
  it("decrements remaining budget", () => {
    const budget = { remaining: 2, spent: 0 };
    expect(trySpendEnrichBudget(budget)).toBe(true);
    expect(budget.remaining).toBe(1);
    expect(budget.spent).toBe(1);
  });

  it("returns false when budget exhausted", () => {
    const budget = { remaining: 0, spent: 5 };
    expect(trySpendEnrichBudget(budget)).toBe(false);
  });
});

describe("KV.neuronsKey", () => {
  it("uses UTC date", () => {
    expect(KV.neuronsKey(new Date("2026-07-07T23:00:00Z"))).toBe("neurons:2026-07-07");
  });
});

describe("documentNameFromUrl", () => {
  it("uses .pdf for pdf kind", () => {
    expect(documentNameFromUrl("https://arxiv.org/pdf/123.pdf", "pdf")).toBe("document.pdf");
  });

  it("derives html name from path", () => {
    expect(documentNameFromUrl("https://example.com/blog/my-post", "page")).toBe("my-post.html");
  });
});

describe("primaryCategoryWeight", () => {
  const map = { "cs.CR": 3, "cs.LG": 3, "cs.SE": 2 };

  it("returns mapped weight for known categories", () => {
    expect(primaryCategoryWeight("cs.LG", map)).toBe(3);
  });

  it("returns 0 for unlisted categories", () => {
    expect(primaryCategoryWeight("quant-ph", map)).toBe(0);
  });
});

describe("categoryPriorityFilter", () => {
  const feed = resolveFeed({
    url: "https://arxiv.org/rss",
    categoryPriority: { "cs.CR": 3, "cs.LG": 3, "cs.SE": 2 },
    categoryPriorityThreshold: 2,
  });

  const post = (categories: string[]): Post => ({
    title: "t",
    link: `https://arxiv.org/abs/${categories[0]}`,
    date: new Date(),
    tag: "arxiv_cscr",
    body: "x".repeat(200),
    categories,
  });

  it("keeps posts whose primary category meets the threshold", () => {
    const kept = categoryPriorityFilter([post(["cs.LG", "cs.CR"]), post(["cs.SE"])], feed);
    expect(kept.map((p) => p.categories![0])).toEqual(["cs.LG", "cs.SE"]);
  });

  it("drops posts with unlisted primary categories", () => {
    const kept = categoryPriorityFilter([post(["quant-ph"]), post(["eess.SP"])], feed);
    expect(kept).toEqual([]);
  });

  it("is a no-op when categoryPriority is unset", () => {
    const plain = resolveFeed("https://example.com/feed.xml");
    const posts = [post(["quant-ph"])];
    expect(categoryPriorityFilter(posts, plain)).toBe(posts);
  });
});
