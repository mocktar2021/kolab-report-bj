import type { LanguageModelV1 } from "ai";
import { mockModel, sampleOutput } from "@/lib/ai/mock";
import type { SourceRefs } from "@/lib/ai/schemas";
import type { OutputSchema } from "@/lib/prompts/catalog";
import { mockJudgeAnswer } from "./judge";

// Models for `npm run eval -- --mock` and the tests: no key, no network.
// The writer answers the app's sample output for the schema, citing the
// first refs; the summarizer and the judge answer fixed text.

export const MOCK_SUMMARY =
  "Cet extrait du livrable reprend des constats de terrain et des relevés chiffrés, résumés ici sans détail.";

export function mockGenerator(refs: SourceRefs, schema: OutputSchema): LanguageModelV1 {
  return mockModel(() => JSON.stringify(sampleOutput(schema, refs)), "mock");
}

export function mockSummarizer(): LanguageModelV1 {
  return mockModel(() => MOCK_SUMMARY, "mock-summary");
}

export function mockJudge(): LanguageModelV1 {
  return mockModel(() => JSON.stringify(mockJudgeAnswer()), "mock-judge");
}
