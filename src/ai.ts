export type SummaryResult = {
  bullets: string;
  finishReason: string | undefined;
};

export async function summarizePost(post: {title: string | undefined, body: string}, ai: any, model: string, prompt: string, maxBodyTotal: number, tailSize: number): Promise<SummaryResult> {
  if (!ai) return { bullets: "", finishReason: undefined };
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
      {
        role: "system",
        content: prompt,
      },
      { role: "user", content: text },
    ],
    max_completion_tokens: 2000,
    chat_template_kwargs: { enable_thinking: false },
  });
  const choice = result?.choices?.[0];
  const bullets = (
    choice?.message?.content?.trim()
    ?? result?.response?.trim()
    ?? ""
  );
  return { bullets, finishReason: choice?.finish_reason };
}
