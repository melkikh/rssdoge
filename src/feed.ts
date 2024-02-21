import { extract } from "@extractus/feed-extractor";

export async function fetchFeed(url, since, tag) {
  console.log(`[fetchFeed] start to fetch feed: ${url} since ${since}`);

  const response = await extract(
    url,
    {
      xmlParserOptions: {
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
      },
      getExtraEntryFields: (feedEntry) => {
        const { link } = feedEntry;
        return {
          links: Array.isArray(link)
            ? link.reduce((acc, cur) => {
                if (cur["@_rel"] === "alternate") {
                  return [...acc, cur["@_href"]];
                }
                return acc;
              }, [])
            : [],
        };
      },
    },
  );

  const posts = [];
  if (!response.entries) return posts;
  
  for (let item of response.entries) {
    const uniqueLinks = new Set();
    const candidate = {
      title: item.title,
      link: item.links.length > 0 ? item.links[0] : item.link,
      date: new Date(item.published),
      tag: tag,
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
