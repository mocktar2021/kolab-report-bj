import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { humanKey, humanMeans, type HumanScore } from "../human/agreement";
import type { BudgetSummary } from "./budget";
import { renderComparison, type Comparison } from "./compare";
import { CRITERIA, type Criterion } from "./criteria";
import { renderGate, type GateResult } from "./gate";
import type { CaseResult } from "./runner";
import { aggregateSummaries, judged, summarizeCase, type Aggregates } from "./summary";

// Aggregates and report files. One JSON and one Markdown file per template
// and model (the template's prompt version is in the name), plus a run
// summary with the gate.

export const REPORTS_DIR = "evals/reports";

export type { Aggregates } from "./summary";
export { percentile } from "./summary";

export type Calibration = Record<Criterion, { cases: number; meanAbsoluteDifference: number | null }>;

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function aggregate(results: readonly CaseResult[]): Aggregates {
  return aggregateSummaries(results.map(summarizeCase));
}

/** Judge against human means on the same case, prompt version and model. */
export function calibration(results: readonly CaseResult[], humans: readonly HumanScore[]): Calibration {
  const means = humanMeans(humans);
  const differences = Object.fromEntries(CRITERIA.map(({ key }) => [key, [] as number[]])) as Record<
    Criterion,
    number[]
  >;
  for (const result of results) {
    const scores = judged(result)?.scores;
    const human = means.get(humanKey(result.id, result.promptVersion, result.model));
    if (!scores || !human) continue;
    for (const { key } of CRITERIA) {
      const humanScore = human[key];
      if (humanScore !== undefined) differences[key].push(Math.abs(scores[key] - humanScore));
    }
  }
  return Object.fromEntries(
    CRITERIA.map(({ key }) => [
      key,
      { cases: differences[key].length, meanAbsoluteDifference: mean(differences[key]) },
    ]),
  ) as Calibration;
}

export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "") || "model"
  );
}

export type RunInfo = {
  date: string;
  startedAt: string;
  mock: boolean;
  judge: boolean;
  /** Every case of the golden set was selected, with the shipped templates. */
  fullRun: boolean;
  /** Name from evals/subsets.json (--subset), or null. */
  subset: string | null;
  provider: string;
  model: string;
  judgeModel: string | null;
  /** The calls went through the provider's Batch API (KRB-229): half price, latency not measured. */
  batch: boolean;
  settings: { maxInputTokens: number; contextWindowTokens: number; redactPii: boolean };
};

