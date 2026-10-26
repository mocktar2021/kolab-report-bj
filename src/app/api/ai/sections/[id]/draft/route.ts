import { generateText } from "ai";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { aiSettings, draftAvailability, modelFor } from "@/lib/ai/config";
import {
  buildPrompt,
  contextBudget,
  estimateTokens,
  finalizeContext,
  planContext,
  summaryPrompt,
  type BuiltContext,
  type ContextPlan,
  type OverflowChunk,
} from "@/lib/ai/context";
import { generateDraft, repairReserve, type TokenUsage } from "@/lib/ai/generate";
import { checkDailyCost, finishGeneration, startGeneration } from "@/lib/ai/generation-store";
import { wordCount } from "@/lib/ai/metrics";
import { mockModel, sampleOutput } from "@/lib/ai/mock";
import { estimateCost, estimateFallbackCost, fallbackModel, noThinking } from "@/lib/ai/models";
import { draftToMarkdown } from "@/lib/ai/schemas";
import { aiTelemetry } from "@/lib/ai/telemetry";
import { flushTraces, withDraftSpan, type DraftSpan } from "@/lib/ai/tracing";
import type {
  ContextDeliverable,
  DraftErrorBody,
  DraftErrorKey,
  DraftErrorValues,
  DraftStreamEvent,
} from "@/lib/ai/types";
import { describeDraftQuota, describeDraftTokens } from "@/lib/billing/errors";
import type { ParseMeta } from "@/lib/deliverables/parse/types";
import { log, withRequestId } from "@/lib/log";
import { MODEL_TIERS, OUTPUT_SCHEMAS, type ModelTier } from "@/lib/prompts/catalog";
import { versionForSection } from "@/lib/prompts/rollouts";
import { canEditSection } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

// POST /api/ai/sections/[id]/draft: a draft of the section from a published
// template and the section's parsed deliverables. Checks run first and
// answer with a JSON error; then the generation is recorded as running
// (hourly limit, monthly budget and the AI drafts of the organization's plan
// included, so no model call happens past them) and the answer streams as
// NDJSON events (src/lib/ai/types.ts). The
// draft is only a proposal: the section changes when the expert accepts it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Stops the model calls in time to record the outcome before the function is cut. */
const DEADLINE_MS = (maxDuration - 20) * 1000;

/** Summaries of overflow run at most this many at a time. */
const SUMMARY_CONCURRENCY = 3;

/** At most one partial object every this many milliseconds: each one carries the whole object so far. */
const PARTIAL_INTERVAL_MS = 150;

const NO_STORE = { "Cache-Control": "private, no-store" };

const requestSchema = z.object({ promptVersionId: uuidSchema });

const VERSION_COLUMNS =
  "id, workspace_id, template_key, version, template, output_schema, model_tier, temperature, max_output_tokens, status";

type Params = Promise<{ id: string }>;

function refuse(status: number, error: DraftErrorKey, retryAfter?: number | null, values?: DraftErrorValues) {
  const body: DraftErrorBody = {
    error,
    ...(retryAfter ? { retryAfter } : {}),
    ...(values ? { values } : {}),
  };
  const headers: Record<string, string> = { ...NO_STORE };
  if (retryAfter) headers["Retry-After"] = String(retryAfter);
  return NextResponse.json(body, { status, headers });
}

async function readRequest(request: Request) {
  const text = await request.text().catch(() => "");
  if (text.length > 1000) return null;
  try {
    const parsed = requestSchema.safeParse(JSON.parse(text));
    return parsed.success ? { promptVersionId: parsed.data.promptVersionId.toLowerCase() } : null;
  } catch {
    return null;
  }
}

/** Runs `run` over `items`, `limit` at a time, keeping their order. */
async function inBatches<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += limit) {
    results.push(...(await Promise.all(items.slice(start, start + limit).map(run))));
  }
  return results;
}

