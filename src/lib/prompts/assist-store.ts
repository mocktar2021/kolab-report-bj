import "server-only";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// The ledger of "Rédiger avec l'IA" (KRB-198), public.prompt_assist_calls,
// written with the service role through the two functions of migration
// 20261017120000_prompt_assist.sql. Callers check the role and the plan
// first; the functions check both again. Every call names the workspace.

export type AssistRefusal = "forbidden" | "readOnly" | "templatesNotIncluded" | "rateLimited";

export type AssistStart =
  | { ok: true; id: string }
  | { ok: false; refusal: AssistRefusal; retryAfter: number | null }
  | { ok: false; refusal: "generic"; retryAfter: null };

const REFUSALS = new Set<string>(["forbidden", "readOnly", "templatesNotIncluded", "rateLimited"]);

/** Counts the call against the person's daily limit and records it as running, in one locked step. */
export async function startPromptAssist(request: {
  workspaceId: string;
  userId: string;
  provider: string;
  model: string;
  inputChars: number;
  dailyLimit: number;
}): Promise<AssistStart> {
  const { data, error } = await createAdminClient()
    .rpc("start_prompt_assist", {
      p_workspace_id: request.workspaceId,
      p_user_id: request.userId,
      p_provider: request.provider,
      p_model: request.model,
      p_input_chars: Math.max(0, Math.min(request.inputChars, 10_000)),
      p_daily_limit: request.dailyLimit,
    })
    .maybeSingle();
  if (error || !data) {
    log.error("template writer: could not start a call", { error: error?.message });
    return { ok: false, refusal: "generic", retryAfter: null };
  }
  if (data.call_id) return { ok: true, id: data.call_id };
  if (data.refusal && REFUSALS.has(data.refusal)) {
    return { ok: false, refusal: data.refusal as AssistRefusal, retryAfter: data.retry_after ?? null };
  }
  return { ok: false, refusal: "generic", retryAfter: null };
}

export type AssistOutcome = {
  status: "succeeded" | "failed";
  errorCode: string | null;
  usage: { inputTokens: number; outputTokens: number };
  costEstimate: number | null;
  latencyMs: number;
  traceId: string | null;
};

/** Records how a running call ended. False when it was no longer running. */
export async function finishPromptAssist(
  id: string,
  workspaceId: string,
  outcome: AssistOutcome,
): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("finish_prompt_assist", {
    p_call_id: id,
    p_workspace_id: workspaceId,
    p_status: outcome.status,
    // The generated types have no null for these two arguments, but the
    // function takes it: no error code on a success, no cost without prices.
    p_error_code: outcome.errorCode as string,
    p_input_tokens: Math.max(0, Math.round(outcome.usage.inputTokens)),
    p_output_tokens: Math.max(0, Math.round(outcome.usage.outputTokens)),
    p_cost_estimate: outcome.costEstimate as number,
    p_latency_ms: Math.max(0, Math.round(outcome.latencyMs)),
    ...(outcome.traceId ? { p_trace_id: outcome.traceId } : {}),
  });
  if (error) log.error("template writer: could not record the end of a call", { error: error.message });
  return data === true;
}
