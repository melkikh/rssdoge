export class KV {
  private kv: KVNamespace;

  constructor(props: { kv: KVNamespace }) {
    this.kv = props.kv;
  }

  async getAll(): Promise<Record<string, string>> {
    const age = await this.kv.get("age", { type: "json" });
    return (age as Record<string, string> | null) ?? {};
  }

  async updateValues(updates: Record<string, Date>): Promise<void> {
    const age = await this.getAll();
    for (const [tag, date] of Object.entries(updates)) {
      age[tag] = date.toISOString();
    }
    await this.kv.put("age", JSON.stringify(age));
  }

  async getSeen(): Promise<Record<string, string[]>> {
    const seen = await this.kv.get("seen", { type: "json" });
    return (seen as Record<string, string[]> | null) ?? {};
  }

  /** Whitepaper link-dedup: seen[tag] = uniq((seen ∪ sent) ∩ feedLinks). See CLAUDE.md. */
  async updateSeen(
    sent: Record<string, string[]>,
    feedLinks: Record<string, string[]>,
  ): Promise<void> {
    const seen = await this.getSeen();
    const tags = new Set([...Object.keys(sent), ...Object.keys(feedLinks)]);
    for (const tag of tags) {
      const inFeed = feedLinks[tag];
      if (!inFeed || inFeed.length === 0) continue; // empty = transient fetch; don't forget
      const feedSet = new Set(inFeed);
      const merged = [...(seen[tag] ?? []), ...(sent[tag] ?? [])];
      seen[tag] = [...new Set(merged.filter((link) => feedSet.has(link)))];
    }
    await this.kv.put("seen", JSON.stringify(seen));
  }

  /** UTC date key for daily neuron estimate counter. */
  static neuronsKey(date = new Date()): string {
    return `neurons:${date.toISOString().slice(0, 10)}`;
  }

  async getNeuronEstimate(): Promise<number> {
    const raw = await this.kv.get(KV.neuronsKey());
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }

  async addNeuronEstimate(delta: number): Promise<number> {
    if (delta <= 0) return this.getNeuronEstimate();
    const key = KV.neuronsKey();
    const current = await this.getNeuronEstimate();
    const next = current + delta;
    await this.kv.put(key, String(next));
    return next;
  }

  async canSpendNeurons(additional: number, gate: number): Promise<boolean> {
    const current = await this.getNeuronEstimate();
    return current + additional <= gate;
  }
}
