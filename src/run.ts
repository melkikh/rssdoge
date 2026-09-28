import type { Toucan } from "toucan-js";
import type { AppConfig, Env } from "./config";
import type { Candidate, CurationState } from "./curation";
import {
  addCandidates,
  addSourceStats,
  buildShortlist,
  canonicalCandidateId,
  isoWeekKey,
  passesQualityFloor,
  prepareBodyExcerpt,
  pruneCurationState,
  recordSummaryFailures,
  removePublished,
  utcDateKey,
} from "./curation";
import { editorialGateDetailed, rankCandidatesDetailed, summarizePostDetailed } from "./ai";
import type { Post } from "./feed";
import { fetchFeed } from "./feed";
import {
  arxivPdfUrl,
  categoryPriorityFilter,
  enrichPostBody,
  getFeedConfig,
  resolveFeed,
  type EnrichBudget,
  type ResolvedFeed,
} from "./enrich";
import { KV } from "./kv";
import { Telegram } from "./telegram";
import { chunkParts, createPostMarkdown, TELEGRAM_MAX_MESSAGE } from "./utils";

export type RunContext = {
  config: AppConfig;
  kv: KV;
  sentry: Toucan;
};

type FetchResult = {
  posts: Post[];
  failedTags: Set<string>;
  feedLinksByTag: Record<string, string[]>;
  offtopicByTag: Record<string, number>;
};

function capture(ctx: RunContext, message: string, cause: unknown) {
  ctx.sentry.captureException(new Error(message, { cause }));
}

async function persistNeurons(ctx: RunContext, delta: number) {
  if (delta <= 0) return;
  try {
    await ctx.kv.addNeuronEstimate(delta);
  } catch (err) {
    capture(ctx, "Failed to persist neuron estimate", err);
  }
}

function displayLink(feed: ResolvedFeed, link: string): string {
  return feed.pdfLink ? (arxivPdfUrl(link) ?? link) : link;
}

async function fetchSources(
  ctx: RunContext,
  sources: Array<[string, ResolvedFeed]>,
  ages: Record<string, string>,
  seen: Record<string, string[]>,
  now: Date,
): Promise<FetchResult> {
  const failedTags = new Set<string>();
  const feedLinksByTag: Record<string, string[]> = {};
  const offtopicByTag: Record<string, number> = {};
  const floor = now.getTime() - ctx.config.maxLookbackDays * 86_400_000;
  const results = await Promise.all(sources.map(async ([tag, feed]) => {
    const cursor = ages[tag] ? new Date(ages[tag]).getTime() : 0;
    const since = feed.dedup === "link" ? new Date(0) : new Date(Math.max(cursor, floor));
    try {
      const items = await fetchFeed(feed.url, {
        since,
        tag,
        maxBodyTotal: feed.maxBodyTotal ?? ctx.config.maxBodyTotal,
        timeoutMs: ctx.config.feedTimeoutMs,
      });
      feedLinksByTag[tag] = items.map((post) => post.link);
      const relevant = categoryPriorityFilter(items, feed);
      if (feed.categoryPriority) offtopicByTag[tag] = items.length - relevant.length;
      const unseen = feed.dedup === "link"
        ? relevant.filter((post) => !(seen[tag] ?? []).includes(post.link))
        : relevant;
      const ordered = [...unseen].sort((a, b) => b.date.getTime() - a.date.getTime());
      return feed.maxItems === undefined ? ordered : ordered.slice(0, feed.maxItems);
    } catch (err) {
      failedTags.add(tag);
      capture(ctx, `Failed to fetch '${tag}' feed`, err);
      return [];
    }
  }));
  return { posts: results.flat(), failedTags, feedLinksByTag, offtopicByTag };
}

export function roundRobinPosts(posts: Post[], limit: number, tagOrder: string[] = []): Post[] {
  const groups = new Map<string, Post[]>();
  for (const post of posts) {
    const group = groups.get(post.tag) ?? [];
    group.push(post);
    groups.set(post.tag, group);
  }
  for (const group of groups.values()) group.sort((a, b) => b.date.getTime() - a.date.getTime());
  const orderedGroups = [
    ...tagOrder.map((tag) => groups.get(tag)).filter((group): group is Post[] => !!group),
    ...[...groups.entries()]
      .filter(([tag]) => !tagOrder.includes(tag))
      .map(([, group]) => group),
  ];
  const result: Post[] = [];
  while (result.length < limit) {
    let added = false;
    for (const group of orderedGroups) {
      const post = group.shift();
      if (!post) continue;
      result.push(post);
      added = true;
      if (result.length >= limit) break;
    }
    if (!added) break;
  }
  return result;
}

