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

  it("canSpendNeurons respects gate", async () => {
    const kv = new KV({ kv: mockKvStore() as any });
    await kv.addNeuronEstimate(7990);
    expect(await kv.canSpendNeurons(40, 8000)).toBe(false);
    expect(await kv.canSpendNeurons(10, 8000)).toBe(true);
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
