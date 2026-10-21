import type { LanguageModelV4 } from "@ai-sdk/provider";
import { generateText, NoObjectGeneratedError, Output, type TelemetryOptions } from "ai";
import type { OutputSchema } from "@/lib/prompts/catalog";
import {
  readWriterOutput,
  WRITER_SYSTEM_PROMPT,
  writerOutputSchema,
  writerPrompt,
  type WriterOutput,
  type WriterRejection,
  type WrittenTemplate,
} from "@/lib/prompts/writer";
import { estimateTokens } from "./context/tokens";
import type { TokenUsage } from "./generate";
import { noThinking } from "./models";

// One call of "Rédiger avec l'IA" (KRB-198): a description in, a template
// out, checked and cleaned by src/lib/prompts/writer.ts. One attempt, no
// repair: the manager can ask again, within the daily limit. No database
// write here; the server action records the call. The evals use it too.

/** Room for a title, a sentence and a template of about 3 000 characters, as JSON. */
export const TEMPLATE_WRITER_MAX_OUTPUT_TOKENS = 2048;

export type TemplateWriterFailure = "invalidOutput" | "timeout" | "providerError";

export type TemplateWriterResult =
  | { ok: true; written: WrittenTemplate; usage: TokenUsage; usageEstimated: boolean; rawText: string }
  | {
      ok: false;
      error: TemplateWriterFailure;
      rejection?: WriterRejection;
      usage: TokenUsage;
      usageEstimated: boolean;
      rawText: string;
    };

export type TemplateWriterCall = {
  model: LanguageModelV4;
  description: string;
  /** The type of result chosen in the form, as a hint. */
  outputSchema: OutputSchema | null;
  signal?: AbortSignal;
  telemetry?: TelemetryOptions;
};

function usageOf(usage: { inputTokens?: number; outputTokens?: number } | undefined): TokenUsage {
  const input = Number(usage?.inputTokens);
  const output = Number(usage?.outputTokens);
  return {
    inputTokens: Number.isFinite(input) ? input : 0,
    outputTokens: Number.isFinite(output) ? output : 0,
  };
}

function callModel(call: TemplateWriterCall, prompt: string) {
  return generateText({
    model: call.model,
    instructions: WRITER_SYSTEM_PROMPT,
    prompt,
    output: Output.object({
      schema: writerOutputSchema,
      name: "modele",
      description: "Modèle de prompt KolabReport, en français.",
    }),
    maxOutputTokens: TEMPLATE_WRITER_MAX_OUTPUT_TOKENS,
    providerOptions: noThinking(),
    maxRetries: 1,
    abortSignal: call.signal,
    telemetry: call.telemetry,
  });
}

export async function writeTemplate(call: TemplateWriterCall): Promise<TemplateWriterResult> {
  const prompt = writerPrompt(call.description, call.outputSchema);
  // A call stopped or broken after it started was billed for its prompt at least.
  const estimated = (rawText = ""): TokenUsage => ({
    inputTokens: estimateTokens(WRITER_SYSTEM_PROMPT + prompt),
    outputTokens: estimateTokens(rawText),
  });
  let result: Awaited<ReturnType<typeof callModel>>;
  try {
    result = await callModel(call, prompt);
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      const reported = error.usage ? usageOf(error.usage) : null;
      const rawText = error.text ?? "";
      return {
        ok: false,
        error: "invalidOutput",
        usage: reported ?? estimated(rawText),
        usageEstimated: reported === null,
        rawText,
      };
    }
    if (call.signal?.aborted) {
      return { ok: false, error: "timeout", usage: estimated(), usageEstimated: true, rawText: "" };
    }
    // Refused or unreachable before answering: nothing billed.
    return {
      ok: false,
      error: "providerError",
      usage: { inputTokens: 0, outputTokens: 0 },
      usageEstimated: false,
      rawText: "",
    };
  }

  const usage = usageOf(result.usage);
  const failed = (rejection?: WriterRejection): TemplateWriterResult => ({
    ok: false,
    error: "invalidOutput",
    ...(rejection ? { rejection } : {}),
    usage,
    usageEstimated: false,
    rawText: result.text,
  });
  let output: WriterOutput;
  try {
    // Throws when the call ended without an object, cut by the length cap for example.
    output = result.output;
  } catch {
    return failed();
  }
  const read = readWriterOutput(output);
  if ("rejected" in read) return failed(read.rejected);
  return { ok: true, written: read, usage, usageEstimated: false, rawText: result.text };
}

/** What the mock provider answers (AI_PROVIDER=mock): a fixed template that passes every check. */
export function sampleWrittenTemplate(): { title: string; description: string; template: string } {
  return {
    title: "Synthèse des constats de terrain",
    description: "Rédige une section qui reprend les constats des livrables, avec leurs sources.",
    template: `Tu rédiges une section d'un rapport d'expertise, en français.

Rapport : {{report_title}}
Contexte du rapport : {{report_context}}
Section à rédiger : {{section_title}}
Consignes de la section : {{section_instructions}}

Livrables fournis par l'équipe :
{{deliverables}}

Présente les constats de terrain, du plus important au moins important.
Appuie chaque constat sur les livrables et cite le fichier d'où il vient.
N'invente aucun chiffre, aucune date ni aucun nom qui ne figure pas dans les livrables. Quand une information manque, dis-le clairement.
Garde un ton professionnel et précis.`,
  };
}