function cursorUpdates(
  sources: Array<[string, ResolvedFeed]>,
  failedTags: Set<string>,
  fetchedTags: Set<string>,
  maxProcessedDate: Record<string, Date>,
  now: Date,
): Record<string, Date> {
  const updates: Record<string, Date> = {};
  for (const [tag, feed] of sources) {
    if (failedTags.has(tag) || feed.dedup === "link") continue;
    if (maxProcessedDate[tag]) updates[tag] = maxProcessedDate[tag];
    else if (!fetchedTags.has(tag)) updates[tag] = now;
  }
  return updates;
}

type IngestPersistence = {
  state: CurationState;
  cursors: Record<string, Date>;
  processedLinks: Record<string, string[]>;
  feedLinks: Record<string, string[]>;
  neuronDelta: number;
  stats: Parameters<KV["updateStats"]>[0];
};

export async function persistIngestResults(ctx: RunContext, result: IngestPersistence): Promise<void> {
  await ctx.kv.putCurationState(result.state);

  if (Object.keys(result.cursors).length > 0) {
    try {
      await ctx.kv.updateValues(result.cursors);
    } catch (err) {
      capture(ctx, "Failed to persist date cursors", err);
    }
  }
  if (Object.keys(result.feedLinks).length > 0) {
    try {
      await ctx.kv.updateSeen(result.processedLinks, result.feedLinks);
    } catch (err) {
      capture(ctx, "Failed to persist seen links", err);
    }
  }
  if (result.neuronDelta > 0) {
    try {
      await ctx.kv.addNeuronEstimate(result.neuronDelta);
    } catch (err) {
      capture(ctx, "Failed to persist neuron estimate", err);
    }
  }
  try {
    await ctx.kv.updateStats(result.stats);
  } catch (err) {
    capture(ctx, "Failed to persist stats", err);
  }
}

