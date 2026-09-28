import { describe, expect, it } from "vitest";
import {
  editorialGateDetailed,
  mixedScriptTokens,
  rankCandidatesDetailed,
  sanitizeBullets,
} from "../src/ai";
import type { Candidate } from "../src/curation";

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

describe("editorial AI boundaries", () => {
  const mockAI = (content: string) => ({
    run: async () => ({ choices: [{ message: { content } }] }),
  });

  it("parses a strict gate verdict", async () => {
    const raw = JSON.stringify({
      decision: "keep", interest: 5, novelty: 4, practical: 4, evidence: 4,
      topic: "browser isolation", reason: "new containment technique",
    });
    const result = await editorialGateDetailed(
      { title: "Test", body: "x".repeat(200), source: "test", kind: "story" },
      { ai: mockAI(raw) as any, model: "m", prompt: "p", maxBodyChars: 1000 },
    );
    expect(result.verdict?.decision).toBe("keep");
    expect(result.verdict?.novelty).toBe(4);
  });

  it("maps short ranking aliases and fails closed on an invalid id", async () => {
    const candidate: Candidate = {
      id: "known", title: "Test", link: "https://e.test", source: "test", kind: "story",
      tier: "core", publishedAt: "2026-09-27T00:00:00.000Z",
      discoveredAt: "2026-09-27T00:00:00.000Z", body: "body",
      verdict: { decision: "keep", interest: 5, novelty: 4, practical: 4, evidence: 4, topic: "x", reason: "y" },
      summaryAttempts: 0,
    };
    const valid = await rankCandidatesDetailed([candidate], {
      ai: mockAI('{"ids":["c1"]}') as any,
      model: "m",
      prompt: "p",
      maxItems: 1,
    });
    expect(valid.ids).toEqual(["known"]);

    const invalid = await rankCandidatesDetailed([candidate], {
      ai: mockAI('{"ids":["unknown"]}') as any,
      model: "m",
      prompt: "p",
      maxItems: 1,
    });
    expect(invalid.ids).toBeNull();
  });
});
