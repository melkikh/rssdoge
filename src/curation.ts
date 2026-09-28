export type CandidateKind = "story" | "paper" | "analysis";
export type SourceTier = "core" | "scout" | "discovery";

export type EditorialVerdict = {
  decision: "keep" | "drop";
  interest: number;
  novelty: number;
  practical: number;
  evidence: number;
  topic: string;
  reason: string;
};

export type Candidate = {
  id: string;
  title: string;
  link: string;
  displayLink?: string;
  source: string;
  kind: CandidateKind;
  tier: SourceTier;
  publishedAt: string;
  discoveredAt: string;
  body: string;
  verdict: EditorialVerdict;
  summaryAttempts: number;
};

export type PublishedCandidate = {
  id: string;
  source: string;
  topic: string;
  kind: CandidateKind;
  publishedAt: string;
};

export type SourceCurationStats = {
  fetched: number;
  evaluated: number;
  kept: number;
  dropped: number;
  invalid: number;
  published: number;
};

export type CurationState = {
  version: 1;
  candidates: Candidate[];
  published: PublishedCandidate[];
  sourceStats: Record<string, SourceCurationStats>;
  editions: {
    daily?: string;
    research?: string;
  };
};

export function emptyCurationState(): CurationState {
  return { version: 1, candidates: [], published: [], sourceStats: {}, editions: {} };
}

