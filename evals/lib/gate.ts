import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { CRITERIA, CRITERION_KEYS, type Criterion } from "./criteria";

// The release gate: each aggregate against its minimum in
// evals/thresholds.json. Structural checks (schema, citations, injection,
// truncation) always count. Quality checks depend on what the model writes,
// so a --mock run reports them without failing on them. The same file holds
// the regression limits that --compare applies (lib/compare.ts).

export const THRESHOLDS_FILE = "evals/thresholds.json";

const rate = z.number().min(0).max(1);
const score = z.number().min(1).max(5);

function perCriterion<T extends z.ZodTypeAny>(value: T) {
  return z
    .object(Object.fromEntries(CRITERION_KEYS.map((key) => [key, value])) as Record<Criterion, T>)
    .strict();
}

/** Largest drop allowed against the baseline: a share for rates, points for judge means. */
const regressionSchema = z
  .object({
    maxDrop: z
      .object({
        schemaValidFirstTry: rate,
        schemaValidAfterRepair: rate,
        citationValidRate: rate,
        injectionResistedRate: rate,
        safeOutputRate: rate,
        longCasesTruncatedRate: rate,
        mustCiteRate: rate,
        lengthOkRate: rate,
        keyPointCoverage: rate,
        forbiddenAbsentRate: rate,
        plainStyleRate: rate,
        frenchRate: rate,
        judge: perCriterion(z.number().min(0).max(4)),
      })
      .strict(),
    /** Relative increase that only warns: 0.3 is +30 %. */
    warnIncrease: z
      .object({ costPerCase: z.number().positive(), latencyP95: z.number().positive() })
      .strict(),
  })
  .strict();

export const thresholdsSchema = z
  .object({
    schemaValidFirstTry: rate,
    schemaValidAfterRepair: rate,
    citationValidRate: rate,
    injectionResistedRate: rate,
    safeOutputRate: rate,
    longCasesTruncatedRate: rate,
    mustCiteRate: rate,
    lengthOkRate: rate,
    keyPointCoverage: rate,
    forbiddenAbsentRate: rate,
    plainStyleRate: rate,
    frenchRate: rate,
    judge: perCriterion(score),
    regression: regressionSchema,
  })
  .strict();

export type Thresholds = z.infer<typeof thresholdsSchema>;

export type RegressionLimits = Thresholds["regression"];

export function loadThresholds(file = resolve(THRESHOLDS_FILE)): Thresholds {
  return thresholdsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** The aggregates the gate reads. Null when nothing was measured (no injection case in a subset, judge off). */
export type GateInput = {
  schemaValidFirstTry: number | null;
  schemaValidAfterRepair: number | null;
  citationValidRate: number | null;
  injectionResistedRate: number | null;
  safeOutputRate: number | null;
  longCasesTruncatedRate: number | null;
  mustCiteRate: number | null;
  lengthOkRate: number | null;
  keyPointCoverage: number | null;
  forbiddenAbsentRate: number | null;
  plainStyleRate: number | null;
  frenchRate: number | null;
  judge: Record<Criterion, number | null> | null;
};

export type RateMetric = Exclude<keyof Thresholds, "judge" | "regression">;

export const STRUCTURAL: readonly RateMetric[] = [
  "schemaValidFirstTry",
  "schemaValidAfterRepair",
  "citationValidRate",
  "injectionResistedRate",
  "safeOutputRate",
  "longCasesTruncatedRate",
];

export const QUALITY: readonly RateMetric[] = [
  "mustCiteRate",
  "lengthOkRate",
  "keyPointCoverage",
  "forbiddenAbsentRate",
  "plainStyleRate",
  "frenchRate",
];

/** Every rate metric, structural first. */
export const RATE_METRICS: readonly RateMetric[] = [...STRUCTURAL, ...QUALITY];

export type GateStatus = "pass" | "fail" | "skipped" | "not enforced";

export type GateRow = {
  metric: string;
  value: number | null;
  min: number;
  status: GateStatus;
};

export type GateResult = {
  passed: boolean;
  rows: GateRow[];
  /** Cases the budget kept from starting. A run with any is incomplete: not valid for a release. */
  skippedCases: string[];
  complete: boolean;
  /** Nothing ran (the budget didn't cover the first case): the gate fails. */
  noCaseRan: boolean;
};

export type GateOptions = {
  mock: boolean;
  /** Case ids not started because of the budget. */
  skipped?: readonly string[];
  /** Cases that ran. Zero fails the gate. */
  ran?: number;
};

function row(metric: string, value: number | null, min: number, enforced: boolean): GateRow {
  if (value === null) return { metric, value, min, status: "skipped" };
  if (!enforced) return { metric, value, min, status: "not enforced" };
  // Rates are sums of fractions, so 0.9 can come out as 0.8999999999999999.
  return { metric, value, min, status: value + 1e-9 >= min ? "pass" : "fail" };
}

export function applyGate(input: GateInput, thresholds: Thresholds, options: GateOptions): GateResult {
  const rows: GateRow[] = [
    ...STRUCTURAL.map((metric) => row(metric, input[metric], thresholds[metric], true)),
    ...QUALITY.map((metric) => row(metric, input[metric], thresholds[metric], !options.mock)),
    ...CRITERIA.map(({ key }) =>
      row(`judge.${key}`, input.judge?.[key] ?? null, thresholds.judge[key], !options.mock),
    ),
  ];
  const skippedCases = [...(options.skipped ?? [])];
  const noCaseRan = options.ran === 0;
  return {
    passed: !noCaseRan && rows.every((item) => item.status !== "fail"),
    rows,
    skippedCases,
    complete: skippedCases.length === 0,
    noCaseRan,
  };
}

function formatValue(metric: string, value: number | null): string {
  if (value === null) return "n/a";
  return metric.startsWith("judge.") ? value.toFixed(2) : `${(value * 100).toFixed(1)} %`;
}

export function renderGate(result: GateResult): string {
  const width = Math.max(...result.rows.map((item) => item.metric.length));
  const lines = result.rows.map(
    (item) =>
      `${item.metric.padEnd(width)}  ${formatValue(item.metric, item.value).padStart(8)}  min ${formatValue(item.metric, item.min).padStart(8)}  ${item.status}`,
  );
  if (result.noCaseRan) lines.push("No case ran: the budget does not cover the first case.");
  if (!result.complete)
    lines.push(
      `Run incomplete: ${result.skippedCases.length} case(s) not started, budget reached (${result.skippedCases.join(", ")}).`,
    );
  lines.push(`Gate: ${result.passed ? "PASS" : "FAIL"}${result.complete ? "" : " (incomplete run)"}`);
  return lines.join("\n");
}
