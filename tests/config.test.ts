import { describe, expect, it } from "vitest";
import config from "../src/config";
import { resolveWhitepaperFeed } from "../src/enrich";

const env = { ENVIRONMENT: "production", TELEGRAM_TOKEN: "t", SENTRY_DSN: "d" } as any;

describe("config feeds", () => {
  const c = config(env);

  it("Elastic is a normal news feed, not a whitepaper source", () => {
    expect(c.feeds).toHaveProperty("elastic_security_labs");
    expect(c.whitepaperFeeds).not.toHaveProperty("elastic_security_labs");
  });

  it("arXiv is abstract-only (no PDF enrich)", () => {
    expect(resolveWhitepaperFeed(c.whitepaperFeeds.arxiv_cscr).readPdf).toBe(false);
  });

  it("google_research RSS uses trailing slash", () => {
    expect(resolveWhitepaperFeed(c.whitepaperFeeds.google_research).url).toBe(
      "https://research.google/blog/rss/",
    );
  });

  it("has whitepaperMaxBodyTotal and no whitepaperCjkThreshold", () => {
    expect(c.whitepaperMaxBodyTotal).toBeGreaterThan(0);
    expect(c).not.toHaveProperty("whitepaperCjkThreshold");
  });
});
