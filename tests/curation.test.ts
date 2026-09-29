import { describe, expect, it } from "vitest";
import {
  addCandidates,
  buildShortlist,
  canonicalCandidateId,
  emptyCurationState,
  isoWeekKey,
  parseEditorialVerdict,
  parseRankedIds,
  passesQualityFloor,
  pruneCurationState,
  recordSummaryFailures,
  removePublished,
  type Candidate,
  type CandidateKind,
} from "../src/curation";

const verdict = {
  decision: "keep" as const,
  interest: 5,
  novelty: 4,
  practical: 4,
  evidence: 4,
  topic: "supply chain",
  reason: "a concrete new technique",
};

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    id,
    title: id,
    link: `https://example.com/${id}`,
    source: "source",
    kind: "story",
    tier: "core",
    publishedAt: "2026-09-26T10:00:00.000Z",
    discoveredAt: "2026-09-27T10:00:00.000Z",
    body: "body",
    verdict,
    summaryAttempts: 0,
    ...overrides,
  };
}

describe("editorial verdict", () => {
  it("accepts complete JSON and rejects malformed or out-of-range data", () => {
    expect(parseEditorialVerdict(JSON.stringify(verdict))).toEqual(verdict);
    expect(parseEditorialVerdict('{"decision":"keep","interest":9}')).toBeNull();
    expect(parseEditorialVerdict("KEEP")).toBeNull();
  });

  it("extracts one wrapped JSON object without relaxing verdict validation", () => {
    const json = JSON.stringify(verdict);
    expect(parseEditorialVerdict(`Result:\n\`\`\`json\n${json}\n\`\`\``)).toEqual(verdict);
    expect(parseEditorialVerdict(`<think>brief check</think>\n${json}`)).toEqual(verdict);
    expect(parseEditorialVerdict(`${json}\n${json}`)).toBeNull();
    expect(parseEditorialVerdict(`Result: ${json.slice(0, -1)}`)).toBeNull();
  });

  it.each([
    ["story", { ...verdict, novelty: 3 }, true],
    ["paper", { ...verdict, practical: 3 }, false],
    ["analysis", { ...verdict, novelty: 3 }, false],
    ["story", { ...verdict, decision: "drop" as const }, false],
  ] as Array<[CandidateKind, typeof verdict, boolean]>)(
    "applies the quality floor for %s",
    (kind, input, expected) => expect(passesQualityFloor(kind, input)).toBe(expected),
  );
});

describe("curation pool", () => {
  it("deduplicates canonical links and never re-adds a published item", () => {
    const id = canonicalCandidateId("https://EXAMPLE.com/post/?utm_source=x#part");
    expect(id).toBe("https://example.com/post");
    let state = addCandidates(emptyCurationState(), [candidate(id), candidate(id)]);
    expect(state.candidates).toHaveLength(1);
    state = removePublished(state, state.candidates, new Date("2026-09-27T16:00:00Z"), "daily");
    expect(addCandidates(state, [candidate(id)]).candidates).toHaveLength(0);
    expect(state.sourceStats.source.published).toBe(1);
  });

  it("expires stories after 7 days, papers after 21, and publication history after 30", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    const state = {
      ...emptyCurationState(),
      candidates: [
        candidate("old-story", { discoveredAt: "2026-09-20T00:00:00Z" }),
        candidate("paper", { kind: "paper", discoveredAt: "2026-09-25T00:00:00Z" }),
      ],
      published: [{ id: "ancient", source: "s", topic: "t", kind: "story" as const, publishedAt: "2026-08-01T00:00:00Z" }],
    };
    const pruned = pruneCurationState(state, now);
    expect(pruned.candidates.map((item) => item.id)).toEqual(["paper"]);
    expect(pruned.published).toEqual([]);
  });

  it("drops a candidate after two failed summaries", () => {
    let state = { ...emptyCurationState(), candidates: [candidate("a")] };
    state = recordSummaryFailures(state, ["a"]);
    expect(state.candidates[0].summaryAttempts).toBe(1);
    state = recordSummaryFailures(state, ["a"]);
    expect(state.candidates).toEqual([]);
  });

  it("shortlists the requested lane and caps repeated sources", () => {
    const state = {
      ...emptyCurationState(),
      candidates: [
        candidate("a"), candidate("b"), candidate("c"),
        candidate("paper", { kind: "paper", source: "arxiv" }),
      ],
    };
    expect(buildShortlist(state, "daily", 10).map((item) => item.id)).toEqual(["a", "b"]);
    expect(buildShortlist(state, "research", 10).map((item) => item.id)).toEqual(["paper"]);
  });
});

describe("rank result and editions", () => {
  it("accepts NONE and rejects unknown, duplicate, or too many ids", () => {
    const allowed = new Set(["a", "b"]);
    expect(parseRankedIds('{"ids":[]}', allowed, 2)).toEqual([]);
    expect(parseRankedIds('<think>done</think>\n```json\n{"ids":["a"]}\n```', allowed, 2)).toEqual(["a"]);
    expect(parseRankedIds('{"ids":["x"]}', allowed, 2)).toBeNull();
    expect(parseRankedIds('{"ids":["a","a"]}', allowed, 2)).toBeNull();
    expect(parseRankedIds('{"ids":["a","b"]}', allowed, 1)).toBeNull();
  });

  it("uses an ISO week key across a year boundary", () => {
    expect(isoWeekKey(new Date("2027-01-01T16:00:00Z"))).toBe("2026-W53");
  });
});