const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)} %`);
const num = (value: number | null, digits = 2) => (value === null ? "n/a" : value.toFixed(digits));
const yes = (value: boolean | null) => (value === null ? "" : value ? "ok" : "FAIL");

function aggregateLines(agg: Aggregates): string[] {
  const lines = [
    "| Metric | Value |",
    "| --- | --- |",
    `| Cases | ${agg.cases} |`,
    `| Schema valid, first try | ${pct(agg.schemaValidFirstTry)} |`,
    `| Schema valid after repair | ${pct(agg.schemaValidAfterRepair)} |`,
    `| Citations valid | ${pct(agg.citationValidRate)} |`,
    `| mustCite coverage | ${pct(agg.mustCiteRate)} |`,
    `| Length within bounds | ${pct(agg.lengthOkRate)} |`,
    `| Key point coverage (mean) | ${pct(agg.keyPointCoverage)} |`,
    `| No forbidden string | ${pct(agg.forbiddenAbsentRate)} |`,
    `| No long dash or stock phrase | ${pct(agg.plainStyleRate)} |`,
    `| Safe output | ${pct(agg.safeOutputRate)} |`,
    `| French | ${pct(agg.frenchRate)} |`,
    `| Injection resisted | ${pct(agg.injectionResistedRate)} |`,
    `| Long cases read whole | ${pct(agg.longCasesTruncatedRate)} |`,
    `| Latency p50 / p95 | ${agg.latencyMs.p50 ?? "n/a"} ms / ${agg.latencyMs.p95 ?? "n/a"} ms |`,
    `| Tokens in / out | ${agg.tokens.input} / ${agg.tokens.output} |`,
    `| Cost | ${agg.costUsd === null ? "n/a (no price set)" : `$${agg.costUsd.toFixed(4)}`} |`,
  ];
  if (agg.judge) {
    for (const { key, label } of CRITERIA) lines.push(`| Judge: ${label} | ${num(agg.judge[key])} |`);
  }
  return lines;
}

function caseLines(results: readonly CaseResult[]): string[] {
  const lines = [
    "| Case | Category | Schema | Citations | Length | Key points | Forbidden | Safe | Injection | Truncated |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const result of results) {
    const checks = result.checks;
    const schema = result.generation.schemaValidFirstTry
      ? "ok"
      : result.generation.schemaValidAfterRepair
        ? "repaired"
        : "FAIL";
    lines.push(
      `| ${result.id} | ${result.category} | ${schema} | ${checks ? yes(checks.citationValid) : "FAIL"} | ${
        checks ? `${checks.words} words ${yes(checks.lengthOk)}` : ""
      } | ${checks ? pct(checks.keyPointCoverage) : ""} | ${
        result.forbiddenFound.length === 0 ? "ok" : `FAIL: ${result.forbiddenFound.join(", ")}`
      } | ${yes(result.safeOutput)} | ${yes(result.injectionResisted)} | ${yes(result.truncationOk)} |`,
    );
  }
  return lines;
}

/** A judge score this low pulls a criterion's mean under its floor (3.50, or 4.00 for fidelity). */
const LOW_JUDGE_SCORE = 3;

export type LowJudgeScore = { key: Criterion; label: string; score: number; justification: string };

/**
 * The criteria a case scored 3 or less, with the judge's reason. Before
 * KRB-224 the reasons were dropped, so a failed night said which mean was low
 * but not why.
 */
export function lowJudgeScores(result: Pick<CaseResult, "judge">): LowJudgeScore[] {
  const judge = result.judge;
  if (!judge || "error" in judge) return [];
  return CRITERIA.filter(({ key }) => judge.scores[key] <= LOW_JUDGE_SCORE).map(({ key, label }) => ({
    key,
    label,
    score: judge.scores[key],
    justification: judge.justifications[key],
  }));
}

function judgeReasonLines(results: readonly CaseResult[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    for (const low of lowJudgeScores(result)) {
      lines.push(`- ${result.id}, ${low.label} ${low.score}/5: ${low.justification}`);
    }
  }
  return lines;
}

function problemLines(results: readonly CaseResult[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    const notes: string[] = [];
    if (result.generation.error) notes.push(`generation error: ${result.generation.error}`);
    const checks = result.checks;
    if (checks) {
      const missed = checks.keyPoints.filter((point) => !point.covered).map((point) => point.id);
      if (missed.length > 0) notes.push(`key points missed: ${missed.join(", ")}`);
      if (checks.invalidRefs.length > 0) notes.push(`invalid refs: ${checks.invalidRefs.join(", ")}`);
      if (checks.missingCites.length > 0) notes.push(`not cited: ${checks.missingCites.join(", ")}`);
      if (checks.unsafe.length > 0) notes.push(`unsafe: ${checks.unsafe.join(" ").slice(0, 200)}`);
      if (!checks.french) notes.push(`French share ${checks.language.frenchShare.toFixed(2)}`);
    }
    if (result.promptLeak) notes.push(`prompt leak: "${result.promptLeak}"`);
    if (result.judge && "error" in result.judge) notes.push(`judge error: ${result.judge.error}`);
    if (notes.length > 0) lines.push(`- ${result.id}: ${notes.join("; ")}`);
  }
  return lines;
}

function calibrationLines(cal: Calibration): string[] {
  if (CRITERIA.every(({ key }) => cal[key].cases === 0)) {
    return ["No human scores for this prompt version and model yet (evals/human/*.csv)."];
  }
  return [
    "| Criterion | Cases | Judge vs human, mean absolute difference |",
    "| --- | --- | --- |",
    ...CRITERIA.map(
      ({ key, label }) => `| ${label} | ${cal[key].cases} | ${num(cal[key].meanAbsoluteDifference)} |`,
    ),
  ];
}

export type TemplateReport = {
  kind: "template";
  run: RunInfo;
  template: {
    key: string;
    title: string;
    promptVersion: string;
    source: string;
    outputSchema: string;
    tier: string;
  };
  aggregates: Aggregates;
  calibration: Calibration;
  cases: CaseResult[];
};

export type RunReport = {
  kind: "run";
  run: RunInfo;
  aggregates: Aggregates;
  gate: GateResult;
  releaseReady: boolean;
  /** Spend and cap. Optional so reports written before KRB-106 still read. */
  budget?: BudgetSummary;
  comparison?: Comparison;
  reports: string[];
};

function budgetLine(budget: BudgetSummary): string {
  const caps = [
    budget.limits.usd !== null
      ? `$${budget.limits.usd}${budget.priced ? "" : " (not checked: no price set)"}`
      : null,
    budget.limits.tokens !== null ? `${budget.limits.tokens} tokens` : null,
  ].filter(Boolean);
  const spent = `${budget.spent.usd === null ? "n/a" : `$${budget.spent.usd.toFixed(4)}`} and ${budget.spent.tokens} tokens`;
  return `Budget: ${caps.length > 0 ? caps.join(", ") : "none"}. Estimated spend, judge included: ${spent}.`;
}

export function templateMarkdown(report: TemplateReport): string {
  const { run, template } = report;
  return [
    `# Eval report: ${template.key} (${template.promptVersion}), ${run.model}`,
    "",
    `Run of ${run.startedAt}${run.mock ? ", mock model" : ""}. Template "${template.title}" from ${template.source}, output schema ${template.outputSchema}, tier ${template.tier}. Judge: ${run.judgeModel ?? "off"}.`,
    "",
    "## Aggregates",
    "",
    ...aggregateLines(report.aggregates),
    "",
    "## Cases",
    "",
    ...caseLines(report.cases),
    "",
    "## Problems",
    "",
    ...(problemLines(report.cases).length > 0 ? problemLines(report.cases) : ["None."]),
    "",
    "## Low judge scores",
    "",
    ...(judgeReasonLines(report.cases).length > 0
      ? judgeReasonLines(report.cases)
      : [report.run.judgeModel ? "No criterion at 3 or less." : "Judge off."]),
    "",
    "## Judge calibration",
    "",
    ...calibrationLines(report.calibration),
    "",
  ].join("\n");
}

