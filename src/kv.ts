export class KV {
  private kv: KVNamespace;

  constructor(props: { kv: KVNamespace }) {
    this.kv = props.kv;
  }

  async getAll(): Promise<Record<string, string>> {
    const age = await this.kv.get("age", { type: "json" });
    return (age as Record<string, string> | null) ?? {};
  }

  async updateValues(tags: string[], date: Date): Promise<void> {
    const age = await this.getAll();
    tags.forEach((tag) => {
      age[tag] = date.toISOString();
    });
    await this.kv.put("age", JSON.stringify(age));
  }
}
