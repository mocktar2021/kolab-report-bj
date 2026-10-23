import type { Baseline, Versions } from "./baseline";
import { CRITERIA, type Criterion } from "./criteria";
import { RATE_METRICS, type RegressionLimits } from "./gate";
import { aggregateSummaries, type Aggregates, type CaseSummary } from "./summary";

// Compares a run with a baseline run (--compare). Both sides are aggregated
// on the cases they have in common, overall and per template, and each
// metric is checked against its largest allowed drop in
// evals/thresholds.json (regression.maxDrop). Cost and latency only warn
// (regression.warnIncrease). Judge metrics count only when both runs had the
// judge. A mock run, or a mock baseline, is never compared: the mock writes
// fixed text, so its numbers say nothing about quality.
//
// A drop beyond its limit fails the run when it is on all the common cases,
// or on a template whose prompt version changed. On a template whose prompt
// did not change, it only warns: a template has one or two cases in a
// subset, too few to fail on.

const EPSILON = 1e-9;

export type CompareMetric = string;

export type CompareRow = {
  /** A gate metric, judge.<criterion>, costPerCase, tokensPerCase or latencyP95. */
  metric: CompareMetric;
  unit: "rate" | "score" | "usd" | "tokens" | "ms";
  current: number | null;
  baseline: number | null;
  /** Rates and scores: current minus baseline. Cost, tokens, latency: relative change (0.3 is +30 %). */
  change: number | null;
  /** Largest drop allowed (rule "drop"), or increase that warns (rule "increase"). */
  limit: number;
  rule: "drop" | "increase";
  status: "ok" | "regression" | "warning" | "skipped";
};

export type TemplateComparison = {
  key: string;
  promptVersion: string;
  baselinePromptVersion: string;
  promptChanged: boolean;
  cases: number;
  rows: CompareRow[];
};

export const CASE_CHECKS = [
  "schemaValidAfterRepair",
  "schemaValidFirstTry",
  "citationValid",
  "safeOutput",
  "injectionResisted",
  "truncationOk",
  "forbiddenAbsent",
  "plainStyle",
  "french",
  "lengthOk",
] as const;

export type CaseCheck = (typeof CASE_CHECKS)[number];

export type CaseChange = {
  id: string;
  /** Checks that passed in the baseline and fail now. */
  lost: CaseCheck[];
  /** Checks that failed in the baseline and pass now. */
  gained: CaseCheck[];
  /** Key point coverage, when it went down. */
  keyPoints: { current: number; baseline: number } | null;
  /** Judge criteria that lost a point or more. */
  judge: { criterion: Criterion; current: number; baseline: number }[];
};

/** A row over its limit. Scope null is all the common cases, otherwise a template key. */
export type Finding = { scope: string | null; row: CompareRow };

export type BaselineInfo = {
  file: string;
  date: string;
  provider: string;
  model: string;
  judge: boolean;
  judgeModel: string | null;
  subset: string | null;
  fullRun: boolean;
  versions: Versions;
};

export type Comparison =
  | { status: "off" }
  | { status: "no-baseline"; file: string }
  | { status: "mock"; file: string; reason: "run" | "baseline" }
  | { status: "no-common-cases"; file: string; baseline: BaselineInfo }
  | {
      status: "compared";
      file: string;
      baseline: BaselineInfo;
      common: string[];
      /** Cases of this run the baseline doesn't have (new cases): left out of the comparison. */
      onlyCurrent: string[];
      versions: { current: Versions; baseline: Versions };
      judgeCompared: boolean;
      overall: CompareRow[];
      templates: TemplateComparison[];
      cases: CaseChange[];
      /** These fail the run. */
      regressions: Finding[];
      /** Cost and latency increases, and drops on templates whose prompt didn't change. */
      warnings: Finding[];
    };

export type CurrentRun = {
  cases: readonly CaseSummary[];
  mock: boolean;
  judge: boolean;
  versions: Versions;
};

function dropRow(
  metric: string,
  unit: "rate" | "score",
  current: number | null,
  baseline: number | null,
  limit: number,
): CompareRow {
  if (current === null || baseline === null)
    return { metric, unit, current, baseline, change: null, limit, rule: "drop", status: "skipped" };
  const change = current - baseline;
  return {
    metric,
    unit,
    current,
    baseline,
    change,
    limit,
    rule: "drop",
    status: change < -limit - EPSILON ? "regression" : "ok",
  };
}

function increaseRow(
  metric: string,
  unit: "usd" | "tokens" | "ms",
  current: number | null,
  baseline: number | null,
  limit: number,
): CompareRow {
  if (current === null || baseline === null || baseline <= 0)
    return { metric, unit, current, baseline, change: null, limit, rule: "increase", status: "skipped" };
  const change = (current - baseline) / baseline;
  return {
    metric,
    unit,
    current,
    baseline,
    change,
    limit,
    rule: "increase",
    status: change > limit + EPSILON ? "warning" : "ok",
  };
}

