import { generateText } from "ai";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { aiSettings, draftAvailability, modelFor } from "@/lib/ai/config";
import {
  buildPrompt,
  contextBudget,
  finalizeContext,
  planContext,
  summaryPrompt,
  type BuiltContext,
  type ContextPlan,
  type OverflowChunk,
} from "@/lib/ai/context";
import { generateDraft, type TokenUsage } from "@/lib/ai/generate";
import { finishGeneration, startGeneration } from "@/lib/ai/generation-store";
import { wordCount } from "@/lib/ai/metrics";
import { mockModel, sampleOutput } from "@/lib/ai/mock";
import { estimateCost } from "@/lib/ai/models";
import { draftToMarkdown } from "@/lib/ai/schemas";
import type { ContextDeliverable, DraftErrorBody, DraftErrorKey, DraftStreamEvent } from "@/lib/ai/types";
import type { ParseMeta } from "@/lib/deliverables/parse/types";
import { MODEL_TIERS, OUTPUT_SCHEMAS, type ModelTier } from "@/lib/prompts/catalog";
import { canEditSection } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

// POST /api/ai/sections/[id]/draft: a draft of the section from a published
// template and the section's parsed deliverables. Checks run first and
// answer with a JSON error; then the generation is recorded as running
// (hourly limit and monthly budget included, so no model call happens past
// them) and the answer streams as NDJSON events (src/lib/ai/types.ts). The
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

type Params = Promise<{ id: string }>;

function refuse(status: number, error: DraftErrorKey, retryAfter?: number | null) {
  const body: DraftErrorBody = retryAfter ? { error, retryAfter } : { error };
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

export async function POST(request: Request, { params }: { params: Params }) {
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
    .select("id, workspace_id, title, instructions, assigned_to, report:reports(title, description)")
    .eq("id", id.toLowerCase())
    .maybeSingle();
  if (!section?.report) return refuse(404, "notFound");

  const access = await requireWorkspaceRole(section.workspace_id);
  if (!access) return refuse(404, "notFound");
  if (!canEditSection(access, section.assigned_to)) return refuse(403, "forbidden");

  if (draftAvailability() !== "enabled") return refuse(503, "aiUnavailable");
  const settings = aiSettings();

  const { data: template } = await supabase
    .from("prompt_library")
    .select("id, workspace_id, template, output_schema, model_tier, temperature, max_output_tokens, status")
    .eq("id", body.promptVersionId)
    .maybeSingle();
  const outputSchema = z.enum(OUTPUT_SCHEMAS).safeParse(template?.output_schema);
  const tier = z.enum(MODEL_TIERS).catch("standard").parse(template?.model_tier) as ModelTier;
  if (
    !template ||
    template.status !== "published" ||
    (template.workspace_id !== null && template.workspace_id !== section.workspace_id) ||
    !outputSchema.success
  ) {
    return refuse(422, "templateUnavailable");
  }

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

  const maxTokens = template.max_output_tokens ?? settings.defaultMaxOutputTokens;
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
        section: { title: section.title, instructions: section.instructions },
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
    outputSchema: outputSchema.data,
    provider: settings.provider,
    model: mock ? "mock" : settings.models[tier],
    params: { temperature, maxOutputTokens: maxTokens, modelTier: tier },
    estimatedTokens: plan.estimatedInputTokens + maxTokens + plan.estimatedSummaryTokens,
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
      default:
        return refuse(500, "generic");
    }
  }

  const generationId = started.id;
  const workspaceId = section.workspace_id;
  const schemaKey = outputSchema.data;
  const templateText = template.template;
  const startedAt = performance.now();
  const userAbort = new AbortController();
  request.signal.addEventListener("abort", () => userAbort.abort(), { once: true });
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

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
  ): Promise<{ summaries: Map<string, string | null>; usage: TokenUsage }> {
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const fast = mock ? mockModel(() => "Résumé simulé de la suite du livrable.") : modelFor("fast");
    const signal = AbortSignal.any([userAbort.signal, deadline]);
    const results = await inBatches(chunks, SUMMARY_CONCURRENCY, async (chunk) => {
      if (!fast || signal.aborted) return [chunk.id, null] as const;
      const { system, prompt, maxOutputTokens } = summaryPrompt(chunk);
      try {
        const result = await generateText({
          model: fast,
          system,
          prompt,
          maxTokens: maxOutputTokens,
          temperature: 0,
          maxRetries: 1,
          abortSignal: signal,
        });
        usage.inputTokens += result.usage.promptTokens || 0;
        usage.outputTokens += result.usage.completionTokens || 0;
        return [chunk.id, result.text.trim() || null] as const;
      } catch {
        return [chunk.id, null] as const;
      }
    });
    return { summaries: new Map(results), usage };
  }

  async function run() {
    let built: BuiltContext | null = null;
    let summaryUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    try {
      const summarized = await summarize(plan.overflow);
      summaryUsage = summarized.usage;
      built = finalizeContext(plan, summarized.summaries);
    } catch (error) {
      console.error("ai drafts: could not build the context", error instanceof Error ? error.message : error);
    }

    const contextMeta = built
      ? {
          version: 1 as const,
          deliverables: built.deliverables,
          decisions: built.decisions,
          estimatedInputTokens: built.estimatedInputTokens,
        }
      : null;
    const common = {
      inputHash: built?.inputHash ?? null,
      inputHashes: built?.deliverableHashes ?? {},
      contextMeta,
      truncated: built?.truncated ?? false,
    };
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
        ...common,
      });
      send({ type: "error", error: "generic" });
      return close();
    }

    if (built.truncated) {
      console.info(
        "ai drafts: context truncated",
        JSON.stringify({ generationId, decisions: built.decisions }),
      );
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
        })
      : ({
          ok: false,
          error: "providerError",
          rawText: "",
          repaired: false,
          usage: { inputTokens: 0, outputTokens: 0 },
        } as const);
    if (pending) send({ type: "partial", object: pending });

    const usage = {
      inputTokens: summaryUsage.inputTokens + result.usage.inputTokens,
      outputTokens: summaryUsage.outputTokens + result.usage.outputTokens,
    };
    const draftCost = estimateCost(settings, tier, result.usage);
    const costEstimate = draftCost === null ? null : draftCost + (summaryCost ?? 0);
    const latencyMs = performance.now() - startedAt;

    if (!result.ok) {
      await finishGeneration(generationId, workspaceId, {
        status: "failed",
        error: result.error,
        usage,
        costEstimate,
        latencyMs,
        rawOutput: result.rawText,
        repaired: result.repaired,
        ...common,
      });
      send({ type: "error", error: result.error });
      return close();
    }

    const markdown = draftToMarkdown(result.output, built.names);
    const saved = await finishGeneration(generationId, workspaceId, {
      status: "succeeded",
      output: result.output.value as never,
      draftWords: wordCount(markdown),
      usage,
      costEstimate,
      latencyMs,
      rawOutput: result.rawText,
      repaired: result.repaired,
      ...common,
    });
    send(
      saved
        ? { type: "done", generationId, output: result.output, markdown }
        : { type: "error", error: "generic" },
    );
    close();
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
  const job = run().catch((error) => {
    console.error("ai drafts: generation crashed", error instanceof Error ? error.message : error);
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
}
