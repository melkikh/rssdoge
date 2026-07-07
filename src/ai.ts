export type SummaryResult = {
  bullets: string;
  finishReason: string | undefined;
  rejectedReason?: "cjk" | "empty";
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

function hasTooManyCJK(text: string): boolean {
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const isCJK =
      (cp >= 0x3400 && cp <= 0x9FFF) ||   // CJK Extension A + Unified Ideographs
      (cp >= 0x3040 && cp <= 0x30FF) ||   // Hiragana + Katakana
      (cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul syllables
      (cp >= 0xF900 && cp <= 0xFAFF);     // CJK Compatibility
    if (isCJK && ++count >= 2) return true;
  }
  return false;
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

export function sanitizeBullets(raw: string): { bullets: string; rejectedReason?: "cjk" | "empty" } {
  const trimmed = raw.trim();
  if (!trimmed) return { bullets: "", rejectedReason: "empty" };
  if (hasTooManyCJK(trimmed)) return { bullets: "", rejectedReason: "cjk" };
  const cleaned = normalizeBullets(stripMarkdown(trimmed));
  if (!cleaned) return { bullets: "", rejectedReason: "empty" };
  return { bullets: cleaned };
}

export async function summarizePostDetailed(
  post: { title: string | undefined; body: string },
  opts: { ai: Ai; model: string; prompt: string; maxBodyTotal: number; tailSize: number },
): Promise<SummaryResult & { rawOutput: string }> {
  const { ai, model, prompt, maxBodyTotal, tailSize } = opts;
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
  const { bullets, rejectedReason } = sanitizeBullets(rawOutput);
  return { bullets, finishReason: choice?.finish_reason, rejectedReason, rawOutput };
}
