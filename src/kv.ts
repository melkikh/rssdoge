export interface FeedStat {
  lastRunAt: string;
  lastPostAt?: string;
  lastPostCount?: number;
}

export interface Stats {
  lastRunAt: string;
  today: { date: string; runs: number };
  feeds: Record<string, FeedStat>;
}

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

  async getStats(): Promise<Stats | null> {
    const stats = await this.kv.get("stats", { type: "json" });
    return (stats as Stats | null) ?? null;
  }

  async updateStats(update: {
    now: Date;
    ranTags: string[];
    postsByTag: Record<string, { count: number; maxDate: Date }>;
  }): Promise<void> {
    const nowISO = update.now.toISOString();
    const todayUTC = update.now.toISOString().slice(0, 10);
    const current = await this.getStats();
    const stats: Stats = current ?? {
      lastRunAt: nowISO,
      today: { date: todayUTC, runs: 0 },
      feeds: {},
    };

    stats.lastRunAt = nowISO;
    if (stats.today.date !== todayUTC) {
      stats.today = { date: todayUTC, runs: 1 };
    } else {
      stats.today.runs++;
    }

    for (const tag of update.ranTags) {
      (stats.feeds[tag] ??= { lastRunAt: nowISO }).lastRunAt = nowISO;
    }
    for (const [tag, { count, maxDate }] of Object.entries(update.postsByTag)) {
      const feed = stats.feeds[tag] ?? { lastRunAt: nowISO };
      feed.lastPostAt = maxDate.toISOString();
      feed.lastPostCount = count;
      stats.feeds[tag] = feed;
    }

    await this.kv.put("stats", JSON.stringify(stats));
  }
}