export async function ingest(
  env: Env,
  ctx: RunContext,
  now: Date,
  lane: "story" | "paper",
): Promise<void> {
  const laneSources = Object.entries(ctx.config.feeds)
    .map(([tag, entry]) => [tag, resolveFeed(entry)] as [string, ResolvedFeed])
    .filter(([, feed]) => lane === "paper" ? feed.kind === "paper" : feed.kind !== "paper");
  let sources = laneSources;
  if (lane === "story") {
    const stable = laneSources.filter(([, feed]) => feed.tier !== "scout");
    const scouts = laneSources.filter(([, feed]) => feed.tier === "scout");
    const offset = scouts.length === 0 ? 0 : Math.floor(now.getTime() / 86_400_000) % scouts.length;
    const rotated = [...scouts.slice(offset), ...scouts.slice(0, offset)];
    sources = [...stable, ...rotated.slice(0, ctx.config.scoutSourcesPerRun)];
  }
  const [ages, seen, storedState] = await Promise.all([
    ctx.kv.getAll(),
    ctx.kv.getSeen(),
    ctx.kv.getCurationState(),
  ]);
  const fetched = await fetchSources(ctx, sources, ages, seen, now);
  const maxPosts = lane === "paper" ? ctx.config.paperIngestMaxPosts : ctx.config.storyIngestMaxPosts;
  const specialTags = sources
    .filter(([, feed]) => feed.kind === "analysis" || feed.tier === "discovery")
    .map(([tag]) => tag);
  const regularTags = sources
    .filter(([, feed]) => feed.kind !== "analysis" && feed.tier !== "discovery")
    .map(([tag]) => tag);
  const offset = regularTags.length === 0
    ? 0
    : Math.floor(now.getTime() / 86_400_000) % regularTags.length;
  const tagOrder = [...specialTags, ...regularTags.slice(offset), ...regularTags.slice(0, offset)];
  const posts = roundRobinPosts(fetched.posts, maxPosts, tagOrder);
  const fetchedTags = new Set(fetched.posts.map((post) => post.tag));
  const maxProcessedDate: Record<string, Date> = {};
  const processedLinks: Record<string, string[]> = {};
  const candidates: Candidate[] = [];
  const sourceStats: Record<string, { fetched: number; evaluated: number; kept: number; dropped: number; invalid: number }> = {};
  for (const post of fetched.posts) {
    const stats = sourceStats[post.tag] ??= { fetched: 0, evaluated: 0, kept: 0, dropped: 0, invalid: 0 };
    stats.fetched++;
  }
  const processingFailedTags = new Set<string>();
  const enrichBudget: EnrichBudget = { remaining: lane === "story" ? 2 : 0, spent: 0 };
  let neuronDelta = 0;

  for (const post of posts) {
    const feed = getFeedConfig(ctx.config.feeds, post.tag)!;
    const markProcessed = () => {
      if (feed.dedup === "link") {
        (processedLinks[post.tag] ??= []).push(post.link);
      } else {
        const previous = maxProcessedDate[post.tag];
        if (!previous || post.date > previous) maxProcessedDate[post.tag] = post.date;
      }
    };

    let body = post.body;
    if (feed.enrichBody) {
      const enriched = await enrichPostBody(post.link, feed, env, {
        timeoutMs: ctx.config.feedTimeoutMs,
        budget: enrichBudget,
      });
      if (enriched.success) body = enriched.body;
    }
    if (!post.title || !post.link || body.length < ctx.config.minBodyChars) {
      sourceStats[post.tag].dropped++;
      markProcessed();
      continue;
    }

    try {
      sourceStats[post.tag].evaluated++;
      const gate = await editorialGateDetailed(
        { title: post.title, body, source: post.tag, kind: feed.kind },
        {
          ai: env.AI,
          model: ctx.config.gateModel,
          prompt: ctx.config.editorialGatePrompt,
          maxBodyChars: ctx.config.gateMaxBodyChars,
        },
      );
      neuronDelta += 2;
      if (!gate.verdict) {
        sourceStats[post.tag].invalid++;
        processingFailedTags.add(post.tag);
        capture(ctx, `Editorial gate returned invalid JSON for '${post.title}' [${post.tag}]`, gate.rawOutput);
        continue;
      }
      markProcessed();
      if (!passesQualityFloor(feed.kind, gate.verdict)) {
        sourceStats[post.tag].dropped++;
        continue;
      }
      sourceStats[post.tag].kept++;
      candidates.push({
        id: canonicalCandidateId(post.link),
        title: post.title,
        link: post.link,
        displayLink: displayLink(feed, post.link),
        source: post.tag,
        kind: feed.kind,
        tier: feed.tier,
        publishedAt: post.date.toISOString(),
        discoveredAt: now.toISOString(),
        body: prepareBodyExcerpt(
          body,
          feed.maxBodyTotal ?? ctx.config.maxBodyTotal,
          ctx.config.tailSize,
        ),
        verdict: gate.verdict,
        summaryAttempts: 0,
      });
    } catch (err) {
      sourceStats[post.tag].invalid++;
      processingFailedTags.add(post.tag);
      capture(ctx, `Editorial gate failed for '${post.title}' [${post.tag}]`, err);
    }
  }

  const state = addSourceStats(
    addCandidates(pruneCurationState(storedState, now), candidates),
    sourceStats,
  );
  const successfulFeedLinks: Record<string, string[]> = {};
  for (const [tag, links] of Object.entries(fetched.feedLinksByTag)) {
    if (!fetched.failedTags.has(tag) && getFeedConfig(ctx.config.feeds, tag)?.dedup === "link") {
      successfulFeedLinks[tag] = links;
    }
  }
  const postsByTag: Record<string, { count: number; maxDate: Date }> = {};
  for (const post of fetched.posts) {
    const current = postsByTag[post.tag];
    if (!current) postsByTag[post.tag] = { count: 1, maxDate: post.date };
    else {
      current.count++;
      if (post.date > current.maxDate) current.maxDate = post.date;
    }
  }
  await persistIngestResults(ctx, {
    state,
    cursors: cursorUpdates(
      sources,
      new Set([...fetched.failedTags, ...processingFailedTags]),
      fetchedTags,
      maxProcessedDate,
      now,
    ),
    processedLinks,
    feedLinks: successfulFeedLinks,
    neuronDelta,
    stats: {
      now,
      ranTags: sources.map(([tag]) => tag).filter((tag) => !fetched.failedTags.has(tag)),
      postsByTag,
      offtopicByTag: fetched.offtopicByTag,
    },
  });
}

function rankPromptCandidates(candidates: Candidate[]): string {
  return candidates.map((candidate) => candidate.id).join(",");
}

async function summarizeCandidate(
  candidate: Candidate,
  env: Env,
  ctx: RunContext,
  enrichBudget: EnrichBudget,
): Promise<string> {
  const feed = getFeedConfig(ctx.config.feeds, candidate.source);
  let body = candidate.body;
  if (feed && (feed.enrichAfterPass || feed.readPdf)) {
    const enriched = await enrichPostBody(candidate.link, feed, env, {
      timeoutMs: ctx.config.feedTimeoutMs,
      budget: enrichBudget,
    });
    if (enriched.success) body = enriched.body;
  }
  const result = await summarizePostDetailed(
    {
      title: candidate.title,
      body: `Kind: ${candidate.kind}\nSource: ${candidate.source}\n\n${body}`,
    },
    {
      ai: env.AI,
      model: ctx.config.summaryModel,
      prompt: ctx.config.editorialSummaryPrompt,
      maxBodyTotal: feed?.maxBodyTotal ?? ctx.config.maxBodyTotal,
      tailSize: ctx.config.tailSize,
    },
  );
  const maxBullets = candidate.kind === "paper" ? 2 : 3;
  return result.bullets.split("\n").slice(0, maxBullets).join("\n");
}

