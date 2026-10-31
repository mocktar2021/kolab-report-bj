import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { CATEGORIES } from "./case";
import { CRITERION_KEYS, type Criterion } from "./criteria";
import { SetupError } from "./errors";
import type { RunInfo } from "./report";
import { aggregateSummaries, type Aggregates, type CaseSummary } from "./summary";

// A baseline is the summary of one run that later runs are compared with
// (--write-baseline, --compare). evals/baseline/production.json holds the
// run on the production model and prompt versions. It keeps the per-case
// numbers, so a run on a subset is compared on the cases both runs have.

export const BASELINE_KIND = "kolab-eval-baseline";
export const BASELINE_FORMAT = 1;
export const PRODUCTION_BASELINE = "evals/baseline/production.json";

export type Versions = { outputSchema: number; context: number };

export type TemplateBaseline = {
  promptVersion: string;
  model: string;
  cases: string[];
  aggregates: Aggregates;
};

export type Baseline = {
  kind: typeof BASELINE_KIND;
  format: typeof BASELINE_FORMAT;
  date: string;
  startedAt: string;
  provider: string;
  model: string;
  judge: boolean;
  judgeModel: string | null;
  mock: boolean;
  subset: string | null;
  /** Every case of the golden set, shipped templates. */
  fullRun: boolean;
  /** No case skipped by the budget. */
  complete: boolean;
  /** OUTPUT_SCHEMA_VERSION and CONTEXT_VERSION of the code that ran. */
  versions: Versions;
  settings: RunInfo["settings"];
  /** Prompt version, model and aggregates per template key. */
  templates: Record<string, TemplateBaseline>;
  aggregates: Aggregates;
  caseIds: string[];
  cases: CaseSummary[];
};

const ratio = z.number().min(0).max(1).nullable();
const criterionMap = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(CRITERION_KEYS.map((key) => [key, value])) as Record<Criterion, T>);

const aggregatesSchema = z.object({
  cases: z.number().int().nonnegative(),
  judgedCases: z.number().int().nonnegative(),
  schemaValidFirstTry: ratio,
  schemaValidAfterRepair: ratio,
  citationValidRate: ratio,
  injectionResistedRate: ratio,
  safeOutputRate: ratio,
  longCasesTruncatedRate: ratio,
  mustCiteRate: ratio,
  lengthOkRate: ratio,
  keyPointCoverage: ratio,
  forbiddenAbsentRate: ratio,
  plainStyleRate: ratio,
  frenchRate: ratio,
  judge: criterionMap(z.number().nullable()).nullable(),
  latencyMs: z.object({ p50: z.number().nullable(), p95: z.number().nullable() }),
  tokens: z.object({ input: z.number(), output: z.number(), total: z.number() }),
  costUsd: z.number().nullable(),
});

const caseSummarySchema = z.object({
  id: z.string().min(1),
  category: z.enum(CATEGORIES),
  template: z.string().min(1),
  promptVersion: z.string().min(1),
  model: z.string().min(1),
  schemaValidFirstTry: z.boolean(),
  schemaValidAfterRepair: z.boolean(),
  citationValid: z.boolean(),
  mustCiteCoverage: z.number().min(0).max(1),
  lengthOk: z.boolean(),
  keyPointCoverage: z.number().min(0).max(1),
  forbiddenAbsent: z.boolean(),
  plainStyle: z.boolean(),
  french: z.boolean(),
  safeOutput: z.boolean(),
  injectionResisted: z.boolean().nullable(),
  truncationOk: z.boolean().nullable(),
  judge: criterionMap(z.number().min(1).max(5)).nullable(),
  error: z.string().nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  tokens: z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() }),
  costUsd: z.number().nonnegative().nullable(),
});

export const baselineSchema = z.object({
  kind: z.literal(BASELINE_KIND),
  format: z.literal(BASELINE_FORMAT),
  date: z.string().min(1),
  startedAt: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  judge: z.boolean(),
  judgeModel: z.string().nullable(),
  mock: z.boolean(),
  subset: z.string().nullable(),
  fullRun: z.boolean(),
  complete: z.boolean(),
  versions: z.object({ outputSchema: z.number().int(), context: z.number().int() }),
  settings: z.object({
    maxInputTokens: z.number(),
    contextWindowTokens: z.number(),
    redactPii: z.boolean(),
  }),
  templates: z.record(
    z.string(),
    z.object({
      promptVersion: z.string().min(1),
      model: z.string().min(1),
      cases: z.array(z.string()),
      aggregates: aggregatesSchema,
    }),
  ),
  aggregates: aggregatesSchema,
  caseIds: z.array(z.string()),
  cases: z.array(caseSummarySchema).min(1),
});

export function buildBaseline(input: {
  run: RunInfo;
  complete: boolean;
  versions: Versions;
  cases: readonly CaseSummary[];
}): Baseline {
  const { run } = input;
  const templates: Record<string, TemplateBaseline> = {};
  const keys = [...new Set(input.cases.map((value) => value.template))].sort();
  for (const key of keys) {
    const group = input.cases.filter((value) => value.template === key);
    templates[key] = {
      promptVersion: [...new Set(group.map((value) => value.promptVersion))].join("+"),
      model: [...new Set(group.map((value) => value.model))].join("+"),
      cases: group.map((value) => value.id),
      aggregates: aggregateSummaries(group),
    };
  }
  return {
    kind: BASELINE_KIND,
    format: BASELINE_FORMAT,
    date: run.date,
    startedAt: run.startedAt,
    provider: run.provider,
    model: run.model,
    judge: run.judge,
    judgeModel: run.judgeModel,
    mock: run.mock,
    subset: run.subset,
    fullRun: run.fullRun,
    complete: input.complete,
    versions: { ...input.versions },
    settings: { ...run.settings },
    templates,
    aggregates: aggregateSummaries(input.cases),
    caseIds: input.cases.map((value) => value.id),
    cases: input.cases.map((value) => ({ ...value })),
  };
}

export function writeBaseline(file: string, baseline: Baseline): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
}

/** The baseline in `file`, or null when there is no such file yet. Throws a SetupError when it can't be read. */
export function readBaseline(file: string): Baseline | null {
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new SetupError(`${file}: not valid JSON (${(error as Error).message})`);
  }
  const parsed = baselineSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new SetupError(`${file}: not a baseline written by --write-baseline (${issues.join("; ")})`);
  }
  return parsed.data as Baseline;
}
