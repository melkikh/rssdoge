export type SummaryResult = {
  bullets: string;
  finishReason: string | undefined;
  rejectedReason?: "cjk" | "empty";
  mixedScript?: string[];
};

export type Classification = "PASS" | "SKIP" | "UNKNOWN";

function extractContent(result: any): string {
  return (result?.choices?.[0]?.message?.content ?? result?.response ?? "").trim();
}

export async function classifyPostDetailed(
  post: { title: string | undefined; body: string },
  opts: { ai: Ai; model: string; prompt: string; maxBodyChars: number },
): Promise<{ classification: Classification; rawOutput: string }> {
  const { ai, model, prompt, maxBodyChars } = opts;
  if (!ai) return { classification: "UNKNOWN", rawOutput: "" };
  const bodyText = post.body ? post.body.slice(0, maxBodyChars) : "(no body)";
  const text = `Title: ${post.title}\n\n${bodyText}`;
  const result: any = await ai.run(model, {
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: text },
    ],
    max_completion_tokens: 10,
    chat_template_kwargs: { enable_thinking: false },
  });
  const rawOutput = extractContent(result);
  const raw = rawOutput.toUpperCase();
  if (raw.includes("SKIP")) return { classification: "SKIP", rawOutput };
  if (raw.includes("PASS")) return { classification: "PASS", rawOutput };
  return { classification: "UNKNOWN", rawOutput };
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