function costPerCase(value: Aggregates): number | null {
  return value.cases > 0 && value.costUsd !== null ? value.costUsd / value.cases : null;
}

/** Rows for two sets of aggregates over the same cases. */
export function compareAggregates(
  current: Aggregates,
  baseline: Aggregates,
  limits: RegressionLimits,
  options: { judge: boolean; sameJudge: boolean },
): CompareRow[] {
  const rows = RATE_METRICS.map((metric) =>
    dropRow(metric, "rate", current[metric], baseline[metric], limits.maxDrop[metric]),
  );
  if (options.judge) {
    for (const { key } of CRITERIA) {
      rows.push(
        dropRow(
          `judge.${key}`,
          "score",
          current.judge?.[key] ?? null,
          baseline.judge?.[key] ?? null,
          limits.maxDrop.judge[key],
        ),
      );
    }
  }
  const currentCost = costPerCase(current);
  const baselineCost = costPerCase(baseline);
  if (currentCost !== null && baselineCost !== null) {
    rows.push(increaseRow("costPerCase", "usd", currentCost, baselineCost, limits.warnIncrease.costPerCase));
  } else {
    // No price on one side: tokens per case instead, when both counted the same calls.
    const tokens = (value: Aggregates) =>
      value.cases > 0 && options.sameJudge ? value.tokens.total / value.cases : null;
    rows.push(
      increaseRow(
        "tokensPerCase",
        "tokens",
        tokens(current),
        tokens(baseline),
        limits.warnIncrease.costPerCase,
      ),
    );
  }
  rows.push(
    increaseRow(
      "latencyP95",
      "ms",
      current.latencyMs.p95,
      baseline.latencyMs.p95,
      limits.warnIncrease.latencyP95,
    ),
  );
  return rows;
}

function joined(values: readonly string[]): string {
  return [...new Set(values)].sort().join("+");
}

function caseChange(current: CaseSummary, baseline: CaseSummary, judge: boolean): CaseChange | null {
  const lost: CaseCheck[] = [];
  const gained: CaseCheck[] = [];
  for (const check of CASE_CHECKS) {
    const now = current[check];
    const before = baseline[check];
    if (now === null || before === null) continue;
    if (before && !now) lost.push(check);
    if (!before && now) gained.push(check);
  }
  const keyPoints =
    current.keyPointCoverage < baseline.keyPointCoverage - EPSILON
      ? { current: current.keyPointCoverage, baseline: baseline.keyPointCoverage }
      : null;
  const judgeDrops: CaseChange["judge"] = [];
  if (judge && current.judge && baseline.judge) {
    for (const { key } of CRITERIA) {
      if (current.judge[key] <= baseline.judge[key] - 1)
        judgeDrops.push({ criterion: key, current: current.judge[key], baseline: baseline.judge[key] });
    }
  }
  if (lost.length === 0 && gained.length === 0 && keyPoints === null && judgeDrops.length === 0) return null;
  return { id: current.id, lost, gained, keyPoints, judge: judgeDrops };
}

export function baselineInfo(baseline: Baseline, file: string): BaselineInfo {
  return {
    file,
    date: baseline.date,
    provider: baseline.provider,
    model: baseline.model,
    judge: baseline.judge,
    judgeModel: baseline.judgeModel,
    subset: baseline.subset,
    fullRun: baseline.fullRun,
    versions: baseline.versions,
  };
}

export function compareWithBaseline(
  run: CurrentRun,
  baseline: Baseline | null,
  limits: RegressionLimits,
  file: string,
): Comparison {
  if (baseline === null) return { status: "no-baseline", file };
  if (run.mock || baseline.mock) return { status: "mock", file, reason: run.mock ? "run" : "baseline" };
  const info = baselineInfo(baseline, file);
  const byId = new Map(baseline.cases.map((value) => [value.id, value]));
  const current = run.cases.filter((value) => byId.has(value.id));
  const onlyCurrent = run.cases.filter((value) => !byId.has(value.id)).map((value) => value.id);
  if (current.length === 0) return { status: "no-common-cases", file, baseline: info };
  const before = current.map((value) => byId.get(value.id)).filter((value) => value !== undefined);

  const judge = run.judge && baseline.judge;
  const options = { judge, sameJudge: run.judge === baseline.judge };
  const overall = compareAggregates(aggregateSummaries(current), aggregateSummaries(before), limits, options);

  const templates: TemplateComparison[] = [...new Set(current.map((value) => value.template))]
    .sort()
    .map((key) => {
      const group = current.filter((value) => value.template === key);
      const baseGroup = group.map((value) => byId.get(value.id)).filter((value) => value !== undefined);
      const promptVersion = joined(group.map((value) => value.promptVersion));
      const baselinePromptVersion = joined(baseGroup.map((value) => value.promptVersion));
      return {
        key,
        promptVersion,
        baselinePromptVersion,
        promptChanged: promptVersion !== baselinePromptVersion,
        cases: group.length,
        rows: compareAggregates(aggregateSummaries(group), aggregateSummaries(baseGroup), limits, options),
      };
    });

  const regressions: Finding[] = overall
    .filter((row) => row.status === "regression")
    .map((row) => ({ scope: null, row }));
  const warnings: Finding[] = overall
    .filter((row) => row.status === "warning")
    .map((row) => ({ scope: null, row }));
  for (const template of templates) {
    for (const row of template.rows.filter((item) => item.status === "regression")) {
      (template.promptChanged ? regressions : warnings).push({ scope: template.key, row });
    }
  }

  const cases = current
    .map((value) => {
      const previous = byId.get(value.id);
      return previous ? caseChange(value, previous, judge) : null;
    })
    .filter((change) => change !== null);

  return {
    status: "compared",
    file,
    baseline: info,
    common: current.map((value) => value.id),
    onlyCurrent,
    versions: { current: run.versions, baseline: baseline.versions },
    judgeCompared: judge,
    overall,
    templates,
    cases,
    regressions,
    warnings,
  };
}

