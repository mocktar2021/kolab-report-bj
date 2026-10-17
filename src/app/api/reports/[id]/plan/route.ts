import { after, NextResponse } from "next/server";
import { z } from "zod";
import { aiSettings, draftAvailability, modelFor } from "@/lib/ai/config";
import { checkDailyCost } from "@/lib/ai/generation-store";
import { mockModel } from "@/lib/ai/mock";
import { estimateCost } from "@/lib/ai/models";
import { describeDraftQuota } from "@/lib/billing/errors";
import { workspaceIsWritable } from "@/lib/billing/state";
import { fileExtension, FILE_TYPES } from "@/lib/deliverables/file-types";
import { matchesSignature, SNIFF_BYTES } from "@/lib/deliverables/sniff";
import { getRequestId, log, withRequestId } from "@/lib/log";
import { readPlanWithAi, samplePlanOutput, textForModel } from "@/lib/plan/ai";
import {
  FILE_NAME_HEADER,
  type PlanImportErrorBody,
  type PlanImportErrorKey,
  type PlanImportErrorValues,
  type PlanReadBody,
} from "@/lib/plan/errors";
import { readPlanInWorker } from "@/lib/plan/read-job";
import { finishPlanImportCall, startPlanImportCall } from "@/lib/plan/store";
import { PLAN_FORMATS, PLAN_LIMITS, PlanReadError, type PlanFormat } from "@/lib/plan/types";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

// POST /api/reports/[id]/plan: reads the plan of a report from a file or
// pasted text (KRB-196) and answers with the items for the preview. Nothing
// is created here, and neither the file nor its text is kept: the bytes stay
// in memory for the request. Word, text and Markdown are read without AI, in
// the worker process. A PDF's text is read there too, then the AI proposes
// the plan; that counts as one AI draft of the month.
//
// The body is the file itself (application/octet-stream, its name in the
// X-File-Name header) or JSON {"text": "..."} for pasted text. Neither is a
// content type a form of another site can send without a preflight.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The AI call stops in time to record its outcome before the function is cut. */
const AI_DEADLINE_MS = 80_000;

const NO_STORE = { "Cache-Control": "private, no-store" };

type Params = Promise<{ id: string }>;

function refuse(
  status: number,
  error: PlanImportErrorKey,
  retryAfter?: number | null,
  values?: PlanImportErrorValues,
) {
  const body: PlanImportErrorBody = {
    error,
    ...(retryAfter ? { retryAfter } : {}),
    ...(values ? { values } : {}),
  };
  const headers: Record<string, string> = { ...NO_STORE };
  if (retryAfter) headers["Retry-After"] = String(retryAfter);
  return NextResponse.json(body, { status, headers });
}

/** Reads at most `limit` bytes of the body. Null when it is longer. */
async function readBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

const textSchema = z.object({ text: z.string() });

/** Pasted text, as UTF-8 bytes the worker reads like a .txt file. */
async function pastedText(request: Request): Promise<Uint8Array | PlanImportErrorKey> {
  // JSON escapes can take six bytes for one character.
  const body = await readBody(request, PLAN_LIMITS.maxTextChars * 6 + 1000);
  if (!body) return "textTooLong";
  let parsed: z.infer<typeof textSchema>;
  try {
    const result = textSchema.safeParse(JSON.parse(new TextDecoder().decode(body)));
    if (!result.success) return "invalidRequest";
    parsed = result.data;
  } catch {
    return "invalidRequest";
  }
  if (parsed.text.trim() === "") return "textEmpty";
  if (parsed.text.length > PLAN_LIMITS.maxTextChars) return "textTooLong";
  return new TextEncoder().encode(parsed.text);
}

/** The format of an uploaded file, from its name. */
function formatOf(request: Request): PlanFormat | null {
  let name = "";
  try {
    name = decodeURIComponent(request.headers.get(FILE_NAME_HEADER) ?? "");
  } catch {
    return null;
  }
  const extension = fileExtension(name);
  return (PLAN_FORMATS as readonly string[]).includes(extension) ? (extension as PlanFormat) : null;
}

