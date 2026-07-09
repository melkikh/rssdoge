import type { Classification } from "./ai";
import { classifyPostDetailed, summarizePostDetailed } from "./ai";
import type { Post } from "./feed";
import type { AppConfig } from "./config";
import type { KV } from "./kv";
import {
  type EnrichBudget,
  enrichPostBody,
  getWhitepaperFeedConfig,
} from "./enrich";

/** The config fields tracePost actually reads — keeps the test config small and honest. */
export type PipelineConfig = Pick<
  AppConfig,
  | "minBodyChars"
  | "aiModel"
  | "classifierPrompt"
  | "classifierMaxBodyChars"
  | "aiPrompt"
  | "maxBodyTotal"
  | "tailSize"
  | "whitepaperFeeds"
  | "whitepaperClassifierPrompt"
  | "whitepaperPrompt"
  | "whitepaperMaxBodyTotal"
  | "feedTimeoutMs"
  | "neuronGateThreshold"
>;

export type PipelineStep =
  | "no_body"
  | "body_too_short"
  | "classified_skip"
  | "summary_cjk"
  | "summary_empty"
  | "ok";

export type PostTrace = {
  pipeline: {
    step: PipelineStep;
    bare_header_reason: string | null;
    logged_reasons: string[];
  };
  classifier: {
    raw_output: string;
    classification: Classification;
    error: string | null;
  };
  summary: {
    raw_output: string;
    bullets: string;
    rejected_reason?: "cjk" | "empty";
    finish_reason?: string;
    error: string | null;
  };
  enrich?: {
    before_classify?: { success: boolean; reason?: string; source?: string };
    after_pass?: { success: boolean; reason?: string; source?: string };
  };
  bullets: string;
};

const PREVIEW_HEAD = 120;
const PREVIEW_TAIL = 80;

export function isWhitepaperTag(config: Pick<AppConfig, "whitepaperFeeds">, tag: string): boolean {
  return tag in config.whitepaperFeeds;
}

export function resolvePrompts(
  config: Pick<AppConfig, "classifierPrompt" | "aiPrompt" | "whitepaperFeeds" | "whitepaperClassifierPrompt" | "whitepaperPrompt">,
  tag: string,
): { classifierPrompt: string; summaryPrompt: string } {
  if (isWhitepaperTag(config, tag)) {
    return {
      classifierPrompt: config.whitepaperClassifierPrompt,
      summaryPrompt: config.whitepaperPrompt,
    };
  }
  return {
    classifierPrompt: config.classifierPrompt,
    summaryPrompt: config.aiPrompt,
  };
}

/** News-only date cursor (→ `now`); whitepaper tags dedup by link instead. See CLAUDE.md. */
export function buildCursorUpdates(
  successfulTags: string[],
  config: Pick<AppConfig, "whitepaperFeeds">,
  now: Date,
): Record<string, Date> {
  const updates: Record<string, Date> = {};
  for (const tag of successfulTags) {
    if (isWhitepaperTag(config, tag)) continue;
    updates[tag] = now;
  }
  return updates;
}

export function bodyPreview(body: string) {
  if (!body) return { length: 0, preview_head: "", preview_tail: "" };
  return {
    length: body.length,
    preview_head: body.slice(0, PREVIEW_HEAD),
    preview_tail: body.length > PREVIEW_HEAD ? body.slice(-PREVIEW_TAIL) : "",
  };
}

export function estimateNeurons(traces: Pick<PostTrace, "pipeline">[]): number {
  let total = 0;
  for (const { pipeline } of traces) {
    switch (pipeline.step) {
      case "no_body":
      case "body_too_short":
        break;
      case "classified_skip":
        total += 2;
        break;
      default:
        total += 40;
    }
  }
  return total;
}

const ENRICH_NEURON_ESTIMATE = 40;

async function maybeEnrich(
  post: Post,
  feed: NonNullable<ReturnType<typeof getWhitepaperFeedConfig>>,
  env: { AI: Ai },
  config: PipelineConfig,
  opts: {
    enrichBudget?: EnrichBudget;
    kv?: KV;
    skipNeuronGate?: boolean;
    mode: "before_classify" | "after_pass";
  },
): Promise<{ body: string; meta?: PostTrace["enrich"] extends infer E ? E : never }> {
  const needsBefore = feed.enrichBody && opts.mode === "before_classify";
  const needsAfter =
    opts.mode === "after_pass" && (feed.readPdf || feed.enrichAfterPass);
  if (!needsBefore && !needsAfter) return { body: post.body };

  if (opts.kv && !opts.skipNeuronGate) {
    const ok = await opts.kv.canSpendNeurons(ENRICH_NEURON_ESTIMATE, config.neuronGateThreshold);
    if (!ok) {
      const key = opts.mode === "before_classify" ? "before_classify" : "after_pass";
      return {
        body: post.body,
        meta: { [key]: { success: false, reason: "neuron_gate" } },
      };
    }
  }

  const result = await enrichPostBody(post.link, feed, env, {
    timeoutMs: config.feedTimeoutMs,
    budget: opts.enrichBudget,
  });
  const key = opts.mode === "before_classify" ? "before_classify" : "after_pass";
  const meta = {
    [key]: {
      success: result.success,
      reason: result.reason,
      source: result.source,
    },
  };
  if (result.success) return { body: result.body, meta };
  return { body: post.body, meta };
}

