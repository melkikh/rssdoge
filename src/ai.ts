export async function summarizePost(post: {title: string | undefined, body: string}, ai: any, model: string, prompt: string, maxBodyTotal: number, tailSize: number): Promise<string> {
  if (!ai) return "";
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
    max_tokens: 600,
  });
  return result?.response?.trim() || "";
}
