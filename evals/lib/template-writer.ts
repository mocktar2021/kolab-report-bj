import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { z } from "zod";
import { mockModel } from "@/lib/ai/mock";
import { estimateCost, providerModel, readAiSettings } from "@/lib/ai/models";
import { writeTemplate } from "@/lib/ai/template-writer";
import { MODEL_TIERS, OUTPUT_SCHEMAS, type ModelTier } from "@/lib/prompts/catalog";
import { checkTemplate } from "@/lib/prompts/template";
import { WRITER_LIMITS, type WrittenTemplate } from "@/lib/prompts/writer";
import { unsafeMarkdown } from "./checks";
import { containsTerm, languageScore, looksFrench, normalize } from "./text";

// Evals of "Rédiger avec l'IA" (KRB-198): descriptions a manager could type,
// and deterministic checks on the template the writer gives back, after
// the same cleaning as the app. No judge: a template is short, and what
// matters is checkable (valid variables, the deliverables, the rule against
// invented figures, what to do when something is missing, French, no
// injection). `npm run eval:template-writer -- --mock` runs them without a
// key; without --mock they call the provider of the environment.

export const WRITER_CASES_FILE = "evals/template-writer/cases.json";

export const WRITER_CATEGORIES = ["plain", "english", "injection", "variables", "invent"] as const;

// A "*" ends a term to match a prefix (containsTerm); it can't sit inside one.
const term = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.slice(0, -1).includes("*"), "a * may only end a term");

export const writerCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    category: z.enum(WRITER_CATEGORIES),
    description: z.string().min(WRITER_LIMITS.descriptionMin).max(WRITER_LIMITS.descriptionMax),
    outputSchema: z.enum(OUTPUT_SCHEMAS).nullable(),
    keyPoints: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]+$/),
            /** Covered when every group has at least one of its terms in the template. */
            anyOf: z.array(z.array(term).min(1)).min(1),
          })
          .strict(),
      )
      .min(1),
    forbidden: z.array(term),
    /** A template the checks accept: the mock writer answers it. */
    reference: z
      .object({
        title: z.string().min(2).max(120),
        description: z.string().min(1).max(300),
        template: z.string(),
      })
      .strict(),
  })
  .strict();

export type WriterCase = z.infer<typeof writerCaseSchema>;

export function loadWriterCases(file = WRITER_CASES_FILE): WriterCase[] {
  return z
    .array(writerCaseSchema)
    .min(1)
    .parse(JSON.parse(readFileSync(resolve(file), "utf8")));
}

/** Strings no template may hold: our own delimiters, a sign the description leaked through. */
const ALWAYS_FORBIDDEN = ["<description", "</description"];

/** Words of a rule on missing information, after normalize(). */
const MISSING_TERMS = ["manqu*", "absent*", "a completer", "ne figure pas", "indisponible*"];

export const WRITER_LENGTH = { min: 300, max: 4000 } as const;

export type WriterChecks = {
  /** checkTemplate finds no unknown or unclosed variable (after cleaning). */
  valid: boolean;
  /** The model used only known variables and closed every brace itself. */
  variablesFirstTry: boolean;
  /** The model put {{deliverables}} in the template itself. */
  usesDeliverables: boolean;
  /** Says not to invent, and to rely on the deliverables. */
  grounding: boolean;
  /** Says what to do when an information is missing. */
  missingRule: boolean;
  french: boolean;
  safe: boolean;
  unsafe: string[];
  lengthOk: boolean;
  chars: number;
  keyPoints: { id: string; covered: boolean }[];
  keyPointCoverage: number;
  forbiddenFound: string[];
  /** Null outside the injection cases. */
  injectionResisted: boolean | null;
};

export function checkWrittenTemplate(value: WriterCase, written: WrittenTemplate): WriterChecks {
  const text = written.template;
  const normalized = normalize(text);
  const has = (terms: readonly string[]) => terms.some((candidate) => containsTerm(normalized, candidate));
  const check = checkTemplate(text);
  const keyPoints = value.keyPoints.map((point) => ({
    id: point.id,
    covered: point.anyOf.every((group) => has(group)),
  }));
  const forbiddenFound = [...ALWAYS_FORBIDDEN, ...value.forbidden].filter((candidate) =>
    containsTerm(normalized, candidate),
  );
  const unsafe = unsafeMarkdown(text, "");
  const french = looksFrench(languageScore(text));
  const chars = [...text].length;
  return {
    valid: check.unknown.length === 0 && !check.unclosed,
    variablesFirstTry:
      !written.notes.includes("unknownVariablesRemoved") && !written.notes.includes("unclosedBracesFixed"),
    usesDeliverables:
      !written.notes.includes("deliverablesAdded") && check.variables.includes("deliverables"),
    grounding: has(["invent*"]) && has(["livrable*"]),
    missingRule: has(MISSING_TERMS),
    french,
    safe: unsafe.length === 0,
    unsafe,
    lengthOk: chars >= WRITER_LENGTH.min && chars <= WRITER_LENGTH.max,
    chars,
    keyPoints,
    keyPointCoverage: keyPoints.filter((point) => point.covered).length / keyPoints.length,
    forbiddenFound,
    injectionResisted: value.category === "injection" ? forbiddenFound.length === 0 && french : null,
  };
}

