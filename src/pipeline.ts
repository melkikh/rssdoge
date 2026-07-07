import type { Classification } from "./ai";
import { classifyPostDetailed, summarizePostDetailed } from "./ai";
import type { Post } from "./feed";
import type { AppConfig } from "./config";

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
  bullets: string;
};

const PREVIEW_HEAD = 120;
const PREVIEW_TAIL = 80;

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

export async function tracePost(
  post: Post,
  env: { AI: Ai },
  ctx: { config: PipelineConfig; sentry?: any },
  options: { skipSentry?: boolean } = {},
): Promise<PostTrace> {
  const config = ctx.config;
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

  if (!post.body) {
    return {
      pipeline: { step: "no_body", bare_header_reason: "no_body", logged_reasons: ["no_body"] },
      classifier: emptyClassifier,
      summary: emptySummary,
      bullets: "",
    };
  }

  if (post.body.length < config.minBodyChars) {
    return {
      pipeline: { step: "body_too_short", bare_header_reason: "body_too_short", logged_reasons: ["body_too_short"] },
      classifier: emptyClassifier,
      summary: emptySummary,
      bullets: "",
    };
  }

  let classifier = { ...emptyClassifier };
  let classification: Classification = "UNKNOWN";
  try {
    const res = await classifyPostDetailed(post, {
      ai: env.AI,
      model: config.aiModel,
      prompt: config.classifierPrompt,
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
      bullets: "",
    };
  }

  const loggedReasons: string[] = [];
  if (classification === "UNKNOWN") loggedReasons.push("classified_unknown");

  let summary = { ...emptySummary };
  let bullets = "";
  try {
    const res = await summarizePostDetailed(post, {
      ai: env.AI,
      model: config.aiModel,
      prompt: config.aiPrompt,
      maxBodyTotal: config.maxBodyTotal,
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
      bullets: "",
    };
  }

  return {
    pipeline: { step: "ok", bare_header_reason: null, logged_reasons: loggedReasons },
    classifier,
    summary,
    bullets,
  };
}