function fitOneMessage(parts: Array<{ candidate: Candidate; text: string }>) {
  const included: Array<{ candidate: Candidate; text: string }> = [];
  let length = 0;
  for (const part of parts) {
    const text = chunkParts([{ post: { tag: part.candidate.source }, text: part.text }])[0]?.text ?? "";
    const extra = text.length + (included.length ? 2 : 0);
    if (!text || length + extra > TELEGRAM_MAX_MESSAGE) continue;
    included.push({ candidate: part.candidate, text });
    length += extra;
  }
  return {
    candidates: included.map((part) => part.candidate),
    text: included.map((part) => part.text).join("\n\n"),
  };
}

export async function publish(env: Env, ctx: RunContext, now: Date): Promise<void> {
  let state = pruneCurationState(await ctx.kv.getCurationState(), now);
  const edition = now.getUTCDay() === 5 ? "research" : "daily";
  const editionKey = edition === "research" ? isoWeekKey(now) : utcDateKey(now);
  if (state.editions[edition] === editionKey) return;

  const shortlistSize = edition === "research"
    ? ctx.config.researchShortlistSize
    : ctx.config.dailyShortlistSize;
  const maxItems = edition === "research" ? ctx.config.researchMaxItems : ctx.config.dailyMaxItems;
  const shortlist = buildShortlist(state, edition, shortlistSize);
  if (shortlist.length === 0) {
    state = removePublished(state, [], now, edition);
    await ctx.kv.putCurationState(state);
    return;
  }

  let ids: string[] | null = null;
  try {
    const ranked = await rankCandidatesDetailed(shortlist, {
      ai: env.AI,
      model: ctx.config.rankModel,
      prompt: ctx.config.editorialRankPrompt,
      maxItems,
      recentTopics: state.published.map((item) => item.topic),
    });
    ids = ranked.ids;
    if (ids === null) throw new Error(`Invalid rank output: ${ranked.rawOutput.slice(0, 500)}`);
  } catch (err) {
    capture(ctx, `Editorial ranking failed [${rankPromptCandidates(shortlist)}]`, err);
    await persistNeurons(ctx, 2);
    return;
  }
  if (ids.length === 0) {
    state = removePublished(state, [], now, edition);
    await ctx.kv.putCurationState(state);
    await persistNeurons(ctx, 2);
    return;
  }

  const byId = new Map(shortlist.map((candidate) => [candidate.id, candidate]));
  const enrichBudget: EnrichBudget = { remaining: maxItems, spent: 0 };
  const parts: Array<{ candidate: Candidate; text: string }> = [];
  const summaryFailures: string[] = [];
  let neuronDelta = 2;
  for (const id of ids) {
    const candidate = byId.get(id);
    if (!candidate) continue;
    try {
      const bullets = await summarizeCandidate(candidate, env, ctx, enrichBudget);
      neuronDelta += 40;
      if (!bullets) {
        summaryFailures.push(candidate.id);
        capture(ctx, `Summary was empty for '${candidate.title}' [${candidate.source}]`, "empty summary");
        continue;
      }
      parts.push({
        candidate,
        text: createPostMarkdown(
          { title: candidate.title, tag: candidate.source, link: candidate.link },
          bullets,
          candidate.kind === "paper" ? "whitepaper" : undefined,
          candidate.displayLink,
        ),
      });
    } catch (err) {
      summaryFailures.push(candidate.id);
      capture(ctx, `Failed to summarize '${candidate.title}' [${candidate.source}]`, err);
    }
  }

  const message = fitOneMessage(parts);
  state = recordSummaryFailures(state, summaryFailures);
  if (!message.text) {
    if (summaryFailures.length > 0) await ctx.kv.putCurationState(state);
    await persistNeurons(ctx, neuronDelta);
    return;
  }
  const bot = new Telegram({ token: ctx.config.telegramToken, chatID: ctx.config.telegramChatID });
  await bot.sendMessage(message.text, {
    disablePreview: message.candidates.some((candidate) => candidate.kind === "paper"),
  });
  state = removePublished(state, message.candidates, now, edition);
  await ctx.kv.putCurationState(state);
  await persistNeurons(ctx, neuronDelta);
}

export async function runScheduled(
  event: ScheduledController,
  env: Env,
  ctx: RunContext,
): Promise<void> {
  const now = new Date(event.scheduledTime || Date.now());
  const hour = now.getUTCHours();
  if (hour === 16) return publish(env, ctx, now);
  return ingest(env, ctx, now, hour === 12 ? "paper" : "story");
}