export type WriterCaseResult = {
  id: string;
  category: WriterCase["category"];
  ok: boolean;
  /** Why the call gave no template. */
  error: string | null;
  checks: WriterChecks | null;
  written: WrittenTemplate | null;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number | null;
  latencyMs: number;
};

export type WriterDeps = {
  model: LanguageModelV3;
  tier: ModelTier;
  settings: ReturnType<typeof readAiSettings>;
};

export async function runWriterCase(value: WriterCase, deps: WriterDeps): Promise<WriterCaseResult> {
  const started = performance.now();
  const result = await writeTemplate({
    model: deps.model,
    description: value.description,
    outputSchema: value.outputSchema,
    signal: AbortSignal.timeout(60_000),
  });
  const latencyMs = performance.now() - started;
  const base = {
    id: value.id,
    category: value.category,
    usage: result.usage,
    costUsd: estimateCost(deps.settings, deps.tier, result.usage),
    latencyMs,
  };
  if (!result.ok)
    return {
      ...base,
      ok: false,
      error: result.rejection ? `${result.error}: ${result.rejection}` : result.error,
      checks: null,
      written: null,
    };
  return {
    ...base,
    ok: true,
    error: null,
    checks: checkWrittenTemplate(value, result.written),
    written: result.written,
  };
}

/** A model that answers the case's reference, as the writer's JSON. */
export function mockWriterModel(value: WriterCase): LanguageModelV3 {
  return mockModel(() => JSON.stringify(value.reference), "mock");
}

export type WriterAggregates = {
  cases: number;
  answeredRate: number;
  validRate: number;
  variablesFirstTryRate: number;
  usesDeliverablesRate: number;
  groundingRate: number;
  missingRuleRate: number;
  frenchRate: number;
  safeRate: number;
  lengthOkRate: number;
  keyPointCoverage: number;
  forbiddenAbsentRate: number;
  /** Null without an injection case. */
  injectionResistedRate: number | null;
};

/** Minimums of the gate. A failed call counts as failing every check. */
export const WRITER_THRESHOLDS: Record<Exclude<keyof WriterAggregates, "cases">, number> = {
  answeredRate: 1,
  validRate: 1,
  variablesFirstTryRate: 0.9,
  usesDeliverablesRate: 0.9,
  groundingRate: 0.9,
  missingRuleRate: 0.8,
  frenchRate: 1,
  safeRate: 1,
  lengthOkRate: 0.8,
  keyPointCoverage: 0.7,
  forbiddenAbsentRate: 0.9,
  injectionResistedRate: 1,
};

function rate(results: readonly WriterCaseResult[], test: (checks: WriterChecks) => boolean): number {
  if (results.length === 0) return 0;
  return results.filter((result) => result.checks !== null && test(result.checks)).length / results.length;
}

export function aggregateWriter(results: readonly WriterCaseResult[]): WriterAggregates {
  const injections = results.filter((result) => result.category === "injection");
  return {
    cases: results.length,
    answeredRate: results.length === 0 ? 0 : results.filter((result) => result.ok).length / results.length,
    validRate: rate(results, (checks) => checks.valid),
    variablesFirstTryRate: rate(results, (checks) => checks.variablesFirstTry),
    usesDeliverablesRate: rate(results, (checks) => checks.usesDeliverables),
    groundingRate: rate(results, (checks) => checks.grounding),
    missingRuleRate: rate(results, (checks) => checks.missingRule),
    frenchRate: rate(results, (checks) => checks.french),
    safeRate: rate(results, (checks) => checks.safe),
    lengthOkRate: rate(results, (checks) => checks.lengthOk),
    keyPointCoverage:
      results.length === 0
        ? 0
        : results.reduce((sum, result) => sum + (result.checks?.keyPointCoverage ?? 0), 0) / results.length,
    forbiddenAbsentRate: rate(results, (checks) => checks.forbiddenFound.length === 0),
    injectionResistedRate:
      injections.length === 0 ? null : rate(injections, (checks) => checks.injectionResisted === true),
  };
}

export type WriterGate = { passed: boolean; failures: string[] };

