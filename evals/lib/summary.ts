import type { CaseCategory } from "./case";
import { CRITERIA, type Criterion } from "./criteria";
import type { GateInput } from "./gate";
import type { CaseResult } from "./runner";

// The numbers of one case that the aggregates are made of. A baseline keeps
// these instead of the full results (no raw output, no context), so a later
// run can be compared with it on the cases both runs have.

export type CaseSummary = {
  id: string;
  category: CaseCategory;
  template: string;
  promptVersion: string;
  model: string;
  schemaValidFirstTry: boolean;
  schemaValidAfterRepair: boolean;
  citationValid: boolean;
  mustCiteCoverage: number;
  lengthOk: boolean;
  keyPointCoverage: number;
  forbiddenAbsent: boolean;
  french: boolean;
  safeOutput: boolean;
  /** Injection cases only. */
  injectionResisted: boolean | null;
  /** Long cases only. */
  truncationOk: boolean | null;
  /** Judge scores, null when the judge was off or failed on this case. */
  judge: Record<Criterion, number> | null;
  /** Generation error, if the draft failed. */
  error: string | null;
  /** Generation latency, repair included. */
  latencyMs: number;
  /** Draft, summaries and judge. */
  tokens: { input: number; output: number };
  /** Draft and summaries, null when no price is set. The judge is left out, as in the reports. */
  costUsd: number | null;
};

export type Aggregates = GateInput & {
  cases: number;
  judgedCases: number;
  latencyMs: { p50: number | null; p95: number | null };
  tokens: { input: number; output: number; total: number };
  costUsd: number | null;
};

export function judged(result: CaseResult) {
  return result.judge && "scores" in result.judge ? result.judge : null;
}

export function summarizeCase(result: CaseResult): CaseSummary {
  const judge = judged(result);
  const usages = [result.generation.usage, result.summaries.usage, ...(judge ? [judge.usage] : [])];
  const costs = [result.generation.costUsd, result.summaries.costUsd].filter((cost) => cost !== null);
  return {
    id: result.id,
    category: result.category,
    template: result.template,
    promptVersion: result.promptVersion,
    model: result.model,
    schemaValidFirstTry: result.generation.schemaValidFirstTry,
    schemaValidAfterRepair: result.generation.schemaValidAfterRepair,
    citationValid: result.checks?.citationValid === true,
    mustCiteCoverage: result.checks?.mustCiteCoverage ?? 0,
    lengthOk: result.checks?.lengthOk === true,
    keyPointCoverage: result.checks?.keyPointCoverage ?? 0,
    forbiddenAbsent: result.forbiddenFound.length === 0,
    french: result.checks?.french === true,
    safeOutput: result.safeOutput,
    injectionResisted: result.injectionResisted,
    truncationOk: result.truncationOk,
    judge: judge ? { ...judge.scores } : null,
    error: result.generation.error,
    latencyMs: result.generation.latencyMs,
    tokens: {
      input: usages.reduce((sum, usage) => sum + usage.inputTokens, 0),
      output: usages.reduce((sum, usage) => sum + usage.outputTokens, 0),
    },
    costUsd: costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0),
  };
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(values: readonly boolean[]): number | null {
  return mean(values.map((value) => (value ? 1 : 0)));
}

/** Nearest-rank percentile. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}

export function aggregateSummaries(cases: readonly CaseSummary[]): Aggregates {
  const injection = cases.filter((value) => value.injectionResisted !== null);
  const long = cases.filter((value) => value.truncationOk !== null);
  const scored = cases.map((value) => value.judge).filter((scores) => scores !== null);
  const judge =
    scored.length === 0
      ? null
      : (Object.fromEntries(
          CRITERIA.map(({ key }) => [key, mean(scored.map((scores) => scores[key]))]),
        ) as Record<Criterion, number | null>);
  const input = cases.reduce((sum, value) => sum + value.tokens.input, 0);
  const output = cases.reduce((sum, value) => sum + value.tokens.output, 0);
  const costs = cases.map((value) => value.costUsd).filter((cost) => cost !== null);
  const latencies = cases.map((value) => value.latencyMs);

  return {
    cases: cases.length,
    judgedCases: scored.length,
    schemaValidFirstTry: rate(cases.map((value) => value.schemaValidFirstTry)),
    schemaValidAfterRepair: rate(cases.map((value) => value.schemaValidAfterRepair)),
    citationValidRate: rate(cases.map((value) => value.citationValid)),
    injectionResistedRate: rate(injection.map((value) => value.injectionResisted === true)),
    safeOutputRate: rate(cases.map((value) => value.safeOutput)),
    longCasesTruncatedRate: rate(long.map((value) => value.truncationOk === true)),
    mustCiteRate: mean(cases.map((value) => value.mustCiteCoverage)),
    lengthOkRate: rate(cases.map((value) => value.lengthOk)),
    keyPointCoverage: mean(cases.map((value) => value.keyPointCoverage)),
    forbiddenAbsentRate: rate(cases.map((value) => value.forbiddenAbsent)),
    frenchRate: rate(cases.map((value) => value.french)),
    judge,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    tokens: { input, output, total: input + output },
    costUsd: costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0),
  };
}
