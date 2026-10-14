import "server-only";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { aiSettings } from "./config";
import { traceUrl } from "./models";

// The AI dashboard (Story KRB-17), read with the user's rights: RLS on
// ai_generations shows a manager the whole workspace. The page itself is for
// owners and admins.

/** Periods the dashboard offers, in days. */
export const METRIC_PERIODS = [7, 30, 90] as const;

export type MetricPeriod = (typeof METRIC_PERIODS)[number];

export type PromptMetrics = {
  promptVersionId: string | null;
  templateKey: string | null;
  version: number | null;
  title: string | null;
  scope: "global" | "workspace" | null;
  model: string;
  generations: number;
  succeeded: number;
  failed: number;
  /** Failed over finished, 0 to 1. Null before any finished. */
  failureRate: number | null;
  accepted: number;
  discarded: number;
  /** Accepted over decided, 0 to 1. Null before any decision. */
  acceptanceRate: number | null;
  rated: number;
  /** From -1 (all thumbs down) to 1 (all thumbs up). Null without ratings. */
  meanRating: number | null;
  /** Words changed over words proposed, on accepted drafts. */
  meanEditRatio: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** USD, null when no price is set. */
  cost: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  /** Generations that came from a rollout of this version. */
  fromRollout: number;
  lastGeneration: string | null;
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Figures per prompt version and model over the last `days` days, latest first. */
export async function getPromptMetrics(
  workspaceId: string,
  days: MetricPeriod,
): Promise<PromptMetrics[] | null> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("ai_prompt_metrics", {
    p_workspace_id: workspaceId.toLowerCase(),
    p_since: since,
  });
  if (error || !data) {
    if (error) log.error("ai dashboard: could not read the metrics", { error: error.message });
    return null;
  }
  return data.map((row) => ({
    promptVersionId: row.prompt_version_id ?? null,
    templateKey: row.template_key ?? null,
    version: numberOrNull(row.version),
    title: row.title ?? null,
    scope: row.prompt_scope === "global" || row.prompt_scope === "workspace" ? row.prompt_scope : null,
    model: row.model,
    generations: Number(row.generations),
    succeeded: Number(row.succeeded),
    failed: Number(row.failed),
    failureRate: numberOrNull(row.failure_rate),
    accepted: Number(row.accepted),
    discarded: Number(row.discarded),
    acceptanceRate: numberOrNull(row.acceptance_rate),
    rated: Number(row.rated),
    meanRating: numberOrNull(row.mean_rating),
    meanEditRatio: numberOrNull(row.mean_edit_ratio),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    totalTokens: Number(row.total_tokens),
    cost: numberOrNull(row.cost),
    p50LatencyMs: numberOrNull(row.p50_latency_ms),
    p95LatencyMs: numberOrNull(row.p95_latency_ms),
    fromRollout: Number(row.from_rollout),
    lastGeneration: row.last_generation ?? null,
  }));
}

export type RecentGeneration = {
  id: string;
  createdAt: string;
  status: "running" | "succeeded" | "failed";
  errorCode: string | null;
  model: string;
  promptVersionId: string | null;
  promptTitle: string | null;
  promptVersion: number | null;
  fromRollout: boolean;
  latencyMs: number | null;
  totalTokens: number | null;
  cost: number | null;
  /** Link to the trace when tracing and AI_TRACE_URL_TEMPLATE are set. */
  traceUrl: string | null;
};

/** The latest generations of the workspace, with a link to their trace. */
export async function getRecentGenerations(workspaceId: string, limit = 20): Promise<RecentGeneration[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_generations")
    .select(
      "id, created_at, status, error_code, model, prompt_version_id, rollout_id, latency_ms, total_tokens, cost_estimate, trace_id, prompt:prompt_library(title, version)",
    )
    .eq("workspace_id", workspaceId.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  const settings = aiSettings();
  return (data ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    errorCode: row.error_code,
    model: row.model,
    promptVersionId: row.prompt_version_id,
    promptTitle: row.prompt?.title ?? null,
    promptVersion: row.prompt?.version ?? null,
    fromRollout: row.rollout_id !== null,
    latencyMs: row.latency_ms,
    totalTokens: row.total_tokens,
    cost: numberOrNull(row.cost_estimate),
    traceUrl: traceUrl(settings, row.trace_id),
  }));
}
