import { describe, expect, it } from "vitest";
import { coerceToString, entryBodyFromFeedEntry } from "../src/feed";

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
});
