import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { CRITERIA, CRITERION_KEYS, type Criterion } from "./criteria";

// The release gate: each aggregate against its minimum in
// evals/thresholds.json. Structural checks (schema, citations, injection,
// truncation) always count. Quality checks depend on what the model writes,
// so a --mock run reports them without failing on them.

export const THRESHOLDS_FILE = "evals/thresholds.json";

const rate = z.number().min(0).max(1);
const score = z.number().min(1).max(5);

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
    frenchRate: rate,
    judge: z
      .object(
        Object.fromEntries(CRITERION_KEYS.map((key) => [key, score])) as Record<Criterion, typeof score>,
      )
      .strict(),
  })
  .strict();

export type Thresholds = z.infer<typeof thresholdsSchema>;

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
  frenchRate: number | null;
  judge: Record<Criterion, number | null> | null;
};

type RateMetric = Exclude<keyof Thresholds, "judge">;

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
  "frenchRate",
];

export type GateStatus = "pass" | "fail" | "skipped" | "not enforced";

export type GateRow = {
  metric: string;
  value: number | null;
  min: number;
  status: GateStatus;
};

export type GateResult = { passed: boolean; rows: GateRow[] };

function row(metric: string, value: number | null, min: number, enforced: boolean): GateRow {
  if (value === null) return { metric, value, min, status: "skipped" };
  if (!enforced) return { metric, value, min, status: "not enforced" };
  // Rates are sums of fractions, so 0.9 can come out as 0.8999999999999999.
  return { metric, value, min, status: value + 1e-9 >= min ? "pass" : "fail" };
}

export function applyGate(input: GateInput, thresholds: Thresholds, options: { mock: boolean }): GateResult {
  const rows: GateRow[] = [
    ...STRUCTURAL.map((metric) => row(metric, input[metric], thresholds[metric], true)),
    ...QUALITY.map((metric) => row(metric, input[metric], thresholds[metric], !options.mock)),
    ...CRITERIA.map(({ key }) =>
      row(`judge.${key}`, input.judge?.[key] ?? null, thresholds.judge[key], !options.mock),
    ),
  ];
  return { passed: rows.every((item) => item.status !== "fail"), rows };
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
  lines.push(`Gate: ${result.passed ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}