export function hasRegression(comparison: Comparison): boolean {
  return comparison.status === "compared" && comparison.regressions.length > 0;
}

function englishValue(unit: CompareRow["unit"], value: number | null): string {
  if (value === null) return "n/a";
  switch (unit) {
    case "rate":
      return `${(value * 100).toFixed(1)} %`;
    case "score":
      return value.toFixed(2);
    case "usd":
      return `$${value.toFixed(4)}`;
    case "tokens":
      return String(Math.round(value));
    case "ms":
      return `${Math.round(value)} ms`;
  }
}

function englishChange(row: CompareRow): string {
  if (row.change === null) return "n/a";
  const sign = row.change > 0 ? "+" : "";
  if (row.rule === "increase") return `${sign}${(row.change * 100).toFixed(0)} %`;
  return row.unit === "rate"
    ? `${sign}${(row.change * 100).toFixed(1)} pts`
    : `${sign}${row.change.toFixed(2)}`;
}

function englishLimit(row: CompareRow): string {
  if (row.rule === "increase") return `warn above +${(row.limit * 100).toFixed(0)} %`;
  return row.unit === "rate" ? `max -${(row.limit * 100).toFixed(1)} pts` : `max -${row.limit.toFixed(2)}`;
}

/** The comparison in English, for the console and the run summary. */
export function renderComparison(comparison: Comparison): string {
  switch (comparison.status) {
    case "off":
      return "No comparison (--compare not given).";
    case "no-baseline":
      return `No baseline yet at ${comparison.file}: only the absolute thresholds apply.`;
    case "mock":
      return comparison.reason === "run"
        ? "Mock run: not compared with the baseline (fixed text says nothing about quality)."
        : `${comparison.file} comes from a mock run: not compared.`;
    case "no-common-cases":
      return `${comparison.file} has none of the cases of this run: nothing to compare.`;
    case "compared": {
      const { baseline } = comparison;
      const width = Math.max(...comparison.overall.map((row) => row.metric.length));
      const lines = [
        `Compared with ${comparison.file} (${baseline.date}, ${baseline.provider} ${baseline.model}, judge ${
          baseline.judge ? (baseline.judgeModel ?? "on") : "off"
        }) on ${comparison.common.length} common case(s).`,
        ...comparison.overall.map(
          (row) =>
            `${row.metric.padEnd(width)}  ${englishValue(row.unit, row.current).padStart(9)}  was ${englishValue(
              row.unit,
              row.baseline,
            ).padStart(
              9,
            )}  ${englishChange(row).padStart(10)}  ${englishLimit(row).padEnd(22)}  ${row.status}`,
        ),
      ];
      if (comparison.onlyCurrent.length > 0)
        lines.push(`Not in the baseline, left out: ${comparison.onlyCurrent.join(", ")}`);
      if (!comparison.judgeCompared) lines.push("Judge not compared: one of the runs had no judge.");
      for (const template of comparison.templates.filter((item) => item.promptChanged))
        lines.push(
          `Template ${template.key}: prompt ${template.baselinePromptVersion} -> ${template.promptVersion}`,
        );
      const finding = (item: Finding) =>
        `${item.scope ? `${item.scope}: ` : ""}${item.row.metric} ${englishChange(item.row)}`;
      lines.push(
        `Regressions: ${comparison.regressions.length === 0 ? "none" : comparison.regressions.map(finding).join(", ")}`,
      );
      if (comparison.warnings.length > 0)
        lines.push(`Warnings: ${comparison.warnings.map(finding).join(", ")}`);
      return lines.join("\n");
    }
  }
}
