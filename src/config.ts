import type { FeedEntry } from "./enrich";
import {
  EDITORIAL_GATE_PROMPT,
  EDITORIAL_RANK_PROMPT,
  EDITORIAL_SUMMARY_PROMPT,
} from "./prompts";

export interface Env {
  RSSDOGE: KVNamespace;
  AI: Ai;
  TELEGRAM_TOKEN: string;
  SENTRY_DSN: string;
  ENVIRONMENT?: string;
  BUILD_TIME?: string;
  RELEASE?: string;
}

export interface AppConfig {
  authentication: boolean;
  telegramToken: string;
  telegramChatID: string;
  gateModel: string;
  rankModel: string;
  summaryModel: string;
  minBodyChars: number;
  maxBodyTotal: number;
  tailSize: number;
  feedTimeoutMs: number;
  maxLookbackDays: number;
  feeds: Record<string, FeedEntry>;
  neuronDailyLimit: number;
  editorialGatePrompt: string;
  editorialRankPrompt: string;
  editorialSummaryPrompt: string;
  gateMaxBodyChars: number;
  storyIngestMaxPosts: number;
  paperIngestMaxPosts: number;
  scoutSourcesPerRun: number;
  dailyShortlistSize: number;
  researchShortlistSize: number;
  dailyMaxItems: number;
  researchMaxItems: number;
}

const FEEDS_PRODUCTION: Record<string, FeedEntry> = {
  arxiv_cscr: {
    url: "https://rss.arxiv.org/rss/cs.CR",
    pdfLink: true,
    dedup: "link",
    maxItems: 10,
    maxBodyTotal: 4000,
    kind: "paper",
    categoryPriority: {
      "cs.CR": 3,
      "cs.AI": 3,
      "cs.LG": 3,
      "cs.CL": 3,
      "cs.SE": 2,
      "cs.NI": 2,
      "cs.DC": 2,
    },
    categoryPriorityThreshold: 2,
  },
  portswigger_research: {
    url: "https://portswigger.net/research/rss",
    enrichAfterPass: true,
  },
  elastic_security_labs: "https://www.elastic.co/security-labs/rss/feed.xml",
  google_online_security: "http://feeds.feedburner.com/GoogleOnlineSecurityBlog",
  google_project_zero: "https://googleprojectzero.blogspot.com/feeds/posts/default",
  datadog_security: "https://securitylabs.datadoghq.com/rss/feed.xml",
  doyensec: "https://blog.doyensec.com/atom.xml",
  trailofbits: "https://blog.trailofbits.com/feed/",
  cloudflare_research: "https://blog.cloudflare.com/tag/research/rss",
  raesene: { url: "https://raesene.github.io/feed.xml", tier: "scout" },
  unskilled: { url: "https://unskilled.blog/index.xml", tier: "scout" },
  rami_mac: { url: "https://ramimac.me/feed.xml", tier: "scout" },
  kanenarraway: { url: "https://kanenarraway.com/index.xml", tier: "scout" },
  oblique_security: { url: "https://oblique.security/blog/feed.xml", tier: "scout" },
  pilotprotocol: { url: "https://pilotprotocol.network/blog/feed.xml", tier: "scout" },
  philvenables: {
    url: "https://www.philvenables.com/blog-feed.xml",
    kind: "analysis",
    enrichAfterPass: true,
  },
  hackernews_security: {
    url: "https://hnrss.org/frontpage?points=50",
    enrichBody: true,
    tier: "discovery",
  },
  lobsters_security: {
    url: "https://lobste.rs/t/security.rss",
    enrichBody: true,
    tier: "discovery",
  },
};

const FEEDS_DEVELOPMENT: Record<string, FeedEntry> = {
  cloudflare_workers: "https://blog.cloudflare.com/tag/workers/rss",
};

export default function config(env: Env): AppConfig {
  const shared = {
    telegramToken: env.TELEGRAM_TOKEN,
    gateModel: "@cf/zai-org/glm-4.7-flash",
    rankModel: "@cf/nvidia/nemotron-3-120b-a12b",
    summaryModel: "@cf/google/gemma-4-26b-a4b-it",
    minBodyChars: 100,
    maxBodyTotal: 10000,
    tailSize: 1500,
    feedTimeoutMs: 10000,
    maxLookbackDays: 2,
    neuronDailyLimit: 10000,
    editorialGatePrompt: EDITORIAL_GATE_PROMPT,
    editorialRankPrompt: EDITORIAL_RANK_PROMPT,
    editorialSummaryPrompt: EDITORIAL_SUMMARY_PROMPT,
    gateMaxBodyChars: 5000,
    storyIngestMaxPosts: 10,
    paperIngestMaxPosts: 10,
    scoutSourcesPerRun: 3,
    dailyShortlistSize: 12,
    researchShortlistSize: 30,
    dailyMaxItems: 1,
    researchMaxItems: 3,
  };

  const environments: Record<string, AppConfig> = {
    production: {
      ...shared,
      authentication: true,
      telegramChatID: "@secpaperboy",
      feeds: FEEDS_PRODUCTION,
    },
    development: {
      ...shared,
      authentication: false,
      telegramChatID: "51818321",
      feeds: FEEDS_DEVELOPMENT,
    },
  };
  return environments[env.ENVIRONMENT ?? ""];
}
