import type { LanguageModelV3 } from "@ai-sdk/provider";
import { NoObjectGeneratedError, streamObject, type LanguageModelUsage, type TelemetrySettings } from "ai";
import type { OutputSchema } from "@/lib/prompts/catalog";
import { CHARS_PER_TOKEN, estimateTokens } from "./context/tokens";
import { noThinking } from "./models";
import { outputSchemaFor, parseDraftOutput, type DraftOutput, type SourceRefs } from "./schemas";

// One draft: the model streams an object for the template's schema. When
// the finished object fails the schema, the model gets one more call with
// its answer and what was wrong, in French. A second failure ends the
// generation. Nothing here writes to the database.
//
// Providers report usage when a call finishes. A call stopped by the person,
// cut by the deadline or broken by an error mid-stream has still been billed,
// so its usage is estimated from the prompt and the text received, and the
// budget can't be dodged by stopping drafts.
//
// When the first model fails before answering anything (overloaded, rate
// limited, unreachable), the fallback model, if one is set, gets the same
// call once (Story KRB-17). A model that answered is never replaced.

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type DraftFailure = "invalidOutput" | "aborted" | "timeout" | "providerError";

type DraftOutcome = {
  rawText: string;
  repaired: boolean;
  usage: TokenUsage;
  /** Some of the usage is an estimate: a call ended before the provider reported it. */
  usageEstimated: boolean;
  /** The fallback model wrote the draft. */
  usedFallback: boolean;
};

export type DraftResult =
  ({ ok: true; output: DraftOutput } & DraftOutcome) | ({ ok: false; error: DraftFailure } & DraftOutcome);

export type DraftCall = {
  model: LanguageModelV3;
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
  /** Used once when `model` fails before answering. */
  fallback?: LanguageModelV3 | null;
  /** AI SDK spans (src/lib/ai/tracing.ts). */
  telemetry?: TelemetrySettings;
};

/** Longest previous answer quoted back to the model in the repair call. */
const REPAIR_QUOTE_CHARS = 40_000;

/** Tokens a repair call may use on top of the first one: the prompt again, the quoted answer and the output. */
export function repairReserve(promptTokens: number, maxTokens: number): number {
  return promptTokens + Math.ceil(REPAIR_QUOTE_CHARS / CHARS_PER_TOKEN) + maxTokens;
}

type AttemptBase = {
  rawText: string;
  usage: TokenUsage;
  usageEstimated: boolean;
  /** The model sent something back before the call ended. */
  answered: boolean;
};

type Attempt =
  | ({ ok: true; value: unknown } & AttemptBase)
  | ({ ok: false; invalid: boolean; error: unknown } & AttemptBase);

function addUsage(total: TokenUsage, more: TokenUsage): TokenUsage {
  return {
    inputTokens: total.inputTokens + more.inputTokens,
    outputTokens: total.outputTokens + more.outputTokens,
  };
}

function usageOf(usage: Pick<LanguageModelUsage, "inputTokens" | "outputTokens"> | undefined): TokenUsage {
  const input = Number(usage?.inputTokens);
  const output = Number(usage?.outputTokens);
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

async function attempt(
  call: DraftCall,
  model: LanguageModelV3,
  prompt: string,
  signal: AbortSignal,
): Promise<Attempt> {
  let rawText = "";
  let usage: TokenUsage | null = null;
  let streamError: unknown = null;
  let started = false;
  // A call that got an answer started, or was stopped, has been billed even without a usage report.
  const settle = (reported: TokenUsage | null): Pick<AttemptBase, "usage" | "usageEstimated" | "answered"> =>
    reported && (reported.inputTokens > 0 || reported.outputTokens > 0)
      ? { usage: reported, usageEstimated: false, answered: started }
      : started || signal.aborted
        ? {
            usage: {
              inputTokens: estimateTokens(call.system + prompt),
              outputTokens: estimateTokens(rawText),
            },
            usageEstimated: true,
            answered: started,
          }
        : { usage: { inputTokens: 0, outputTokens: 0 }, usageEstimated: false, answered: false };
  try {
    const result = streamObject({
      model,
      schema: outputSchemaFor(call.schema, call.refs),
      schemaName: "brouillon",
      schemaDescription: "Brouillon de section de rapport d'expertise, en français.",
      system: call.system,
      prompt,
      temperature: call.temperature,
      maxOutputTokens: call.maxTokens,
      providerOptions: noThinking(),
      maxRetries: 1,
      abortSignal: signal,
      // Errors arrive in the stream below; this keeps them out of the logs twice.
      onError: () => undefined,
      experimental_telemetry: call.telemetry,
    });
    for await (const part of result.fullStream) {
      // An error part alone means the provider refused the call, which isn't billed.
      if (part.type !== "error") started = true;
      if (part.type === "object") call.onPartial(part.object);
      else if (part.type === "text-delta") rawText += part.textDelta;
      else if (part.type === "finish") usage = usageOf(part.usage);
      else if (part.type === "error") streamError = part.error;
    }
    if (streamError) return { ok: false, invalid: false, error: streamError, rawText, ...settle(usage) };
    const value = await result.object;
    return { ok: true, value, rawText, ...settle(usage) };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      rawText = error.text ?? rawText;
      return {
        ok: false,
        invalid: true,
        error,
        rawText,
        ...settle(error.usage ? usageOf(error.usage) : usage),
      };
    }
    return { ok: false, invalid: false, error, rawText, ...settle(usage) };
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

  let model = call.model;
  let usedFallback = false;
  let first = await attempt(call, model, call.prompt, signal);
  usage = addUsage(usage, first.usage);
  let usageEstimated = first.usageEstimated;
  if (!first.ok && !first.invalid && !first.answered && !signal.aborted && call.fallback) {
    model = call.fallback;
    usedFallback = true;
    first = await attempt(call, model, call.prompt, signal);
    usage = addUsage(usage, first.usage);
    usageEstimated ||= first.usageEstimated;
  }
  const outcome = () => ({ usage, usageEstimated, usedFallback });

  const firstOutput = first.ok ? parseDraftOutput(call.schema, call.refs, first.value) : null;
  if (firstOutput) {
    return { ok: true, output: firstOutput, rawText: first.rawText, repaired: false, ...outcome() };
  }
  if (!first.ok && (!first.invalid || signal.aborted)) {
    return { ok: false, error: failure(call), rawText: first.rawText, repaired: false, ...outcome() };
  }

  call.onRepair();
  const problems = describeValidationError(first.ok ? null : first.error);
  const second = await attempt(call, model, repairPrompt(call.prompt, first.rawText, problems), signal);
  usage = addUsage(usage, second.usage);
  usageEstimated ||= second.usageEstimated;
  const secondOutput = second.ok ? parseDraftOutput(call.schema, call.refs, second.value) : null;
  if (secondOutput) {
    return { ok: true, output: secondOutput, rawText: second.rawText, repaired: true, ...outcome() };
  }
  const error = !second.ok && !second.invalid ? failure(call) : "invalidOutput";
  return { ok: false, error, rawText: second.rawText || first.rawText, repaired: true, ...outcome() };
}
