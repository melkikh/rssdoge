import { describe, expect, it } from "vitest";
import { sanitizeBullets, mixedScriptTokens } from "../src/ai";

describe("sanitizeBullets", () => {
  it.each([
    ["empty string", "", { bullets: "", rejectedReason: "empty" }],
    ["whitespace only", "   \n  ", { bullets: "", rejectedReason: "empty" }],
    ["CJK hallucination", "- 全球攻击向量", { bullets: "", rejectedReason: "cjk" }],
    ["single CJK char ok", "- CVE в PyTorch", { bullets: "- CVE в PyTorch" }],
    ["strips markdown", "- **bold** and `code`", { bullets: "- bold and code" }],
    ["normalizes bullets", "first point\n- second point", { bullets: "- first point\n- second point" }],
    [
      "valid summary",
      "- France invests in post-quantum migration\n- NIST-aligned timelines",
      { bullets: "- France invests in post-quantum migration\n- NIST-aligned timelines" },
    ],
  ] as const)("handles %s", (_label, input, expected) => {
    expect(sanitizeBullets(input)).toEqual(expected);
  });
});

describe("mixedScriptTokens", () => {
  it("flags a stray Latin letter inside a Cyrillic word", () => {
    expect(mixedScriptTokens("- состtированные возмущения")).toEqual(["состtированные"]);
  });

  it("flags a Cyrillic letter inside a Latin word", () => {
    expect(mixedScriptTokens("- Кubernetes кластер")).toEqual(["Кubernetes"]);
  });

  it.each([
    ["apostrophe boundary", "- два patch'а через MCP"],
    ["hyphen boundary", "- MCP-сервер и Docker-образ"],
    ["digit boundary", "- IPv6 и L2TP, лог Log4j"],
    ["pure Cyrillic", "- уязвимость позволяет повысить привилегии"],
    ["pure Latin term", "- supply chain и RCE"],
  ])("does not flag legit mixing: %s", (_label, input) => {
    expect(mixedScriptTokens(input)).toEqual([]);
  });
});
