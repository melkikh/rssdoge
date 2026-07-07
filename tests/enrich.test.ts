import { describe, expect, it } from "vitest";
import {
  arxivPdfUrl,
  documentNameFromUrl,
  enrichTargetUrl,
  resolveWhitepaperFeed,
  trySpendEnrichBudget,
  whitepaperFeedsAsUrls,
} from "../src/enrich";
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

describe("resolveWhitepaperFeed", () => {
  it("parses string shorthand", () => {
    expect(resolveWhitepaperFeed("https://example.com/feed.xml")).toEqual({
      url: "https://example.com/feed.xml",
      readPdf: false,
      enrichBody: false,
      enrichAfterPass: false,
    });
  });

  it("parses object with flags", () => {
    expect(
      resolveWhitepaperFeed({
        url: "https://arxiv.org/rss",
        readPdf: true,
        enrichBody: true,
      }),
    ).toEqual({
      url: "https://arxiv.org/rss",
      readPdf: true,
      enrichBody: true,
      enrichAfterPass: false,
    });
  });
});

describe("enrichTargetUrl", () => {
  it("returns pdf target for readPdf feeds", () => {
    const feed = resolveWhitepaperFeed({ url: "x", readPdf: true });
    expect(enrichTargetUrl("https://arxiv.org/abs/1234.5678", feed)).toEqual({
      url: "https://arxiv.org/pdf/1234.5678.pdf",
      kind: "pdf",
    });
  });

  it("returns page target for enrichBody feeds", () => {
    const feed = resolveWhitepaperFeed({ url: "x", enrichBody: true });
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

describe("whitepaperFeedsAsUrls", () => {
  it("extracts URLs from mixed entries", () => {
    expect(
      whitepaperFeedsAsUrls({
        arxiv: { url: "https://arxiv.org/rss", readPdf: true },
        elastic: "https://elastic.co/feed.xml",
      }),
    ).toEqual({
      arxiv: "https://arxiv.org/rss",
      elastic: "https://elastic.co/feed.xml",
    });
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
