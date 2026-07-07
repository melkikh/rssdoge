import { describe, expect, it } from "vitest";
import { coerceToString, entryBodyFromFeedEntry } from "../src/feed";

// Shape from feed-extractor for arXiv cs.CR RSS entries (abstract in description)
const arxivEntry = {
  title: "Practical Defenses Against Prompt Injection in LLM Agents",
  link: "https://arxiv.org/abs/2601.12345",
  published: "2026-07-06T18:00:00Z",
  description:
    "We present a layered defense architecture for LLM-based agents that combines input sanitization, tool-call sandboxing, and runtime policy enforcement. Our evaluation on three real-world agent workflows shows a 94% reduction in successful prompt-injection attacks while preserving task completion rates. We release an open-source reference implementation and discuss deployment trade-offs for production systems.",
};

// Shape produced by feed-extractor + fast-xml-parser for tests/fixtures/schneier-atom.xml
const schneierEntry = {
  content: {
    "#text":
      "<p>France is investing heavily in quantum-resistant cryptography as part of a national strategy to prepare critical infrastructure for post-quantum threats. The initiative covers government networks, financial systems, and telecom operators.</p><p>Officials emphasized migration timelines aligned with NIST standards and coordination with EU partners on quantum-safe protocols.</p>",
    "@_type": "html",
  },
};

describe("coerceToString", () => {
  it.each([
    ["plain string", "hello world", "hello world"],
    ["object with #text", { "#text": "<p>France is investing</p>", "@_type": "html" }, "<p>France is investing</p>"],
    ["empty object", {}, ""],
    ["null", null, ""],
    ["number", 42, ""],
  ] as const)("handles %s", (_label, input, expected) => {
    expect(coerceToString(input)).toBe(expected);
  });
});

describe("entryBodyFromFeedEntry", () => {
  it("extracts atom body from content #text (Schneier shape)", () => {
    const { body, feedRaw } = entryBodyFromFeedEntry(schneierEntry, 10000, true);

    expect(body.length).toBeGreaterThan(100);
    expect(body).toContain("France is investing");
    expect(feedRaw).toEqual({
      content_type: "object",
      source_field: "content",
      keys: ["#text", "@_type"],
    });
  });

  it("extracts arXiv cs.CR abstract from description (≥ minBodyChars)", () => {
    const { body, feedRaw } = entryBodyFromFeedEntry(arxivEntry, 10000, true);

    expect(body.length).toBeGreaterThan(100);
    expect(body).toContain("prompt-injection");
    expect(body).toContain("layered defense");
    expect(feedRaw?.source_field).toBe("description");
  });
});