export const POST = withRequestId(async (request: Request, { params }: { params: Params }) => {
  const contentType = request.headers.get("content-type") ?? "";
  const isText = contentType.startsWith("application/json");
  if (!isText && !contentType.startsWith("application/octet-stream")) return refuse(415, "invalidRequest");

  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return refuse(404, "notFound");
  const user = await getCurrentUser();
  if (!user) return refuse(401, "unauthenticated");

  // RLS hides reports of other workspaces: they look like missing ones.
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("reports")
    .select("id, workspace_id, status")
    .eq("id", id.toLowerCase())
    .maybeSingle();
  if (!report) return refuse(404, "notFound");
  const access = await requireWorkspaceRole(report.workspace_id, MANAGER_ROLES);
  if (!access) return refuse(403, "forbidden");
  if (report.status === "final") return refuse(403, "reportFinal");
  if (!(await workspaceIsWritable(report.workspace_id))) return refuse(403, "readOnly");

  let format: PlanFormat;
  let bytes: Uint8Array;
  if (isText) {
    const text = await pastedText(request);
    if (typeof text === "string") return refuse(text === "textTooLong" ? 413 : 400, text);
    format = "txt";
    bytes = text;
  } else {
    const fileFormat = formatOf(request);
    if (!fileFormat) return refuse(415, "fileType");
    // Checked before the upload is read: the AI must be there to read a PDF.
    if (fileFormat === "pdf" && draftAvailability() !== "enabled") return refuse(503, "aiUnavailable");
    const body = await readBody(request, PLAN_LIMITS.maxFileBytes);
    if (!body) return refuse(413, "fileTooLarge");
    if (body.length === 0) return refuse(400, "fileEmpty");
    // The bytes must match the extension, as for deliverables.
    if (!matchesSignature(FILE_TYPES[fileFormat].signature, body.subarray(0, SNIFF_BYTES))) {
      return refuse(422, "contentMismatch");
    }
    format = fileFormat;
    bytes = body;
  }

  let read;
  try {
    read = await readPlanInWorker(format, bytes, Date.now() + PLAN_LIMITS.timeoutMs, {
      requestId: await getRequestId(),
    });
  } catch (error) {
    if (error instanceof PlanReadError) return refuse(422, error.key);
    log.error("plan import: could not read a file", { error });
    return refuse(500, "generic");
  }

  if (read.kind === "plan") {
    if (!read.plan) return refuse(422, "nothingFound");
    return NextResponse.json(read.plan satisfies PlanReadBody, { headers: NO_STORE });
  }

  // A PDF: one AI draft of the month, reserved before the model is called.
  const settings = aiSettings();
  const mock = settings.provider === "mock";
  const modelId = mock ? "mock" : settings.models.standard;
  const started = await startPlanImportCall({
    workspaceId: report.workspace_id,
    reportId: report.id,
    userId: user.id,
    provider: settings.provider,
    model: modelId,
    inputChars: read.text.length,
    pages: read.pages,
    hourlyLimit: PLAN_LIMITS.pdfReadingsPerHour,
  });
  if (!started.ok) {
    switch (started.refusal) {
      case "forbidden":
      case "reportFinal":
      case "readOnly":
        return refuse(403, started.refusal);
      case "rateLimited":
        return refuse(429, "rateLimited", started.retryAfter ?? 60);
      // The organization's plan (ADR 001): a monthly allowance says when it
      // comes back; the trial's and a pass's do not.
      case "quotaExceeded": {
        const quota = await describeDraftQuota(report.workspace_id, started.retryAfter);
        const key = quota.error as PlanImportErrorKey;
        return refuse(402, key, started.retryAfter, quota.values);
      }
      default:
        return refuse(500, "generic");
    }
  }

  const startedAt = performance.now();
  const text = textForModel(read.text, settings.redactPii);
  const model = mock ? mockModel(() => JSON.stringify(samplePlanOutput(text))) : modelFor("standard");
  const result = model
    ? await readPlanWithAi({
        model,
        text,
        pages: read.pages,
        truncated: read.truncated,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(AI_DEADLINE_MS)]),
      })
    : ({
        ok: false,
        error: "providerError",
        usage: { inputTokens: 0, outputTokens: 0 },
        usageEstimated: false,
      } as const);

  await finishPlanImportCall(started.id, report.workspace_id, {
    status: result.ok ? "succeeded" : "failed",
    errorCode: result.ok ? null : result.error,
    items: result.ok ? result.plan.items.length : null,
    usage: result.usage,
    costEstimate: estimateCost(settings, "standard", result.usage),
    latencyMs: performance.now() - startedAt,
  });
  after(() => checkDailyCost(settings.costAlert));

  if (!result.ok) {
    switch (result.error) {
      case "nothingFound":
        return refuse(422, "nothingFound");
      case "timeout":
        return refuse(504, "aiTimeout");
      default:
        return refuse(502, "aiFailed");
    }
  }
  return NextResponse.json(result.plan satisfies PlanReadBody, { headers: NO_STORE });
});
