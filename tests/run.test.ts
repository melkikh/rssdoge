import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyCurationState } from "../src/curation";
import { persistIngestResults, publish, roundRobinPosts } from "../src/run";
import type { Post } from "../src/feed";

afterEach(() => vi.unstubAllGlobals());

function persistence(log: string[], failState = false) {
  return {
    putCurationState: vi.fn(async () => {
      log.push("state");
      if (failState) throw new Error("state failed");
    }),
    updateValues: vi.fn(async () => { log.push("cursors"); }),
    updateSeen: vi.fn(async () => { log.push("seen"); }),
    addNeuronEstimate: vi.fn(async () => { log.push("neurons"); }),
    updateStats: vi.fn(async () => { log.push("stats"); }),
  };
}

const result = {
  state: emptyCurationState(),
  cursors: { blog: new Date("2026-09-27T08:00:00Z") },
  processedLinks: { arxiv: ["a"] },
  feedLinks: { arxiv: ["a"] },
  neuronDelta: 2,
  stats: { now: new Date("2026-09-27T08:00:00Z"), ranTags: [], postsByTag: {} },
};

describe("ingest persistence", () => {
  it("persists the pool before cursors and seen links", async () => {
    const log: string[] = [];
    await persistIngestResults({ kv: persistence(log), sentry: { captureException: vi.fn() } } as any, result);
    expect(log).toEqual(["state", "cursors", "seen", "neurons", "stats"]);
  });

  it("does not advance cursors when pool persistence fails", async () => {
    const log: string[] = [];
    await expect(persistIngestResults(
      { kv: persistence(log, true), sentry: { captureException: vi.fn() } } as any,
      result,
    )).rejects.toThrow("state failed");
    expect(log).toEqual(["state"]);
  });
});

describe("round-robin ingest cap", () => {
  const post = (tag: string, n: number): Post => ({
    title: `${tag}-${n}`,
    link: `https://example.com/${tag}/${n}`,
    tag,
    date: new Date(`2026-09-27T0${n}:00:00Z`),
    body: "x".repeat(200),
  });

  it("does not let one busy feed consume the whole gate budget", () => {
    const selected = roundRobinPosts([post("a", 1), post("a", 2), post("b", 1)], 2);
    expect(selected.map((item) => item.tag)).toEqual(["a", "b"]);
    expect(selected[0].title).toBe("a-2");
  });

  it("honors an explicit source order for reserved discovery slots", () => {
    const selected = roundRobinPosts([post("core", 1), post("hn", 1)], 1, ["hn", "core"]);
    expect(selected[0].tag).toBe("hn");
  });
});

describe("publish failure semantics", () => {
  const storedCandidate = {
    id: "https://example.com/good",
    title: "Good story",
    link: "https://example.com/good",
    source: "blog",
    kind: "story" as const,
    tier: "core" as const,
    publishedAt: "2026-09-27T08:00:00.000Z",
    discoveredAt: "2026-09-27T08:00:00.000Z",
    body: "x".repeat(300),
    verdict: { decision: "keep" as const, interest: 5, novelty: 5, practical: 4, evidence: 4, topic: "sandbox", reason: "new primitive" },
    summaryAttempts: 0,
  };
  const state = { ...emptyCurationState(), candidates: [storedCandidate] };
  const config = {
    feeds: { blog: "https://example.com/feed" },
    dailyShortlistSize: 12,
    researchShortlistSize: 30,
    dailyMaxItems: 1,
    researchMaxItems: 3,
    gateModel: "gate",
    rankModel: "rank",
    summaryModel: "summary",
    editorialRankPrompt: "rank",
    editorialSummaryPrompt: "summary",
    maxBodyTotal: 10000,
    tailSize: 1500,
    feedTimeoutMs: 10000,
    telegramToken: "token",
    telegramChatID: "chat",
  };

  function context(put = vi.fn(async (_state: any) => {})) {
    return {
      config,
      kv: {
        getCurationState: vi.fn(async () => structuredClone(state)),
        putCurationState: put,
        addNeuronEstimate: vi.fn(async () => 0),
      },
      sentry: { captureException: vi.fn() },
    } as any;
  }

  it("does not commit an edition when Telegram send fails", async () => {
    const put = vi.fn(async (_state: any) => {});
    const ctx = context(put);
    const fetchMock = vi.fn(async () => new Response("telegram failed", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      AI: {
        run: async (_model: string, opts: { max_completion_tokens: number }) => ({
          choices: [{ message: { content: opts.max_completion_tokens === 400
            ? JSON.stringify({ ids: ["c1"] })
            : "- Хорошая история" } }],
        }),
      },
    } as any;

    await expect(publish(env, ctx, new Date("2026-09-28T16:00:00Z"))).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("uses separate models for ranking and summaries", async () => {
    const ctx = context();
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    const env = {
      AI: {
        run: async (model: string) => {
          models.push(model);
          return { choices: [{ message: { content: model === "rank"
            ? JSON.stringify({ ids: ["c1"] })
            : "- Хорошая история" } }] };
        },
      },
    } as any;

    await publish(env, ctx, new Date("2026-09-28T16:00:00Z"));
    expect(models).toEqual(["rank", "summary"]);
  });

  it("persists a summary attempt but never sends an empty summary", async () => {
    const put = vi.fn(async (_state: any) => {});
    const ctx = context(put);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      AI: {
        run: async (_model: string, opts: { max_completion_tokens: number }) => ({
          choices: [{ message: { content: opts.max_completion_tokens === 400
            ? JSON.stringify({ ids: ["c1"] })
            : "" } }],
        }),
      },
    } as any;

    await publish(env, ctx, new Date("2026-09-28T16:00:00Z"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][0].candidates[0].summaryAttempts).toBe(1);
    expect(put.mock.calls[0][0].editions.daily).toBeUndefined();
  });
});
