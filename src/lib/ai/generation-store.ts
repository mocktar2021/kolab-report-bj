import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { OutputSchema } from "@/lib/prompts/catalog";
import type { DraftFailure, TokenUsage } from "./generate";
import { OUTPUT_SCHEMA_VERSION } from "./schemas";
import type { GenerationContextMeta } from "./types";

// Writes to ai_generations, with the service role: users can't write these
// columns. Callers check first that the user can edit the section. Every
// query is scoped by workspace_id.

/** Longest raw answer kept, same bound as the column check. */
const RAW_OUTPUT_CHARS = 200_000;

export type StartRefusal = "rateLimited" | "budgetExceeded" | "busy" | "templateUnavailable";

export type StartResult =
  | { ok: true; id: string }
  | { ok: false; refusal: StartRefusal; retryAfter: number | null }
  | { ok: false; refusal: "generic"; retryAfter: null };

export type StartRequest = {
  workspaceId: string;
  sectionId: string;
  userId: string;
  promptVersionId: string;
  outputSchema: OutputSchema;
  provider: string;
  model: string;
  params: { temperature: number; maxOutputTokens: number; modelTier: string };
  estimatedTokens: number;
  rateLimitPerHour: number;
  monthlyTokenBudget: number;
};

const REFUSALS = new Set<string>(["rateLimited", "budgetExceeded", "busy", "templateUnavailable"]);

/**
 * Counts the request against the user's hourly limit and the workspace's
 * monthly budget, and records it as running, in one locked step.
 */
export async function startGeneration(request: StartRequest): Promise<StartResult> {
  const { data, error } = await createAdminClient()
    .rpc("start_ai_generation", {
      p_workspace_id: request.workspaceId,
      p_section_id: request.sectionId,
      p_user_id: request.userId,
      p_prompt_version_id: request.promptVersionId,
      p_output_schema: request.outputSchema,
      p_schema_version: OUTPUT_SCHEMA_VERSION,
      p_provider: request.provider,
      p_model: request.model,
      p_params: request.params,
      p_estimated_tokens: Math.min(request.estimatedTokens, 2_000_000_000),
      p_rate_limit: request.rateLimitPerHour,
      p_monthly_budget: request.monthlyTokenBudget,
    })
    .maybeSingle();
  if (error || !data) {
    console.error("ai drafts: could not start a generation", error?.message);
    return { ok: false, refusal: "generic", retryAfter: null };
  }
  if (data.generation_id) return { ok: true, id: data.generation_id };
  if (data.refusal && REFUSALS.has(data.refusal)) {
    return { ok: false, refusal: data.refusal as StartRefusal, retryAfter: data.retry_after ?? null };
  }
  return { ok: false, refusal: "generic", retryAfter: null };
}

export type GenerationOutcome = {
  usage: TokenUsage;
  costEstimate: number | null;
  latencyMs: number;
  rawOutput: string;
  repaired: boolean;
  inputHash: string | null;
  inputHashes: Record<string, string>;
  contextMeta: GenerationContextMeta | null;
  truncated: boolean;
} & (
  | { status: "succeeded"; output: Json; draftWords: number }
  | { status: "failed"; error: DraftFailure | "contextFailed" | "saveFailed" | "crashed" }
);

/** Records how a running generation ended. False when it was no longer running. */
export async function finishGeneration(
  id: string,
  workspaceId: string,
  outcome: GenerationOutcome,
): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("ai_generations")
    .update({
      status: outcome.status,
      error_code: outcome.status === "failed" ? outcome.error : null,
      output: outcome.status === "succeeded" ? outcome.output : null,
      draft_words: outcome.status === "succeeded" ? outcome.draftWords : null,
      raw_output: outcome.rawOutput.replaceAll("\u0000", "").slice(0, RAW_OUTPUT_CHARS) || null,
      input_tokens: outcome.usage.inputTokens,
      output_tokens: outcome.usage.outputTokens,
      cost_estimate: outcome.costEstimate,
      latency_ms: Math.max(0, Math.round(outcome.latencyMs)),
      repaired: outcome.repaired,
      input_hash: outcome.inputHash,
      input_hashes: outcome.inputHashes,
      context_meta: (outcome.contextMeta ?? {}) as NonNullable<Json>,
      truncated: outcome.truncated,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("status", "running")
    .select("id")
    .maybeSingle();
  if (error) console.error("ai drafts: could not record the outcome of a generation", error.message);
  return Boolean(data);
}
