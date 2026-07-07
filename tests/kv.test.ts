import { describe, expect, it, vi } from "vitest";
import { KV } from "../src/kv";

function mockKvStore() {
  const data = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
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
