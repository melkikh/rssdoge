import { describe, expect, it } from "vitest";
import {
  chunkParts,
  createPostMarkdown,
  sortDate,
  TELEGRAM_MAX_MESSAGE,
  type PostPart,
} from "../src/utils";

const part = (tag: string, text: string): PostPart => ({ post: { tag }, text });

describe("chunkParts", () => {
  it("packs several small posts into a single chunk", () => {
    const chunks = chunkParts([part("a", "hello"), part("b", "world")]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("hello\n\nworld");
    expect(chunks[0].posts).toEqual([{ tag: "a" }, { tag: "b" }]);
  });

  it("splits into multiple chunks when the batch exceeds max", () => {
    const chunks = chunkParts([part("a", "hello"), part("b", "world")], 10);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.text)).toEqual(["hello", "world"]);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(10);
  });

  it("truncates a single oversized post on a newline with an ellipsis", () => {
    const chunks = chunkParts([part("a", "line1\n" + "y".repeat(50))], 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text.length).toBeLessThanOrEqual(10);
    expect(chunks[0].text.endsWith("…")).toBe(true);
    expect(chunks[0].posts).toEqual([{ tag: "a" }]);
  });

  it("truncates an oversized post with no newline", () => {
    const chunks = chunkParts([part("a", "y".repeat(50))], 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text.length).toBeLessThanOrEqual(10);
    expect(chunks[0].text.endsWith("…")).toBe(true);
  });

  it("keeps real batches under the Telegram limit", () => {
    const parts = Array.from({ length: 40 }, (_, i) => part(`t${i}`, "x".repeat(300)));
    for (const c of chunkParts(parts)) {
      expect(c.text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE);
    }
  });
});

describe("createPostMarkdown", () => {
  it("renders a bare header with no bullets", () => {
    const md = createPostMarkdown({ title: "Hi", tag: "sec", link: "https://e.com/p" }, "");
    expect(md).toBe('#sec <a href="https://e.com/p">Hi</a>');
  });

  it("escapes HTML in title and & in the href", () => {
    const md = createPostMarkdown(
      { title: "A & B <x>", tag: "sec", link: "https://e.com/?a=1&b=2" },
      "",
    );
    expect(md).toContain("A &amp; B &lt;x&gt;");
    expect(md).toContain('href="https://e.com/?a=1&amp;b=2"');
  });

  it("escapes a double-quote in the href so the anchor can't break", () => {
    const md = createPostMarkdown(
      { title: "t", tag: "sec", link: 'https://e.com/"onmouseover=x' },
      "",
    );
    expect(md).toContain("&quot;onmouseover=x");
    expect(md).not.toMatch(/href="[^"]*"[^>]*"/); // no stray unescaped quote inside the attr
  });

  it("appends escaped bullets under the header", () => {
    const md = createPostMarkdown({ title: "t", tag: "sec", link: "https://e.com" }, "- one\n- two");
    expect(md).toBe('#sec <a href="https://e.com">t</a>\n- one\n- two');
  });

  it("prefixes whitepaper category tag in the header", () => {
    const md = createPostMarkdown(
      { title: "Paper", tag: "arxiv_cscr", link: "https://arxiv.org/abs/123" },
      "- bullet",
      "whitepaper",
    );
    expect(md).toBe(
      '#whitepaper #arxiv_cscr <a href="https://arxiv.org/abs/123">Paper</a>\n- bullet',
    );
  });

  it("marks bare-header whitepaper posts with category prefix", () => {
    const md = createPostMarkdown(
      { title: "Paper", tag: "arxiv_cscr", link: "https://arxiv.org/abs/123" },
      "",
      "whitepaper",
    );
    expect(md).toBe('#whitepaper #arxiv_cscr <a href="https://arxiv.org/abs/123">Paper</a>');
  });

  it("leaves blog posts without category prefix", () => {
    const md = createPostMarkdown({ title: "News", tag: "netsec", link: "https://e.com/n" }, "");
    expect(md).toBe('#netsec <a href="https://e.com/n">News</a>');
  });
});

describe("sortDate", () => {
  it("orders newest first", () => {
    const posts = [
      { date: new Date("2026-07-01T00:00:00Z") },
      { date: new Date("2026-07-05T00:00:00Z") },
      { date: new Date("2026-07-03T00:00:00Z") },
    ];
    const sorted = [...posts].sort(sortDate).map((p) => p.date.toISOString());
    expect(sorted).toEqual([
      "2026-07-05T00:00:00.000Z",
      "2026-07-03T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    ]);
  });

  it("returns 0 for equal timestamps (consistent comparator)", () => {
    const a = { date: new Date("2026-07-01T00:00:00Z") };
    const b = { date: new Date("2026-07-01T00:00:00Z") };
    expect(sortDate(a, b)).toBe(0);
    expect(sortDate(b, a)).toBe(0);
  });
});
