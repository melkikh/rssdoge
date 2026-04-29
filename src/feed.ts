import { extract } from "@extractus/feed-extractor";

export type Post = {title: string | undefined, link: any, date: Date, tag: any, body: string};

function stripHtml(raw: unknown, limit: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export async function fetchFeed(url, since, tag, bodyLimit: number) {
  console.log(`[fetchFeed] start to fetch feed: ${url} since ${since}`);

  const response = await extract(
    url,
    {
      xmlParserOptions: {
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
      },
      getExtraEntryFields: (feedEntry) => {
        const { link, description, "content:encoded": contentEncoded, content } = feedEntry as any;
        const rawContent = contentEncoded || content || description || "";
        return {
          links: Array.isArray(link)
            ? link.reduce((acc, cur) => {
                if (cur["@_rel"] === "alternate") {
                  return [...acc, cur["@_href"]];
                }
                return acc;
              }, [])
            : [],
          body: stripHtml(rawContent, bodyLimit),
        };
      },
    },
  );

  const posts: Post[] = [];
  if (!response.entries) return posts;

  const uniqueLinks = new Set();
  for (let item of response.entries) {
    const candidate = {
      title: item.title,
      link: (item as any).links?.length > 0 ? (item as any).links[0] : item.link,
      date: new Date(item.published ?? 0),
      tag: tag,
      body: (item as any).body || "",
    };

    if (candidate.date <= since || uniqueLinks.has(candidate.link)) {
      continue;
    }

    posts.push(candidate);
    uniqueLinks.add(candidate.link);
  }

  console.log(`Feed was fetched successfully: ${tag} (${posts.length} posts)`);
  return posts;
}
