import { describe, expect, it, vi } from "vitest";
import { KV } from "../src/kv";

function mockKvStore() {
  const data = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, opts?: { type?: string }) => {
      const raw = data.get(key) ?? null;
      if (raw !== null && opts?.type === "json") return JSON.parse(raw);
      return raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    data,
  };
}

describe("KV neuron counter", () => {
  it("starts at zero", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    expect(await kv.getNeuronEstimate()).toBe(0);
  });

  it("accumulates estimates", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    await kv.addNeuronEstimate(40);
    await kv.addNeuronEstimate(2);
    expect(await kv.getNeuronEstimate()).toBe(42);
  });

});

describe("KV curation state", () => {
  it("starts with an empty versioned state and round-trips it", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    const initial = await kv.getCurationState();
    expect(initial).toEqual({ version: 1, candidates: [], published: [], sourceStats: {}, editions: {} });
    initial.editions.daily = "2026-09-27";
    await kv.putCurationState(initial);
    expect((await kv.getCurationState()).editions.daily).toBe("2026-09-27");
  });
});

describe("KV seen-links dedup", () => {
  it("starts empty", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    expect(await kv.getSeen()).toEqual({});
  });

  it("stores sent links present in the feed", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    await kv.updateSeen({ arxiv: ["a", "b"] }, { arxiv: ["a", "b", "c"] });
    expect(await kv.getSeen()).toEqual({ arxiv: ["a", "b"] });
  });

  it("merges with existing and dedups", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    await kv.updateSeen({ arxiv: ["a"] }, { arxiv: ["a", "b"] });
    await kv.updateSeen({ arxiv: ["a", "b"] }, { arxiv: ["a", "b"] });
    expect((await kv.getSeen()).arxiv.sort()).toEqual(["a", "b"]);
  });

  it("drops links no longer in the feed (retention = ∩ feed)", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    await kv.updateSeen({ arxiv: ["a", "b"] }, { arxiv: ["a", "b"] });
    // Next run: 'a' scrolled out of the feed, only 'b' + new 'c' remain.
    await kv.updateSeen({ arxiv: ["c"] }, { arxiv: ["b", "c"] });
    expect((await kv.getSeen()).arxiv.sort()).toEqual(["b", "c"]);
  });

  it("skips a tag whose feed came back empty (transient fetch)", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    await kv.updateSeen({ arxiv: ["a", "b"] }, { arxiv: ["a", "b"] });
    await kv.updateSeen({}, { arxiv: [] });
    expect((await kv.getSeen()).arxiv.sort()).toEqual(["a", "b"]);
  });
});

describe("KV stats", () => {
  it("starts null", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    expect(await kv.getStats()).toBeNull();
  });

  it("initializes on first update", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    const now = new Date("2026-07-13T12:00:00Z");
    await kv.updateStats({ now, ranTags: ["blog"], postsByTag: {} });
    const stats = await kv.getStats();
    expect(stats?.lastRunAt).toBe(now.toISOString());
    expect(stats?.today).toEqual({ date: "2026-07-13", runs: 1 });
    expect(stats?.feeds.blog.lastRunAt).toBe(now.toISOString());
    expect(stats?.feeds.blog.lastPostAt).toBeUndefined();
  });

  it("increments runs on the same UTC day", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    const day = new Date("2026-07-13T10:00:00Z");
    await kv.updateStats({ now: day, ranTags: ["a"], postsByTag: {} });
    await kv.updateStats({ now: new Date("2026-07-13T18:00:00Z"), ranTags: ["b"], postsByTag: {} });
    const stats = await kv.getStats();
    expect(stats?.today).toEqual({ date: "2026-07-13", runs: 2 });
    expect(stats?.feeds.a.lastRunAt).toBe("2026-07-13T10:00:00.000Z");
    expect(stats?.feeds.b.lastRunAt).toBe("2026-07-13T18:00:00.000Z");
  });

  it("resets runs on a new UTC day", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    await kv.updateStats({ now: new Date("2026-07-13T23:00:00Z"), ranTags: [], postsByTag: {} });
    await kv.updateStats({ now: new Date("2026-07-14T01:00:00Z"), ranTags: [], postsByTag: {} });
    const stats = await kv.getStats();
    expect(stats?.today).toEqual({ date: "2026-07-14", runs: 1 });
  });

  it("records lastOfftopicCount for gated feeds", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    const now = new Date("2026-07-13T12:00:00Z");
    await kv.updateStats({
      now,
      ranTags: ["arxiv_cscr"],
      postsByTag: { arxiv_cscr: { count: 4, maxDate: now } },
      offtopicByTag: { arxiv_cscr: 7 },
    });
    const stats = await kv.getStats();
    expect(stats?.feeds.arxiv_cscr.lastOfftopicCount).toBe(7);
    expect(stats?.feeds.arxiv_cscr.lastPostCount).toBe(4);
  });

  it("sets lastPostAt only for tags with posts", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    const now = new Date("2026-07-13T12:00:00Z");
    const postDate = new Date("2026-07-12T08:00:00Z");
    await kv.updateStats({
      now,
      ranTags: ["with_posts", "empty"],
      postsByTag: { with_posts: { count: 3, maxDate: postDate } },
    });
    const stats = await kv.getStats();
    expect(stats?.feeds.with_posts.lastPostAt).toBe(postDate.toISOString());
    expect(stats?.feeds.with_posts.lastPostCount).toBe(3);
    expect(stats?.feeds.empty.lastPostAt).toBeUndefined();
    expect(stats?.feeds.empty.lastRunAt).toBe(now.toISOString());
  });
});
