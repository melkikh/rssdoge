import { describe, expect, it } from "vitest";
import type { Post } from "../src/feed";
import { tracePost, resolvePrompts, isWhitepaperTag, buildCursorUpdates } from "../src/pipeline";

const testConfig = {
  minBodyChars: 100,
  aiModel: "@cf/zai-org/glm-4.7-flash",
  classifierPrompt: "classifier",
  classifierMaxBodyChars: 2000,
  aiPrompt: "summarizer",
  maxBodyTotal: 10000,
  tailSize: 1500,
  whitepaperFeeds: { arxiv_cscr: { url: "https://rss.arxiv.org/rss/cs.CR", readPdf: true } },
  whitepaperClassifierPrompt: "wp-classifier",
  whitepaperPrompt: "wp-summarizer",
  feedTimeoutMs: 10000,
  neuronGateThreshold: 8000,
  whitepaperCjkThreshold: 8,
};

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    title: "Test post",
    link: "https://example.com/post",
    date: new Date("2026-07-06T08:00:00Z"),
    tag: "test",
    body: "x".repeat(200),
    ...overrides,
  };
}

function mockAI(responses: { classify?: string; summary?: string }) {
  return {
    run: async (_model: string, opts: { max_completion_tokens?: number }) => {
      const content =
        opts.max_completion_tokens === 10
          ? (responses.classify ?? "PASS")
          : (responses.summary ?? "- First bullet\n- Second bullet");
      return {
        choices: [{ message: { content }, finish_reason: "stop" }],
      };
    },
  };
}

describe("tracePost", () => {
  it("returns no_body when post has empty body", async () => {
    const trace = await tracePost(makePost({ body: "" }), { AI: mockAI({}) as any }, { config: testConfig }, {
      skipSentry: true,
    });
    expect(trace.pipeline.step).toBe("no_body");
    expect(trace.bullets).toBe("");
  });

  it("returns body_too_short below minBodyChars", async () => {
    const trace = await tracePost(makePost({ body: "short body" }), { AI: mockAI({}) as any }, { config: testConfig }, {
      skipSentry: true,
    });
    expect(trace.pipeline.step).toBe("body_too_short");
    expect(trace.classifier.raw_output).toBe("");
  });

  it("returns classified_skip without calling summary", async () => {
    const ai = mockAI({ classify: "SKIP" });
    const trace = await tracePost(makePost(), { AI: ai as any }, { config: testConfig }, { skipSentry: true });
    expect(trace.pipeline.step).toBe("classified_skip");
    expect(trace.classifier.classification).toBe("SKIP");
    expect(trace.summary.raw_output).toBe("");
  });

  it("returns ok with bullets on PASS + valid summary", async () => {
    const trace = await tracePost(
      makePost(),
      { AI: mockAI({ classify: "PASS", summary: "- Bullet one\n- Bullet two" }) as any },
      { config: testConfig },
      { skipSentry: true },
    );
    expect(trace.pipeline.step).toBe("ok");
    expect(trace.bullets).toBe("- Bullet one\n- Bullet two");
  });

  it("returns summary_cjk when model hallucinates CJK", async () => {
    const trace = await tracePost(
      makePost(),
      { AI: mockAI({ classify: "PASS", summary: "- 全球量子攻击" }) as any },
      { config: testConfig },
      { skipSentry: true },
    );
    expect(trace.pipeline.step).toBe("summary_cjk");
    expect(trace.summary.rejected_reason).toBe("cjk");
    expect(trace.bullets).toBe("");
  });

  it("uses whitepaper prompts for whitepaper tags", async () => {
    const prompts: string[] = [];
    const ai = {
      run: async (_model: string, opts: { max_completion_tokens?: number; messages?: { content: string }[] }) => {
        const content = opts.max_completion_tokens === 10 ? "PASS" : "- wp bullet";
        prompts.push(opts.messages?.[0]?.content ?? "");
        return { choices: [{ message: { content }, finish_reason: "stop" }] };
      },
    };
    await tracePost(
      makePost({ tag: "arxiv_cscr" }),
      { AI: ai as any },
      { config: testConfig },
      { skipSentry: true },
    );
    expect(prompts[0]).toContain("wp-classifier");
    expect(prompts[1]).toContain("wp-summarizer");
  });
});

describe("resolvePrompts", () => {
  it("returns whitepaper pair for whitepaper tags", () => {
    expect(resolvePrompts(testConfig, "arxiv_cscr")).toEqual({
      classifierPrompt: "wp-classifier",
      summaryPrompt: "wp-summarizer",
    });
  });

  it("returns default pair for blog tags", () => {
    expect(resolvePrompts(testConfig, "netsec")).toEqual({
      classifierPrompt: "classifier",
      summaryPrompt: "summarizer",
    });
  });
});

describe("isWhitepaperTag", () => {
  it("recognizes whitepaper feed tags", () => {
    expect(isWhitepaperTag(testConfig, "arxiv_cscr")).toBe(true);
    expect(isWhitepaperTag(testConfig, "netsec")).toBe(false);
  });
});

describe("buildCursorUpdates", () => {
  const now = new Date("2026-07-07T12:00:00Z");
  const processedDate = new Date("2026-07-06T08:00:00Z");

  it("uses max processed post date for whitepaper tags", () => {
    const updates = buildCursorUpdates(
      ["arxiv_cscr", "netsec"],
      testConfig,
      now,
      { arxiv_cscr: processedDate },
    );
    expect(updates.arxiv_cscr).toEqual(processedDate);
    expect(updates.netsec).toEqual(now);
  });

  it("falls back to now for whitepaper tags with no processed posts", () => {
    const updates = buildCursorUpdates(["arxiv_cscr"], testConfig, now, {});
    expect(updates.arxiv_cscr).toEqual(now);
  });
});