export async function tracePost(
  post: Post,
  env: { AI: Ai },
  ctx: { config: PipelineConfig; sentry?: any; kv?: KV; enrichBudget?: EnrichBudget },
  options: { skipSentry?: boolean; skipNeuronAccounting?: boolean } = {},
): Promise<PostTrace> {
  const config = ctx.config;
  const feedConfig = getWhitepaperFeedConfig(config.whitepaperFeeds, post.tag);
  let enrichMeta: PostTrace["enrich"];
  let workingBody = post.body;

  const emptyClassifier: PostTrace["classifier"] = {
    raw_output: "",
    classification: "UNKNOWN",
    error: null,
  };
  const emptySummary: PostTrace["summary"] = {
    raw_output: "",
    bullets: "",
    rejected_reason: undefined,
    finish_reason: undefined,
    error: null,
  };

  if (feedConfig?.enrichBody) {
    const needsEnrich = !workingBody || workingBody.length < config.minBodyChars;
    if (needsEnrich) {
      const { body, meta } = await maybeEnrich(
        { ...post, body: workingBody },
        feedConfig,
        env,
        config,
        {
          enrichBudget: ctx.enrichBudget,
          kv: ctx.kv,
          skipNeuronGate: options.skipNeuronAccounting,
          mode: "before_classify",
        },
      );
      if (meta) enrichMeta = { ...enrichMeta, ...meta };
      if (body) workingBody = body;
    }
  }

  if (!workingBody) {
    return {
      pipeline: { step: "no_body", bare_header_reason: "no_body", logged_reasons: ["no_body"] },
      classifier: emptyClassifier,
      summary: emptySummary,
      enrich: enrichMeta,
      bullets: "",
    };
  }

  if (workingBody.length < config.minBodyChars) {
    return {
      pipeline: { step: "body_too_short", bare_header_reason: "body_too_short", logged_reasons: ["body_too_short"] },
      classifier: emptyClassifier,
      summary: emptySummary,
      enrich: enrichMeta,
      bullets: "",
    };
  }

  let classifier = { ...emptyClassifier };
  let classification: Classification = "UNKNOWN";
  const classifyPost = { ...post, body: workingBody };
  const { classifierPrompt, summaryPrompt } = resolvePrompts(config, post.tag);
  const isWhitepaper = isWhitepaperTag(config, post.tag);
  try {
    const res = await classifyPostDetailed(classifyPost, {
      ai: env.AI,
      model: config.aiModel,
      prompt: classifierPrompt,
      maxBodyChars: config.classifierMaxBodyChars,
    });
    classifier = { raw_output: res.rawOutput, classification: res.classification, error: null };
    classification = res.classification;
  } catch (err) {
    classifier.error = String(err);
    if (!options.skipSentry) {
      ctx.sentry.captureException(
        new Error(`Failed to classify post '${post.title}' [${post.tag}]`, { cause: err }),
      );
    }
  }

  if (classification === "SKIP") {
    return {
      pipeline: {
        step: "classified_skip",
        bare_header_reason: "classified_skip",
        logged_reasons: ["classified_skip"],
      },
      classifier,
      summary: emptySummary,
      enrich: enrichMeta,
      bullets: "",
    };
  }

  if (feedConfig && (feedConfig.readPdf || feedConfig.enrichAfterPass)) {
    const { body, meta } = await maybeEnrich(
      { ...post, body: workingBody },
      feedConfig,
      env,
      config,
      {
        enrichBudget: ctx.enrichBudget,
        kv: ctx.kv,
        skipNeuronGate: options.skipNeuronAccounting,
        mode: "after_pass",
      },
    );
    if (meta) enrichMeta = { ...enrichMeta, ...meta };
    if (body && meta?.after_pass?.success) workingBody = body;
  }

  const loggedReasons: string[] = [];
  if (classification === "UNKNOWN") loggedReasons.push("classified_unknown");

  let summary = { ...emptySummary };
  let bullets = "";
  const summarizePost = { ...post, body: workingBody };
  try {
    const res = await summarizePostDetailed(summarizePost, {
      ai: env.AI,
      model: config.aiModel,
      prompt: summaryPrompt,
      maxBodyTotal: isWhitepaper ? config.whitepaperMaxBodyTotal : config.maxBodyTotal,
      tailSize: config.tailSize,
    });
    summary = {
      raw_output: res.rawOutput,
      bullets: res.bullets,
      rejected_reason: res.rejectedReason,
      finish_reason: res.finishReason,
      error: null,
    };
    bullets = res.bullets;
  } catch (err) {
    summary.error = String(err);
    if (!options.skipSentry) {
      ctx.sentry.captureException(
        new Error(`Failed to summarize post '${post.title}' [${post.tag}]`, { cause: err }),
      );
    }
  }

  if (bullets.trim() === "__SKIP_BULLETS__") bullets = "";

  if (!bullets) {
    const reason = summary.rejected_reason === "cjk" ? "summary_cjk" : "summary_empty";
    loggedReasons.push(reason);
    return {
      pipeline: { step: reason, bare_header_reason: reason, logged_reasons: loggedReasons },
      classifier,
      summary,
      enrich: enrichMeta,
      bullets: "",
    };
  }

  return {
    pipeline: { step: "ok", bare_header_reason: null, logged_reasons: loggedReasons },
    classifier,
    summary,
    enrich: enrichMeta,
    bullets,
  };
}
