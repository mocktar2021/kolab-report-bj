import type { LanguageModelV4 } from "@ai-sdk/provider";
import { mockModel, sampleOutput } from "@/lib/ai/mock";
import type { SourceRefs } from "@/lib/ai/schemas";
import type { OutputSchema } from "@/lib/prompts/catalog";
import { mockJudgeAnswer } from "./judge";

// Models for `npm run eval -- --mock` and the tests: no key, no network.
// The writer answers the app's sample output for the schema, citing the
// first refs; the judge answers fixed text.

export function mockGenerator(refs: SourceRefs, schema: OutputSchema): LanguageModelV4 {
  return mockModel(() => JSON.stringify(sampleOutput(schema, refs)), "mock");
}

export function mockJudge(): LanguageModelV4 {
  return mockModel(() => JSON.stringify(mockJudgeAnswer()), "mock-judge");
}
