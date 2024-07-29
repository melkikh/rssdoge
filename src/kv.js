export class KV {
  constructor(props) {
    this.kv = props.kv;
  }

  async getAll() {
    const age = await this.kv.get("age", { type: "json" });
    return age;
  }

  async updateValue(tag, date) {
    const age = await this.getAll();
    age[tag] = date.toISOString();
    await this.kv.put("age", JSON.stringify(age));
  }

  async updateValues(tags, date) {
    const age = await this.getAll();
    tags.forEach((tag) => {
      age[tag] = date.toISOString();
    });
    await this.kv.put("age", JSON.stringify(age));
  }
}