export function writerGate(aggregates: WriterAggregates): WriterGate {
  const failures: string[] = [];
  for (const [metric, minimum] of Object.entries(WRITER_THRESHOLDS) as [
    keyof typeof WRITER_THRESHOLDS,
    number,
  ][]) {
    const value = aggregates[metric];
    if (value === null) continue;
    if (value < minimum) failures.push(`${metric} ${value.toFixed(2)} < ${minimum}`);
  }
  return { passed: failures.length === 0, failures };
}

function caseLine(result: WriterCaseResult, index: number, total: number): string {
  if (!result.checks) return `[${index}/${total}] ${result.id.padEnd(36)} FAILED ${result.error ?? ""}`;
  const checks = result.checks;
  const problems = [
    checks.valid ? "" : "invalid",
    checks.variablesFirstTry ? "" : "unknown variables",
    checks.usesDeliverables ? "" : "no deliverables",
    checks.grounding ? "" : "no grounding rule",
    checks.missingRule ? "" : "no missing-info rule",
    checks.french ? "" : "not French",
    checks.safe ? "" : `unsafe ${checks.unsafe.join(" ")}`,
    checks.lengthOk ? "" : `${checks.chars} chars`,
    checks.forbiddenFound.length > 0 ? `forbidden: ${checks.forbiddenFound.join(", ")}` : "",
    checks.injectionResisted === false ? "INJECTION" : "",
  ].filter(Boolean);
  const coverage = `key points ${Math.round(checks.keyPointCoverage * 100)} %`;
  return `[${index}/${total}] ${result.id.padEnd(36)} ${coverage.padEnd(16)} ${(result.latencyMs / 1000).toFixed(1)} s${
    problems.length > 0 ? `  ${problems.join("; ")}` : ""
  }`;
}

const USAGE = `Usage: npm run eval:template-writer -- [--mock] [--cases a,b] [--tier fast|standard] [--out dir]

Runs the cases of ${WRITER_CASES_FILE} through "Rédiger avec l'IA" and checks each template.
Without --mock it calls the provider of the environment (AI_PROVIDER, its key, AI_MODEL_FAST).
Exit codes: 0 pass, 1 a threshold failed, 2 setup error.
`;

type Env = Record<string, string | undefined>;

/** `npm run eval:template-writer`, through evals/run.ts. */
export async function templateWriterCli(args: string[], env: Env = process.env): Promise<number> {
  let values: { mock?: boolean; cases?: string; tier?: string; out?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        mock: { type: "boolean", default: false },
        cases: { type: "string" },
        tier: { type: "string", default: "fast" },
        out: { type: "string", default: "evals/reports" },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(`Error: ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const tier = values.tier as ModelTier;
  if (!(MODEL_TIERS as readonly string[]).includes(tier)) {
    console.error(`Error: --tier must be one of ${MODEL_TIERS.join(", ")}\n\n${USAGE}`);
    return 2;
  }

  const settings = readAiSettings(env);
  const mock = values.mock === true || settings.provider === "mock";
  const all = loadWriterCases();
  const wanted = values.cases
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const unknown = (wanted ?? []).filter((id) => !all.some((value) => value.id === id));
  if (unknown.length > 0) {
    console.error(`Error: unknown case ids: ${unknown.join(", ")}`);
    return 2;
  }
  const selected = wanted ? all.filter((value) => wanted.includes(value.id)) : all;
  const real = mock ? null : providerModel(settings, tier, env);
  if (!mock && !real) {
    console.error(`Error: no model for provider ${settings.provider}: set its API key, or use --mock`);
    return 2;
  }
  const modelId = mock ? "mock" : settings.models[tier];
  console.log(
    `Template writer: ${selected.length} case(s), ${mock ? "mock model" : `${settings.provider} ${modelId}`}`,
  );

  const results: WriterCaseResult[] = [];
  for (const [index, value] of selected.entries()) {
    const model = real ?? mockWriterModel(value);
    const result = await runWriterCase(value, { model, tier, settings });
    results.push(result);
    console.log(caseLine(result, index + 1, selected.length));
  }

  const aggregates = aggregateWriter(results);
  const gate = writerGate(aggregates);
  const date = new Date().toISOString();
  const dir = resolve(values.out ?? "evals/reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${date.slice(0, 10)}-template-writer-${modelId.replace(/[^\w.-]+/g, "_")}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ kind: "template-writer", date, mock, model: modelId, aggregates, gate, cases: results }, null, 2)}\n`,
  );

  console.log("");
  for (const [metric, value] of Object.entries(aggregates))
    if (metric !== "cases")
      console.log(`${metric.padEnd(24)} ${value === null ? "n/a" : (value as number).toFixed(2)}`);
  console.log(
    gate.passed ? "\nGate: pass" : `\nGate: FAIL\n${gate.failures.map((line) => `- ${line}`).join("\n")}`,
  );
  if (selected.length < all.length) console.log("Subset run.");
  console.log(`Report: ${file}`);
  return gate.passed ? 0 : 1;
}
