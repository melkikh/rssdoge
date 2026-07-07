import { describe, expect, it } from "vitest";
import { sanitizeBullets } from "../src/ai";

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
