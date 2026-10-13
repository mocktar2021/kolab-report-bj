import { NoObjectGeneratedError, streamObject, type LanguageModelV1 } from "ai";
import type { OutputSchema } from "@/lib/prompts/catalog";
import { outputSchemaFor, parseDraftOutput, type DraftOutput, type SourceRefs } from "./schemas";

// One draft: the model streams an object for the template's schema. When
// the finished object fails the schema, the model gets one more call with
// its answer and what was wrong, in French. A second failure ends the
// generation. Nothing here writes to the database.

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type DraftFailure = "invalidOutput" | "aborted" | "timeout" | "providerError";

export type DraftResult =
  | { ok: true; output: DraftOutput; rawText: string; repaired: boolean; usage: TokenUsage }
  | { ok: false; error: DraftFailure; rawText: string; repaired: boolean; usage: TokenUsage };

export type DraftCall = {
  model: LanguageModelV1;
  schema: OutputSchema;
  refs: SourceRefs;
  system: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  /** Aborted when the person stops the draft or leaves. */
  userSignal: AbortSignal;
  /** Aborted when the server's time budget runs out. */
  deadline: AbortSignal;
  onPartial: (partial: unknown) => void;
  onRepair: () => void;
};

/** Longest previous answer quoted back to the model in the repair call. */
const REPAIR_QUOTE_CHARS = 40_000;

type Attempt =
  | { ok: true; value: unknown; rawText: string; usage: TokenUsage }
  | { ok: false; invalid: boolean; error: unknown; rawText: string; usage: TokenUsage };

function addUsage(total: TokenUsage, more: TokenUsage): TokenUsage {
  return {
    inputTokens: total.inputTokens + more.inputTokens,
    outputTokens: total.outputTokens + more.outputTokens,
  };
}

function usageOf(usage: { promptTokens?: number; completionTokens?: number } | undefined): TokenUsage {
  const input = Number(usage?.promptTokens);
  const output = Number(usage?.completionTokens);
  return {
    inputTokens: Number.isFinite(input) ? input : 0,
    outputTokens: Number.isFinite(output) ? output : 0,
  };
}

/** Up to ten schema problems, one per line, for the repair prompt. */
export function describeValidationError(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const issues = (current as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      return issues
        .slice(0, 10)
        .map((issue: { path?: unknown[]; message?: string }) => {
          const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "(racine)";
          return `- ${path} : ${issue.message ?? "valeur invalide"}`;
        })
        .join("\n");
    }
    current = (current as { cause?: unknown }).cause;
  }
  return "- La réponse n'est pas un objet JSON valide pour le format demandé.";
}

export function repairPrompt(prompt: string, previous: string, problems: string): string {
  const quoted =
    previous.length > REPAIR_QUOTE_CHARS ? `${previous.slice(0, REPAIR_QUOTE_CHARS)}…` : previous;
  return `${prompt}

Ta réponse précédente ne respectait pas le format demandé. Problèmes relevés :
${problems}

Réponse précédente :
${quoted}

Renvoie l'objet complet, corrigé, dans le format demandé, sans rien ajouter d'autre.`;
}

async function attempt(call: DraftCall, prompt: string, signal: AbortSignal): Promise<Attempt> {
  let rawText = "";
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let streamError: unknown = null;
  try {
    const result = streamObject({
      model: call.model,
      schema: outputSchemaFor(call.schema, call.refs),
      schemaName: "brouillon",
      schemaDescription: "Brouillon de section de rapport d'expertise, en français.",
      system: call.system,
      prompt,
      temperature: call.temperature,
      maxTokens: call.maxTokens,
      maxRetries: 1,
      abortSignal: signal,
      // Errors arrive in the stream below; this keeps them out of the logs twice.
      onError: () => undefined,
    });
    for await (const part of result.fullStream) {
      if (part.type === "object") call.onPartial(part.object);
      else if (part.type === "text-delta") rawText += part.textDelta;
      else if (part.type === "finish") usage = usageOf(part.usage);
      else if (part.type === "error") streamError = part.error;
    }
    if (streamError) return { ok: false, invalid: false, error: streamError, rawText, usage };
    const value = await result.object;
    return { ok: true, value, rawText, usage };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      return {
        ok: false,
        invalid: true,
        error,
        rawText: error.text ?? rawText,
        usage: error.usage ? usageOf(error.usage) : usage,
      };
    }
    return { ok: false, invalid: false, error, rawText, usage };
  }
}

function failure(call: DraftCall): DraftFailure {
  if (call.userSignal.aborted) return "aborted";
  if (call.deadline.aborted) return "timeout";
  return "providerError";
}

export async function generateDraft(call: DraftCall): Promise<DraftResult> {
  const signal = AbortSignal.any([call.userSignal, call.deadline]);
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  const first = await attempt(call, call.prompt, signal);
  usage = addUsage(usage, first.usage);
  const firstOutput = first.ok ? parseDraftOutput(call.schema, call.refs, first.value) : null;
  if (firstOutput) return { ok: true, output: firstOutput, rawText: first.rawText, repaired: false, usage };
  if (!first.ok && (!first.invalid || signal.aborted)) {
    return { ok: false, error: failure(call), rawText: first.rawText, repaired: false, usage };
  }

  call.onRepair();
  const problems = describeValidationError(first.ok ? null : first.error);
  const second = await attempt(call, repairPrompt(call.prompt, first.rawText, problems), signal);
  usage = addUsage(usage, second.usage);
  const secondOutput = second.ok ? parseDraftOutput(call.schema, call.refs, second.value) : null;
  if (secondOutput) return { ok: true, output: secondOutput, rawText: second.rawText, repaired: true, usage };
  const error = !second.ok && !second.invalid ? failure(call) : "invalidOutput";
  return { ok: false, error, rawText: second.rawText || first.rawText, repaired: true, usage };
}