export function runMarkdown(report: RunReport): string {
  const { run } = report;
  const notes: string[] = [];
  if (run.mock) notes.push("Mock model: quality thresholds are reported, not enforced.");
  if (!run.fullRun)
    notes.push(
      `Subset of the golden set (${run.subset ? `--subset ${run.subset}` : "--cases, --subset or --prompt-file"}): not valid for a release.`,
    );
  if (!report.gate.complete)
    notes.push(
      `Incomplete: the budget kept ${report.gate.skippedCases.length} case(s) from starting. Not valid for a release.`,
    );
  if (!run.judge) notes.push("Judge off: judge thresholds skipped.");
  return [
    `# Eval run ${run.date}, ${run.model}`,
    "",
    `Provider ${run.provider}, model ${run.model}, judge ${run.judgeModel ?? "off"}, input budget ${run.settings.maxInputTokens} tokens, PII redaction ${run.settings.redactPii ? "on" : "off"}${run.batch ? ", Batch API (half price, latency not measured)" : ""}.`,
    "",
    ...(notes.length > 0 ? [...notes.map((note) => `- ${note}`), ""] : []),
    "## Gate",
    "",
    "```",
    renderGate(report.gate),
    "```",
    "",
    `Release ready: ${report.releaseReady ? "yes" : "no"} (needs a passing gate on the full set, every case run, real model, judge on).`,
    "",
    ...(report.budget ? [budgetLine(report.budget), ""] : []),
    ...(report.comparison && report.comparison.status !== "off"
      ? ["## Comparison with the baseline", "", "```", renderComparison(report.comparison), "```", ""]
      : []),
    "## All cases",
    "",
    ...aggregateLines(report.aggregates),
    "",
    "## Reports",
    "",
    ...report.reports.map((name) => `- ${name}`),
    "",
  ].join("\n");
}

/** Writes the per-template reports and the run summary, and returns the file names. */
export function writeReports(
  outDir: string,
  templates: TemplateReport[],
  run: Omit<RunReport, "reports">,
): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  const model = slug(run.run.model);
  for (const report of templates) {
    const base = `${run.run.date}-${report.template.key}-${report.template.promptVersion}-${model}`;
    writeFileSync(join(outDir, `${base}.json`), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(outDir, `${base}.md`), templateMarkdown(report));
    written.push(`${base}.json`, `${base}.md`);
  }
  const base = `${run.run.date}-run-${model}`;
  const summary: RunReport = { ...run, reports: [...written] };
  writeFileSync(join(outDir, `${base}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(outDir, `${base}.md`), runMarkdown(summary));
  written.push(`${base}.json`, `${base}.md`);
  return written;
}
