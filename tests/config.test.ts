import { describe, expect, it } from "vitest";
import config from "../src/config";
import { resolveFeed } from "../src/enrich";

const env = { ENVIRONMENT: "production", TELEGRAM_TOKEN: "t", SENTRY_DSN: "d" } as any;

describe("config feeds", () => {
  const c = config(env);

  it("uses a model specialized for each editorial stage", () => {
    expect(c.gateModel).toBe("@cf/zai-org/glm-4.7-flash");
    expect(c.rankModel).toBe("@cf/nvidia/nemotron-3-120b-a12b");
    expect(c.summaryModel).toBe("@cf/google/gemma-4-26b-a4b-it");
  });

  it("Elastic is a plain news feed (string entry, all defaults)", () => {
    expect(c.feeds).toHaveProperty("elastic_security_labs");
    const f = resolveFeed(c.feeds.elastic_security_labs);
    expect(f.dedup).toBe("date");
    expect(f.kind).toBe("story");
    expect(f.tier).toBe("core");
  });

  it("puts arXiv in the paper lane with link dedup and no PDF enrichment", () => {
    const f = resolveFeed(c.feeds.arxiv_cscr);
    expect(f.readPdf).toBe(false);
    expect(f.dedup).toBe("link");
    expect(f.kind).toBe("paper");
    expect(f.maxItems).toBeGreaterThan(0);
    expect(f.maxBodyTotal).toBeGreaterThan(0);
    expect(f.categoryPriorityThreshold).toBe(2);
    expect(f.categoryPriority?.["cs.CR"]).toBe(3);
  });

  it("keeps Phil Venables as analysis and removes the noisy source set", () => {
    expect(resolveFeed(c.feeds.philvenables).kind).toBe("analysis");
    expect(resolveFeed(c.feeds.philvenables).enrichAfterPass).toBe(true);
    for (const removed of [
      "bruce_schneier", "netsec", "opennet", "google_research", "meta_engineering",
      "google_security", "rapid7", "tailscale", "teleport", "okta_security", "sysdig",
      "cloudflare_security", "badprivacy",
    ]) expect(c.feeds).not.toHaveProperty(removed);
  });

  it("adds HN and Lobsters only as discovery sources", () => {
    expect(resolveFeed(c.feeds.hackernews_security).tier).toBe("discovery");
    expect(resolveFeed(c.feeds.lobsters_security).tier).toBe("discovery");
  });
});
