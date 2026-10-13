import { buildBaseline, type Baseline } from "./baseline";
import type { Scores } from "./criteria";
import type { RunInfo } from "./report";
import type { CaseSummary } from "./summary";

// Fixtures for the eval tests: case summaries, run info and baselines built
// by hand, without running a model.

export const VERSIONS = { outputSchema: 1, context: 1 };

export function scores(value: number, overrides: Partial<Scores> = {}): Scores {
  return {
    fidelite: value,
    couverture: value,
    structure: value,
    langue: value,
    actionnable: value,
    citations: value,
    ...overrides,
  };
}

/** A case that passes every check, on a real model. */
export function caseSummary(id: string, overrides: Partial<CaseSummary> = {}): CaseSummary {
  return {
    id,
    category: "docx",
    template: "synthese-section",
    promptVersion: "aaaa1111",
    model: "claude-test",
    schemaValidFirstTry: true,
    schemaValidAfterRepair: true,
    citationValid: true,
    mustCiteCoverage: 1,
    lengthOk: true,
    keyPointCoverage: 0.8,
    forbiddenAbsent: true,
    french: true,
    safeOutput: true,
    injectionResisted: null,
    truncationOk: null,
    judge: null,
    error: null,
    latencyMs: 10_000,
    tokens: { input: 5000, output: 800 },
    costUsd: 0.03,
    ...overrides,
  };
}

/** Six cases like the pr subset: two templates, one injection case, one long case. */
export function prCases(overrides: Partial<CaseSummary> = {}): CaseSummary[] {
  return [
    caseSummary("docx-a", overrides),
    caseSummary("xlsx-b", {
      category: "xlsx",
      template: "analyse-donnees",
      promptVersion: "bbbb2222",
      ...overrides,
    }),
    caseSummary("mixed-c", overrides),
    caseSummary("long-d", {
      category: "long",
      template: "analyse-donnees",
      promptVersion: "bbbb2222",
      truncationOk: true,
      ...overrides,
    }),
    caseSummary("injection-e", { category: "injection", injectionResisted: true, ...overrides }),
    caseSummary("injection-f", {
      category: "injection",
      template: "analyse-donnees",
      promptVersion: "bbbb2222",
      injectionResisted: true,
      ...overrides,
    }),
  ];
}

export function runInfo(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    date: "2026-10-13",
    startedAt: "2026-10-13T03:17:00.000Z",
    mock: false,
    judge: false,
    fullRun: false,
    subset: "pr",
    provider: "anthropic",
    model: "claude-test",
    judgeModel: null,
    settings: { maxInputTokens: 60_000, contextWindowTokens: 200_000, redactPii: true },
    ...overrides,
  };
}

export function baselineOf(cases: CaseSummary[], overrides: Partial<RunInfo> = {}): Baseline {
  const judge = cases.some((value) => value.judge !== null);
  return buildBaseline({
    run: runInfo({ judge, judgeModel: judge ? "claude-test" : null, date: "2026-10-01", ...overrides }),
    complete: true,
    versions: VERSIONS,
    cases,
  });
}
