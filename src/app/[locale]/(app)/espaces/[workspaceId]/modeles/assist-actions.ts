"use server";

import { after } from "next/server";
import { aiSettings, draftAvailability, modelFor } from "@/lib/ai/config";
import { redactPii } from "@/lib/ai/context";
import { checkDailyCost } from "@/lib/ai/generation-store";
import { mockModel } from "@/lib/ai/mock";
import { estimateCost } from "@/lib/ai/models";
import { sampleWrittenTemplate, writeTemplate } from "@/lib/ai/template-writer";
import { flushTraces, withDraftSpan } from "@/lib/ai/tracing";
import { getWorkspaceBillingState } from "@/lib/billing/state";
import { log } from "@/lib/log";
import { finishPromptAssist, startPromptAssist } from "@/lib/prompts/assist-store";
import type { ModelTier } from "@/lib/prompts/catalog";
import { writerRequestSchema, type WriterNote } from "@/lib/prompts/writer";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

// "Rédiger avec l'IA" on the new template page (KRB-198). Checks run first
// and answer without a model call: role, AI available, plan and read-only.
// The call is then counted in prompt_assist_calls (daily limit per person,
// checked again in the database), the model writes a template, and its
// usage and cost are recorded. It is not a section draft: no ai_generations
// row, no monthly token budget, no AI draft of the plan. Nothing is saved
// either: the editor opens on the result and the manager saves it, or not.

/** A template is short and the manager waits for it: the fast model is enough. */
const WRITER_TIER: ModelTier = "fast";

/** Under the page's maxDuration (60 s), to record the call before the function is cut. */
const WRITER_TIMEOUT_MS = 45_000;

export type WriteTemplateError =
  | "forbidden"
  | "invalidInput"
  | "descriptionTooShort"
  | "descriptionTooLong"
  | "readOnly"
  | "templatesNotIncluded"
  | "aiUnavailable"
  | "rateLimited"
  | "invalidOutput"
  | "timeout"
  | "providerError"
  | "generic";

export type WriteTemplateResult =
  | {
      ok: true;
      title: string;
      description: string;
      template: string;
      notes: WriterNote[];
      /** Placeholders taken out of the answer, as the model wrote them. */
      removed: string[];
    }
  | { ok: false; error: WriteTemplateError; retryAfter?: number };

export type WriteTemplateRequest = {
  workspaceId: string;
  description: string;
  outputSchema: string | null;
};

export async function writeTemplateWithAi(request: WriteTemplateRequest): Promise<WriteTemplateResult> {
  const workspace = uuidSchema.safeParse(request?.workspaceId);
  if (!workspace.success) return { ok: false, error: "invalidInput" };
  const workspaceId = workspace.data.toLowerCase();
  const parsed = writerRequestSchema.safeParse({
    description: request.description,
    outputSchema: request.outputSchema,
  });
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return {
      ok: false,
      error: message === "descriptionTooShort" || message === "descriptionTooLong" ? message : "invalidInput",
    };
  }
  const { description, outputSchema } = parsed.data;

  const access = await requireWorkspaceRole(workspaceId, MANAGER_ROLES);
  if (!access) return { ok: false, error: "forbidden" };
  if (draftAvailability() !== "enabled") return { ok: false, error: "aiUnavailable" };

  // The same rules as saving a template (KR043, KR044). A state that can't
  // be read waits rather than slips through.
  const billing = await getWorkspaceBillingState(workspaceId);
  if (!billing) return { ok: false, error: "generic" };
  if (billing.state === "read_only") return { ok: false, error: "readOnly" };
  if (!billing.limits.customTemplates) return { ok: false, error: "templatesNotIncluded" };

  const settings = aiSettings();
  const mock = settings.provider === "mock";
  const modelId = mock ? "mock" : settings.models[WRITER_TIER];
  const started = await startPromptAssist({
    workspaceId,
    userId: access.userId,
    provider: settings.provider,
    model: modelId,
    inputChars: [...description].length,
    dailyLimit: settings.templateWriterPerDay,
  });
  if (!started.ok) {
    if (started.refusal === "rateLimited")
      return { ok: false, error: "rateLimited", retryAfter: started.retryAfter ?? 3600 };
    return { ok: false, error: started.refusal };
  }
  const callId = started.id;

  const model = mock
    ? mockModel(() => JSON.stringify(sampleWrittenTemplate()), "mock")
    : modelFor(WRITER_TIER);
  const startedAt = performance.now();
  const outcome = await withDraftSpan(
    {
      "kolab.assist_call_id": callId,
      "kolab.workspace_id": workspaceId,
      "gen_ai.system": settings.provider,
      "gen_ai.request.model": modelId,
      ...(outputSchema ? { "kolab.output_schema": outputSchema } : {}),
    },
    async (span) => {
      const result = model
        ? await writeTemplate({
            model,
            // Masked like the files of a draft, when AI_REDACT_PII is on.
            description: settings.redactPii ? redactPii(description).text : description,
            outputSchema,
            signal: AbortSignal.timeout(WRITER_TIMEOUT_MS),
            telemetry: {
              isEnabled: settings.tracing.enabled,
              recordInputs: settings.tracing.recordContent,
              recordOutputs: settings.tracing.recordContent,
              functionId: "kolab.template_writer",
              metadata: { assistCallId: callId, workspaceId },
            },
          })
        : ({
            ok: false,
            error: "providerError",
            usage: { inputTokens: 0, outputTokens: 0 },
            usageEstimated: false,
            rawText: "",
          } as const);
      const latencyMs = performance.now() - startedAt;
      const costEstimate = estimateCost(settings, WRITER_TIER, result.usage);
      span.set({
        "gen_ai.usage.input_tokens": result.usage.inputTokens,
        "gen_ai.usage.output_tokens": result.usage.outputTokens,
        "kolab.latency_ms": Math.round(latencyMs),
        "kolab.usage_estimated": result.usageEstimated,
        ...(costEstimate === null ? {} : { "kolab.cost_usd": costEstimate }),
      });
      if (result.ok) span.set({ "kolab.status": "succeeded" });
      else span.fail(result.error);
      await finishPromptAssist(callId, workspaceId, {
        status: result.ok ? "succeeded" : "failed",
        errorCode: result.ok ? null : result.error,
        usage: result.usage,
        costEstimate,
        latencyMs,
        traceId: span.traceId,
      });
      return result;
    },
    "kolab.ai.template_writer",
  ).catch(async (error: unknown) => {
    log.error("template writer: call crashed", { callId, error });
    // Ends the call, unless it was recorded before the crash.
    await finishPromptAssist(callId, workspaceId, {
      status: "failed",
      errorCode: "crashed",
      usage: { inputTokens: 0, outputTokens: 0 },
      costEstimate: null,
      latencyMs: performance.now() - startedAt,
      traceId: null,
    }).catch(() => false);
    return null;
  });

  // The daily cost alert and the spans go out once the answer is sent.
  after(async () => {
    await checkDailyCost(settings.costAlert);
    await flushTraces();
  });

  if (!outcome) return { ok: false, error: "generic" };
  if (!outcome.ok) return { ok: false, error: outcome.error };
  return {
    ok: true,
    title: outcome.written.title,
    description: outcome.written.description,
    template: outcome.written.template,
    notes: outcome.written.notes,
    removed: outcome.written.removed,
  };
}
