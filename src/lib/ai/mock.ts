import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import type { OutputSchema } from "@/lib/prompts/catalog";
import type { DraftOutputByKey, SourceRefs } from "./schemas";

// A stand-in for the model, for end-to-end tests and local work without an
// API key (AI_PROVIDER=mock, refused when APP_ENV=production). It answers
// with fixed French text that fits the schema and cites the refs it is given.

const CHUNK_CHARS = 40;

function chunks(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += CHUNK_CHARS)
    parts.push(text.slice(start, start + CHUNK_CHARS));
  return parts;
}

/** Rough count for the mock's usage, close to what the context builder estimates. */
function tokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function promptText(prompt: LanguageModelV4CallOptions["prompt"]): string {
  return prompt
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => ("text" in part ? part.text : "")).join(""),
    )
    .join("\n");
}

function usageFor(prompt: LanguageModelV4CallOptions["prompt"], text: string): LanguageModelV4Usage {
  const input = tokens(promptText(prompt));
  const output = tokens(text);
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

const STOP = { unified: "stop", raw: "stop" } as const;

/** A model that always answers `respond()`, streamed in small pieces with a short pause between them. */
export function mockModel(respond: () => string, modelId = "mock"): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "mock",
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const text = respond();
      return {
        content: [{ type: "text", text }],
        finishReason: STOP,
        usage: usageFor(options.prompt, text),
        warnings: [],
      };
    },
    async doStream(options) {
      const text = respond();
      const parts = chunks(text);
      const usage = usageFor(options.prompt, text);
      const signal = options.abortSignal;
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "0" });
          for (const part of parts) {
            if (signal?.aborted) {
              controller.error(signal.reason);
              return;
            }
            controller.enqueue({ type: "text-delta", id: "0", delta: part });
            await new Promise((resolve) => setTimeout(resolve, 15));
          }
          controller.enqueue({ type: "text-end", id: "0" });
          controller.enqueue({ type: "finish", finishReason: STOP, usage });
          controller.close();
        },
      });
      return { stream };
    },
  };
}

/** A valid output for each schema, citing the first refs. */
export function sampleOutput<K extends OutputSchema>(key: K, refs: SourceRefs): DraftOutputByKey[K] {
  const first = refs[0];
  const cited = refs.slice(0, 3);
  const sources = cited.map((ref) => ({ deliverable: ref, detail: "Constats repris de ce livrable." }));
  const outputs: DraftOutputByKey = {
    section_draft: {
      title: "Brouillon de la section",
      summary: "Ce brouillon reprend les constats des livrables fournis par l'équipe.",
      body_markdown:
        "### Contexte\n\nLes livrables fournis décrivent la situation étudiée.\n\n### Constats\n\nLes éléments réunis permettent de dresser un premier état des lieux.",
      recommendations: ["Confirmer les chiffres avec les équipes concernées."],
      sources,
    },
    executive_summary: {
      summary:
        "L'expertise porte sur la situation décrite dans les livrables. Les constats principaux sont repris ci-dessous.",
      key_points: ["Premier point clé.", "Deuxième point clé.", "Troisième point clé."],
      sources,
    },
    recommendations: {
      introduction: "Les recommandations suivantes découlent des constats de la section.",
      recommendations: [
        {
          title: "Confirmer les données",
          rationale: "Certains chiffres des livrables doivent être vérifiés.",
          priority: "haute",
          priority_reason: "Les autres recommandations en dépendent.",
          sources: [first],
        },
      ],
      sources,
    },
    data_analysis: {
      summary: "Les tableaux fournis montrent des valeurs stables sur la période.",
      observations: [
        {
          label: "Tendance générale",
          detail: "Les valeurs restent du même ordre de grandeur.",
          sources: [first],
        },
      ],
      limits: ["Certaines périodes ne sont pas couvertes."],
      sources,
    },
  };
  return outputs[key];
}
