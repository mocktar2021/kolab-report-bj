import "server-only";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TokenUsage } from "@/lib/ai/generate";

// Records the AI readings of PDF plans in plan_import_calls, with the service
// role: users only read these rows. The database checks the role, the
// report, the hourly limit and the AI drafts of the plan again, and reserves
// one draft, before any model call. Every query names the workspace.

export type PlanCallRefusal = "forbidden" | "reportFinal" | "rateLimited" | "readOnly" | "quotaExceeded";

export type PlanCallStart =
  | { ok: true; id: string }
  | { ok: false; refusal: PlanCallRefusal | "generic"; retryAfter: number | null };

const REFUSALS = new Set<string>(["forbidden", "reportFinal", "rateLimited", "readOnly", "quotaExceeded"]);

export async function startPlanImportCall(request: {
  workspaceId: string;
  reportId: string;
  userId: string;
  provider: string;
  model: string;
  inputChars: number;
  pages: number;
  hourlyLimit: number;
}): Promise<PlanCallStart> {
  const { data, error } = await createAdminClient()
    .rpc("start_plan_import_call", {
      p_workspace_id: request.workspaceId,
      p_report_id: request.reportId,
      p_user_id: request.userId,
      p_provider: request.provider,
      p_model: request.model,
      p_input_chars: request.inputChars,
      p_pages: request.pages,
      p_hourly_limit: request.hourlyLimit,
    })
    .maybeSingle();
  if (error || !data) {
    log.error("plan import: could not start an AI reading", { error: error?.message });
    return { ok: false, refusal: "generic", retryAfter: null };
  }
  if (data.call_id) return { ok: true, id: data.call_id };
  if (data.refusal && REFUSALS.has(data.refusal)) {
    return { ok: false, refusal: data.refusal as PlanCallRefusal, retryAfter: data.retry_after ?? null };
  }
  return { ok: false, refusal: "generic", retryAfter: null };
}

export type PlanCallOutcome = {
  status: "succeeded" | "failed";
  errorCode: string | null;
  items: number | null;
  usage: TokenUsage;
  costEstimate: number | null;
  latencyMs: number;
};

/** Records how a reading ended, which counts its AI draft or gives it back. False when it was no longer running. */
export async function finishPlanImportCall(
  id: string,
  workspaceId: string,
  outcome: PlanCallOutcome,
): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("finish_plan_import_call", {
    p_call_id: id,
    p_workspace_id: workspaceId,
    p_status: outcome.status,
    p_error_code: outcome.errorCode ?? "",
    // The generated types say number; the function takes null for "none" and "no price".
    p_items: outcome.items as number,
    p_input_tokens: outcome.usage.inputTokens,
    p_output_tokens: outcome.usage.outputTokens,
    p_cost_estimate: outcome.costEstimate as number,
    p_latency_ms: Math.max(0, Math.round(outcome.latencyMs)),
  });
  if (error) log.error("plan import: could not record an AI reading", { error: error.message });
  return data === true;
}
