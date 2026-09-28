import type { Candidate, CandidateKind, EditorialVerdict } from "./curation";
import { parseEditorialVerdict, parseRankedIds } from "./curation";

export type SummaryResult = {
  bullets: string;
  finishReason: string | undefined;
  rejectedReason?: "cjk" | "empty";
  mixedScript?: string[];
};

function extractContent(result: any): string {
  return (result?.choices?.[0]?.message?.content ?? result?.response ?? "").trim();
}

function clippedBody(body: string, max: number): string {
  if (body.length <= max) return body;
  const tail = Math.min(800, Math.floor(max / 4));
  return `${body.slice(0, max - tail)}\n...\n${body.slice(-tail)}`;
}

export async function editorialGateDetailed(
  post: { title: string | undefined; body: string; source: string; kind: CandidateKind },
  opts: { ai: Ai; model: string; prompt: string; maxBodyChars: number },
): Promise<{ verdict: EditorialVerdict | null; rawOutput: string }> {
  const text = [
    `Kind: ${post.kind}`,
    `Source: ${post.source}`,
    `Title: ${post.title ?? ""}`,
    "",
    clippedBody(post.body, opts.maxBodyChars),
  ].join("\n");
  const result: any = await opts.ai.run(opts.model, {
    messages: [
      { role: "system", content: opts.prompt },
      { role: "user", content: text },
    ],
    max_completion_tokens: 300,
    chat_template_kwargs: { enable_thinking: false },
  });
  const rawOutput = extractContent(result);
  return { verdict: parseEditorialVerdict(rawOutput), rawOutput };
}

export async function rankCandidatesDetailed(
  candidates: Candidate[],
  opts: { ai: Ai; model: string; prompt: string; maxItems: number; recentTopics?: string[] },
): Promise<{ ids: string[] | null; rawOutput: string }> {
  const aliases = new Map(candidates.map((candidate, index) => [`c${index + 1}`, candidate.id]));
  const compact = candidates.map((candidate, index) => ({
    id: `c${index + 1}`,
    kind: candidate.kind,
    source: candidate.source,
    title: candidate.title,
    topic: candidate.verdict.topic,
    reason: candidate.verdict.reason,
    scores: {
      interest: candidate.verdict.interest,
      novelty: candidate.verdict.novelty,
      practical: candidate.verdict.practical,
      evidence: candidate.verdict.evidence,
    },
    excerpt: candidate.body.slice(0, 700),
  }));
  const text = [
    `Maximum: ${opts.maxItems}`,
    `Recently published topics: ${JSON.stringify(opts.recentTopics ?? [])}`,
    `Candidates: ${JSON.stringify(compact)}`,
  ].join("\n");
  const result: any = await opts.ai.run(opts.model, {
    messages: [
      { role: "system", content: opts.prompt },
      { role: "user", content: text },
    ],
    max_completion_tokens: 400,
    chat_template_kwargs: { enable_thinking: false },
  });
  const rawOutput = extractContent(result);
  const rankedAliases = parseRankedIds(rawOutput, new Set(aliases.keys()), opts.maxItems);
  const ids = rankedAliases?.map((alias) => aliases.get(alias)!) ?? rankedAliases;
  return { ids, rawOutput };
}

function hasTooManyCJK(text: string, threshold = 2): boolean {
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const isCJK =
      (cp >= 0x3400 && cp <= 0x9FFF) ||
      (cp >= 0x3040 && cp <= 0x30FF) ||
      (cp >= 0xAC00 && cp <= 0xD7AF) ||
      (cp >= 0xF900 && cp <= 0xFAFF);
    if (isCJK && ++count >= threshold) return true;
  }
  return false;
}

// Stray Latin inside an otherwise-Cyrillic word (e.g. "состtированные") — a model glitch
// the CJK check can't see. Signal = one pure-letter run (\p{L}+, so apostrophes/hyphens/
// digits are separators) mixing both scripts. Legit mixes are split by those separators
// ("patch'а", "MCP-сервер", "IPv6"), so they don't trip it. Log-only, never drops. See CLAUDE.md.
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const LATIN_RE = /\p{Script=Latin}/u;
export function mixedScriptTokens(text: string): string[] {
  const hits: string[] = [];
  for (const tok of text.match(/\p{L}+/gu) ?? []) {
    if (CYRILLIC_RE.test(tok) && LATIN_RE.test(tok)) hits.push(tok);
  }
  return hits;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "$1")
    .replace(/^#+\s+/gm, "");
}

function normalizeBullets(text: string): string {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return "";
  return lines.map(l => {
    const m = l.match(/^[-•*]\s+(.*)$/);
    return "- " + (m ? m[1] : l);
  }).join("\n");
}

export function sanitizeBullets(
  raw: string,
  opts: { cjkThreshold?: number } = {},
): { bullets: string; rejectedReason?: "cjk" | "empty" } {
  const trimmed = raw.trim();
  if (!trimmed) return { bullets: "", rejectedReason: "empty" };
  if (hasTooManyCJK(trimmed, opts.cjkThreshold ?? 2)) {
    return { bullets: "", rejectedReason: "cjk" };
  }
  const cleaned = normalizeBullets(stripMarkdown(trimmed));
  if (!cleaned) return { bullets: "", rejectedReason: "empty" };
  return { bullets: cleaned };
}

export async function summarizePostDetailed(
  post: { title: string | undefined; body: string },
  opts: {
    ai: Ai;
    model: string;
    prompt: string;
    maxBodyTotal: number;
    tailSize: number;
    cjkThreshold?: number;
  },
): Promise<SummaryResult & { rawOutput: string }> {
  const { ai, model, prompt, maxBodyTotal, tailSize, cjkThreshold } = opts;
  if (!ai) return { bullets: "", finishReason: undefined, rawOutput: "" };
  if (!post.body) throw new Error(`Post '${post.title}' has no body`);

  let bodyText: string;
  if (post.body.length <= maxBodyTotal) {
    bodyText = post.body;
  } else {
    const headEnd = maxBodyTotal - tailSize;
    bodyText = post.body.slice(0, headEnd) + "\n...\n" + post.body.slice(-tailSize);
  }

  const text = `Title: ${post.title}\n\n${bodyText}`;

  const result: any = await ai.run(model, {
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: text },
    ],
    max_completion_tokens: 2000,
    chat_template_kwargs: { enable_thinking: false },
  });
  const choice = result?.choices?.[0];
  const rawOutput = extractContent(result);
  const { bullets, rejectedReason } = sanitizeBullets(rawOutput, { cjkThreshold });
  const mixed = bullets ? mixedScriptTokens(bullets) : [];
  return {
    bullets,
    finishReason: choice?.finish_reason,
    rejectedReason,
    mixedScript: mixed.length ? mixed : undefined,
    rawOutput,
  };
}