export function addSourceStats(
  state: CurationState,
  updates: Record<string, Partial<SourceCurationStats>>,
): CurationState {
  const sourceStats = { ...state.sourceStats };
  for (const [source, update] of Object.entries(updates)) {
    const current = sourceStats[source] ?? {
      fetched: 0,
      evaluated: 0,
      kept: 0,
      dropped: 0,
      invalid: 0,
      published: 0,
    };
    sourceStats[source] = {
      fetched: current.fetched + (update.fetched ?? 0),
      evaluated: current.evaluated + (update.evaluated ?? 0),
      kept: current.kept + (update.kept ?? 0),
      dropped: current.dropped + (update.dropped ?? 0),
      invalid: current.invalid + (update.invalid ?? 0),
      published: current.published + (update.published ?? 0),
    };
  }
  return { ...state, sourceStats };
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function score(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5
    ? value as number
    : null;
}

export function parseEditorialVerdict(raw: string): EditorialVerdict | null {
  const value = parseJsonObject(raw);
  if (!value || (value.decision !== "keep" && value.decision !== "drop")) return null;
  const interest = score(value.interest);
  const novelty = score(value.novelty);
  const practical = score(value.practical);
  const evidence = score(value.evidence);
  const topic = typeof value.topic === "string" ? value.topic.trim() : "";
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (interest === null || novelty === null || practical === null || evidence === null) return null;
  if (!topic || !reason) return null;
  return { decision: value.decision, interest, novelty, practical, evidence, topic, reason };
}

export function passesQualityFloor(kind: CandidateKind, verdict: EditorialVerdict): boolean {
  if (verdict.decision !== "keep" || verdict.interest < 4 || verdict.evidence < 3) return false;
  if (kind === "paper") return verdict.novelty >= 4 && verdict.practical >= 4;
  if (kind === "analysis") return verdict.novelty >= 4 && verdict.practical >= 3;
  return verdict.novelty >= 4 || verdict.practical >= 4;
}

export function canonicalCandidateId(link: string): string {
  try {
    const url = new URL(link);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|campaign$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return link.trim();
  }
}

export function addCandidates(state: CurationState, incoming: Candidate[]): CurationState {
  const published = new Set(state.published.map((item) => item.id));
  const byId = new Map(state.candidates.map((item) => [item.id, item]));
  for (const candidate of incoming) {
    if (!published.has(candidate.id) && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  return { ...state, candidates: [...byId.values()] };
}

const DAY_MS = 86_400_000;

export function prepareBodyExcerpt(body: string, max: number, tailSize: number): string {
  if (body.length <= max) return body;
  const tail = Math.min(tailSize, Math.floor(max / 2));
  return `${body.slice(0, max - tail)}\n...\n${body.slice(-tail)}`;
}

export function pruneCurationState(state: CurationState, now: Date): CurationState {
  const time = now.getTime();
  return {
    ...state,
    candidates: state.candidates.filter((candidate) => {
      const age = time - new Date(candidate.discoveredAt).getTime();
      return Number.isFinite(age) && age <= (candidate.kind === "paper" ? 9 : 3) * DAY_MS;
    }),
    published: state.published.filter((item) => {
      const age = time - new Date(item.publishedAt).getTime();
      return Number.isFinite(age) && age <= 14 * DAY_MS;
    }),
  };
}

function candidateScore(candidate: Candidate): number {
  const v = candidate.verdict;
  return v.interest * 3 + v.novelty * 3 + v.practical * 2 + v.evidence;
}

export function buildShortlist(
  state: CurationState,
  kind: "daily" | "research",
  limit: number,
): Candidate[] {
  const eligible = state.candidates
    .filter((candidate) => kind === "research" ? candidate.kind === "paper" : candidate.kind !== "paper")
    .sort((a, b) => candidateScore(b) - candidateScore(a)
      || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      || a.id.localeCompare(b.id));

  const sourceCount = new Map<string, number>();
  const topicCount = new Map<string, number>();
  const result: Candidate[] = [];
  const sourceLimit = kind === "research" ? limit : 2;
  for (const candidate of eligible) {
    const topic = candidate.verdict.topic.toLocaleLowerCase();
    if ((sourceCount.get(candidate.source) ?? 0) >= sourceLimit) continue;
    if ((topicCount.get(topic) ?? 0) >= 2) continue;
    result.push(candidate);
    sourceCount.set(candidate.source, (sourceCount.get(candidate.source) ?? 0) + 1);
    topicCount.set(topic, (topicCount.get(topic) ?? 0) + 1);
    if (result.length >= limit) break;
  }
  return result;
}

export function parseRankedIds(raw: string, allowed: Set<string>, max: number): string[] | null {
  const value = parseJsonObject(raw);
  if (!value || !Array.isArray(value.ids)) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of value.ids) {
    if (typeof id !== "string" || !allowed.has(id) || seen.has(id)) return null;
    ids.push(id);
    seen.add(id);
  }
  return ids.length <= max ? ids : null;
}

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isoWeekKey(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekDay = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekDay);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((day.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function removePublished(
  state: CurationState,
  candidates: Candidate[],
  now: Date,
  edition: "daily" | "research",
): CurationState {
  const ids = new Set(candidates.map((candidate) => candidate.id));
  const publishedAt = now.toISOString();
  const next = {
    ...state,
    candidates: state.candidates.filter((candidate) => !ids.has(candidate.id)),
    published: [
      ...state.published,
      ...candidates.map((candidate) => ({
        id: candidate.id,
        source: candidate.source,
        topic: candidate.verdict.topic,
        kind: candidate.kind,
        publishedAt,
      })),
    ],
    editions: {
      ...state.editions,
      [edition]: edition === "daily" ? utcDateKey(now) : isoWeekKey(now),
    },
  };
  const publishedBySource: Record<string, Partial<SourceCurationStats>> = {};
  for (const candidate of candidates) {
    publishedBySource[candidate.source] = {
      published: (publishedBySource[candidate.source]?.published ?? 0) + 1,
    };
  }
  return addSourceStats(next, publishedBySource);
}

export function recordSummaryFailures(
  state: CurationState,
  ids: string[],
  maxAttempts = 2,
): CurationState {
  const failed = new Set(ids);
  return {
    ...state,
    candidates: state.candidates
      .map((candidate) => failed.has(candidate.id)
        ? { ...candidate, summaryAttempts: (candidate.summaryAttempts ?? 0) + 1 }
        : candidate)
      .filter((candidate) => (candidate.summaryAttempts ?? 0) < maxAttempts),
  };
}