export const POST = withRequestId(async (request: Request, { params }: { params: Params }) => {
  // A JSON content type keeps other sites from posting here with a plain form
  // (KRB-24 F-08), as the export route does.
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return refuse(415, "invalidRequest");
  }
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return refuse(404, "notFound");

  const user = await getCurrentUser();
  if (!user) return refuse(401, "unauthenticated");

  const body = await readRequest(request);
  if (!body) return refuse(400, "invalidRequest");

  // RLS hides sections of other workspaces: they look like missing ones.
  const supabase = await createClient();
  const { data: section } = await supabase
    .from("report_sections")
    .select(
      "id, workspace_id, title, instructions, assigned_to, report:reports(title, description, status), parent:parent_id(title)",
    )
    .eq("id", id.toLowerCase())
    .maybeSingle();
  if (!section?.report) return refuse(404, "notFound");

  const access = await requireWorkspaceRole(section.workspace_id);
  if (!access) return refuse(404, "notFound");
  if (!canEditSection(access, section.assigned_to)) return refuse(403, "forbidden");
  // A final report is frozen (KRB-20): a draft could not be accepted anyway.
  if (section.report.status === "final") return refuse(403, "forbidden");

  if (draftAvailability() !== "enabled") return refuse(503, "aiUnavailable");
  const settings = aiSettings();

  // The expert picks a published version. An active rollout of its template
  // may serve its draft candidate to this section instead (Story KRB-17).
  const { data: picked } = await supabase
    .from("prompt_library")
    .select(VERSION_COLUMNS)
    .eq("id", body.promptVersionId)
    .maybeSingle();
  if (
    !picked ||
    picked.status !== "published" ||
    (picked.workspace_id !== null && picked.workspace_id !== section.workspace_id)
  ) {
    return refuse(422, "templateUnavailable");
  }
  const chosen = await versionForSection(
    { id: picked.id, workspaceId: picked.workspace_id, templateKey: picked.template_key },
    section.workspace_id,
    section.id,
  );
  const template =
    chosen.versionId === picked.id
      ? picked
      : (
          await supabase
            .from("prompt_library")
            .select(VERSION_COLUMNS)
            .eq("id", chosen.versionId)
            .maybeSingle()
        ).data;
  const outputSchema = z.enum(OUTPUT_SCHEMAS).safeParse(template?.output_schema);
  const tier = z.enum(MODEL_TIERS).catch("standard").parse(template?.model_tier) as ModelTier;
  if (!template || !outputSchema.success) return refuse(422, "templateUnavailable");

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", section.workspace_id)
    .maybeSingle();

  const { data: files } = await supabase
    .from("deliverables")
    .select("id, file_name, parsed_content, parse_meta, uploaded_at")
    .eq("section_id", section.id)
    .eq("parse_status", "parsed")
    .not("uploaded_at", "is", null);
  const deliverables: ContextDeliverable[] = (files ?? []).flatMap((file) =>
    file.parsed_content?.trim() && file.uploaded_at
      ? [
          {
            id: file.id,
            fileName: file.file_name,
            kind: (file.parse_meta as ParseMeta | null)?.kind ?? "document",
            markdown: file.parsed_content,
            uploadedAt: file.uploaded_at,
          },
        ]
      : [],
  );
  if (deliverables.length === 0) return refuse(422, "noDeliverables");

  // The template's cap is room for the answer. The model thinks first, and
  // its thinking counts inside the cap of the call (KRB-224).
  const answerTokens = template.max_output_tokens ?? settings.defaultMaxOutputTokens;
  const thinking = settings.draftThinking;
  const maxTokens = answerTokens + thinking.tokens;
  const temperature = template.temperature ?? settings.defaultTemperature;
  const budget = contextBudget({
    contextWindowTokens: settings.contextWindowTokens,
    maxOutputTokens: maxTokens,
    maxInputTokens: settings.maxInputTokens,
  });
  let plan: ContextPlan;
  try {
    plan = planContext(
      {
        workspaceName: workspace?.name ?? "",
        report: { title: section.report.title, description: section.report.description },
        section: {
          title: section.title,
          instructions: section.instructions,
          parentTitle: section.parent?.title,
        },
        deliverables,
      },
      budget,
      { redactPii: settings.redactPii, template: template.template },
    );
  } catch {
    // Every deliverable was empty once cleaned.
    return refuse(422, "noDeliverables");
  }

  const mock = settings.provider === "mock";
  const started = await startGeneration({
    workspaceId: section.workspace_id,
    sectionId: section.id,
    userId: user.id,
    promptVersionId: template.id,
    rolloutId: chosen.rolloutId,
    outputSchema: outputSchema.data,
    provider: settings.provider,
    model: mock ? "mock" : settings.models[tier],
    params: {
      temperature,
      // The template's cap, as before thinking; the call's cap adds thinkingTokens.
      maxOutputTokens: answerTokens,
      effort: thinking.effort,
      thinkingTokens: thinking.tokens,
      modelTier: tier,
      ...(settings.fallback ? { fallbackModel: settings.fallback.model } : {}),
    },
    // Held against the budget while the draft runs, a repair call included.
    estimatedTokens:
      plan.estimatedInputTokens +
      maxTokens +
      plan.estimatedSummaryTokens +
      repairReserve(plan.estimatedInputTokens, maxTokens),
    rateLimitPerHour: settings.rateLimitPerHour,
    monthlyTokenBudget: settings.monthlyTokenBudget,
  });
  if (!started.ok) {
    switch (started.refusal) {
      case "rateLimited":
      case "budgetExceeded":
        return refuse(429, started.refusal, started.retryAfter ?? 60);
      case "busy":
        return refuse(409, "busy");
      case "templateUnavailable":
        return refuse(422, "templateUnavailable");
      // The organization's plan (ADR 001, 7.1). A monthly allowance says
      // when it comes back; the trial's and a pass's do not.
      case "quotaExceeded": {
        const quota = await describeDraftQuota(section.workspace_id, started.retryAfter);
        return refuse(402, quota.error, started.retryAfter, quota.values);
      }
      // Drafts left, but not the tokens this one needs (KRB-252).
      case "tokenQuotaExceeded": {
        const tokens = await describeDraftTokens(section.workspace_id, started.retryAfter);
        return refuse(402, tokens.error, started.retryAfter, tokens.values);
      }
      case "readOnly":
      case "templateNotIncluded":
        return refuse(403, started.refusal);
      default:
        return refuse(500, "generic");
    }
  }

  const generationId = started.id;
  const workspaceId = section.workspace_id;
  const schemaKey = outputSchema.data;
  const templateText = template.template;
  const promptVersion = { id: template.id, key: template.template_key, number: template.version };
  const modelId = mock ? "mock" : settings.models[tier];
  // Spans of the AI SDK calls, under this generation's trace, whose root span
  // carries the generation and prompt version ids.
  const telemetry = (functionId: string) => aiTelemetry(settings.tracing, functionId);
  const startedAt = performance.now();
  const userAbort = new AbortController();
  request.signal.addEventListener("abort", () => userAbort.abort(), { once: true });
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  // What the calls cost so far, for the record when something crashes.
  let spent: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  function send(event: DraftStreamEvent) {
    if (closed || !streamController) return;
    try {
      streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      closed = true;
    }
  }

  function close() {
    if (closed || !streamController) return;
    closed = true;
    try {
      streamController.close();
    } catch {
      // Already closed by the client.
    }
  }

  async function summarize(
    chunks: OverflowChunk[],
  ): Promise<{ summaries: Map<string, string | null>; usage: TokenUsage; estimated: boolean }> {
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let estimated = false;
    const fast = mock ? mockModel(() => "Résumé simulé de la suite du livrable.") : modelFor("fast");
    const signal = AbortSignal.any([userAbort.signal, deadline]);
    const results = await inBatches(chunks, SUMMARY_CONCURRENCY, async (chunk) => {
      if (!fast || signal.aborted) return [chunk.id, null] as const;
      const { system, prompt, maxOutputTokens } = summaryPrompt(chunk);
      try {
        const result = await generateText({
          model: fast,
          instructions: system,
          prompt,
          maxOutputTokens,
          temperature: 0,
          providerOptions: noThinking(),
          maxRetries: 1,
          abortSignal: signal,
          telemetry: telemetry("kolab.summary"),
        });
        usage.inputTokens += result.usage.inputTokens || 0;
        usage.outputTokens += result.usage.outputTokens || 0;
        return [chunk.id, result.text.trim() || null] as const;
      } catch {
        // A stopped call was billed for its prompt all the same.
        if (signal.aborted) {
          usage.inputTokens += estimateTokens(system + prompt);
          estimated = true;
        }
        return [chunk.id, null] as const;
      }
    });
    return { summaries: new Map(results), usage, estimated };
  }

  async function runDraft(span: DraftSpan) {
    let built: BuiltContext | null = null;
    let summaryUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let summaryEstimated = false;
    try {
      const summarized = await summarize(plan.overflow);
      summaryUsage = summarized.usage;
      summaryEstimated = summarized.estimated;
      spent = summaryUsage;
      built = finalizeContext(plan, summarized.summaries);
    } catch (error) {
      log.error("ai drafts: could not build the context", { generationId, error });
    }

    const common = (usageEstimated: boolean) => ({
      inputHash: built?.inputHash ?? null,
      inputHashes: built?.deliverableHashes ?? {},
      contextMeta: built
        ? {
            version: 1 as const,
            deliverables: built.deliverables,
            decisions: built.decisions,
            estimatedInputTokens: built.estimatedInputTokens,
            usageEstimated,
          }
        : null,
      truncated: built?.truncated ?? false,
      traceId: span.traceId,
    });
    const summaryCost = estimateCost(settings, "fast", summaryUsage);

    if (!built) {
      await finishGeneration(generationId, workspaceId, {
        status: "failed",
        error: "contextFailed",
        usage: summaryUsage,
        costEstimate: summaryCost,
        latencyMs: performance.now() - startedAt,
        rawOutput: "",
        repaired: false,
        ...common(summaryEstimated),
      });
      span.fail("contextFailed");
      send({ type: "error", error: "generic" });
      return close();
    }

    if (built.truncated) {
      log.info("ai drafts: context truncated", { generationId, decisions: built.decisions });
    }
    send({ type: "start", generationId, truncated: built.truncated, deliverables: built.deliverables });

    const refs = built.refs;
    const model = mock ? mockModel(() => JSON.stringify(sampleOutput(schemaKey, refs))) : modelFor(tier);
    const { system, prompt } = buildPrompt(templateText, built);
    let lastPartial = 0;
    let pending: unknown = null;
    const result = model
      ? await generateDraft({
          model,
          schema: schemaKey,
          refs,
          system,
          prompt,
          temperature,
          maxTokens,
          effort: thinking.effort,
          userSignal: userAbort.signal,
          deadline,
          onPartial: (partial) => {
            pending = partial;
            const now = performance.now();
            if (now - lastPartial < PARTIAL_INTERVAL_MS) return;
            lastPartial = now;
            send({ type: "partial", object: partial });
            pending = null;
          },
          onRepair: () => {
            pending = null;
            send({ type: "repair" });
          },
          fallback: mock ? null : fallbackModel(settings, process.env),
          telemetry: telemetry("kolab.draft"),
        })
      : ({
          ok: false,
          error: "providerError",
          rawText: "",
          repaired: false,
          usage: { inputTokens: 0, outputTokens: 0 },
          usageEstimated: false,
          usedFallback: false,
        } as const);
    if (pending) send({ type: "partial", object: pending });

    const usage = {
      inputTokens: summaryUsage.inputTokens + result.usage.inputTokens,
      outputTokens: summaryUsage.outputTokens + result.usage.outputTokens,
    };
    spent = usage;
    const usageEstimated = summaryEstimated || result.usageEstimated;
    // A draft written by the fallback model is priced with
    // AI_FALLBACK_PRICE_*, and has no cost estimate without them.
    const draftCost = result.usedFallback
      ? estimateFallbackCost(settings, result.usage)
      : estimateCost(settings, tier, result.usage);
    const costEstimate = draftCost === null ? null : draftCost + (summaryCost ?? 0);
    const latencyMs = performance.now() - startedAt;
    const answeredBy = result.usedFallback && settings.fallback ? settings.fallback : null;
    span.set({
      "gen_ai.usage.input_tokens": usage.inputTokens,
      "gen_ai.usage.output_tokens": usage.outputTokens,
      "kolab.latency_ms": Math.round(latencyMs),
      "kolab.truncated": built.truncated,
      "kolab.repaired": result.repaired,
      "kolab.usage_estimated": usageEstimated,
      "kolab.fallback_used": result.usedFallback,
      ...(answeredBy ? { "gen_ai.response.model": answeredBy.model } : {}),
      ...(costEstimate === null ? {} : { "kolab.cost_usd": costEstimate }),
    });

    if (!result.ok) {
      await finishGeneration(generationId, workspaceId, {
        status: "failed",
        error: result.error,
        usage,
        costEstimate,
        latencyMs,
        rawOutput: result.rawText,
        repaired: result.repaired,
        answeredBy,
        ...common(usageEstimated),
      });
      span.fail(result.error);
      send({ type: "error", error: result.error });
      return close();
    }

    const markdown = draftToMarkdown(result.output, built.names);
    const outcome = {
      usage,
      costEstimate,
      latencyMs,
      rawOutput: result.rawText,
      repaired: result.repaired,
      answeredBy,
      ...common(usageEstimated),
    };
    const saved = await finishGeneration(generationId, workspaceId, {
      status: "succeeded",
      output: result.output.value as never,
      draftWords: wordCount(markdown),
      ...outcome,
    });
    if (saved) {
      span.set({ "kolab.status": "succeeded" });
      send({ type: "done", generationId, output: result.output, markdown });
    } else {
      // The draft could not be stored: record the failure, so the section isn't blocked as busy.
      await finishGeneration(generationId, workspaceId, {
        status: "failed",
        error: "saveFailed",
        ...outcome,
      });
      span.fail("saveFailed");
      send({ type: "error", error: "generic" });
    }
    close();
  }

  // One trace per generation, with what the dashboard shows. Then the daily
  // cost check, and the spans are sent before the function is frozen.
  async function run() {
    await withDraftSpan(
      {
        "kolab.generation_id": generationId,
        "kolab.workspace_id": workspaceId,
        "kolab.prompt_version_id": promptVersion.id,
        "kolab.prompt_template_key": promptVersion.key,
        "kolab.prompt_version": promptVersion.number,
        "kolab.output_schema": schemaKey,
        ...(chosen.rolloutId ? { "kolab.rollout_id": chosen.rolloutId } : {}),
        "gen_ai.system": settings.provider,
        "gen_ai.request.model": modelId,
        "gen_ai.request.temperature": temperature,
        "gen_ai.request.max_tokens": maxTokens,
      },
      runDraft,
    );
    await checkDailyCost(settings.costAlert);
    await flushTraces();
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    cancel() {
      closed = true;
      userAbort.abort();
    },
  });

  // The outcome is recorded even when the person leaves before the end.
  const job = run().catch(async (error) => {
    log.error("ai drafts: generation crashed", { generationId, error });
    await finishGeneration(generationId, workspaceId, {
      status: "failed",
      error: "crashed",
      usage: spent,
      costEstimate: null,
      latencyMs: performance.now() - startedAt,
      rawOutput: "",
      repaired: false,
      inputHash: null,
      inputHashes: {},
      contextMeta: null,
      truncated: false,
    }).catch(() => false);
    send({ type: "error", error: "generic" });
    close();
  });
  after(() => job);

  return new Response(stream, {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
});
