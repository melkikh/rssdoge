import { describe, expect, it } from "vitest";
import config from "../src/config";
import { resolveFeed } from "../src/enrich";

const env = { ENVIRONMENT: "production", TELEGRAM_TOKEN: "t", SENTRY_DSN: "d" } as any;

describe("config feeds", () => {
  const c = config(env);

  it("Elastic is a plain news feed (string entry, all defaults)", () => {
    expect(c.feeds).toHaveProperty("elastic_security_labs");
    const f = resolveFeed(c.feeds.elastic_security_labs);
    expect(f.dedup).toBe("date");
    expect(f.prompts).toBe("news");
    expect(f.category).toBeUndefined();
  });

  it("arXiv is the only #whitepaper: link-dedup, research prompts, always-run, no PDF enrich", () => {
    const f = resolveFeed(c.feeds.arxiv_cscr);
    expect(f.readPdf).toBe(false);
    expect(f.dedup).toBe("link");
    expect(f.prompts).toBe("whitepaper");
    expect(f.category).toBe("whitepaper");
    expect(f.alwaysRun).toBe(true);
    expect(f.maxItems).toBeGreaterThan(0);
    expect(f.maxBodyTotal).toBeGreaterThan(0);
  });

  it("google_research is a news feed with body enrichment, trailing-slash RSS", () => {
    const f = resolveFeed(c.feeds.google_research);
    expect(f.url).toBe("https://research.google/blog/rss/");
    expect(f.enrichBody).toBe(true);
    expect(f.prompts).toBe("news");
    expect(f.category).toBeUndefined();
  });

  it("portswigger_research is a news feed with after-pass enrichment, no #whitepaper", () => {
    const f = resolveFeed(c.feeds.portswigger_research);
    expect(f.enrichAfterPass).toBe(true);
    expect(f.category).toBeUndefined();
  });
});
