import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { LanguageModelV1 } from "ai";
import { providerModel, readAiSettings, type AiSettings } from "@/lib/ai/models";
import { MODEL_TIERS, OUTPUT_SCHEMAS, type ModelTier, type OutputSchema } from "@/lib/prompts/catalog";
import { agreementCli, loadHumanScores } from "./human/agreement";
import { CaseError, loadCases, type LoadedCase } from "./lib/case";
import { applyGate, loadThresholds, renderGate } from "./lib/gate";
import { loadRubric } from "./lib/judge";
import { mockGenerator, mockJudge, mockSummarizer } from "./lib/mock";
import { aggregate, calibration, REPORTS_DIR, writeReports, type TemplateReport } from "./lib/report";
import { runCase, type CaseResult, type RunDeps } from "./lib/runner";
import { loadGlobalTemplates, templateFromFile, type EvalTemplate } from "./lib/templates";

// Entry of `npm run eval` (bundled to build/evals.mjs by scripts/build-evals.mjs).
// Runs the golden set, writes the reports and exits 1 when the gate fails.
// `npm run eval:agreement` runs the inter-rater agreement instead. See evals/README.md.

const USAGE = `Usage: npm run eval -- [options]
       npm run eval:agreement -- [scores.csv ...]

Options:
  --mock                 Use the mock model (no API key, no network)
  --tier standard|fast   Model tier for every case (default: each template's model_tier)
  --cases a,b            Run only these case ids
  --judge                Score each draft with the LLM judge (AI_EVAL_JUDGE_MODEL, or AI_MODEL)
  --prompt-file path     Evaluate this template text instead of the shipped one...
  --prompt-schema key    ...for the templates with this output schema (${OUTPUT_SCHEMAS.join(", ")})
  --out dir              Report folder (default ${REPORTS_DIR})
  --concurrency n        Cases run at the same time (default 3)
`;

/** Bad command line: the usage is printed. */
class UsageError extends Error {}

/** Missing key or nothing to run: only the message is printed. */
class SetupError extends Error {}

type Options = {
  mock: boolean;
  tier: ModelTier | null;
  cases: string[] | null;
  judge: boolean;
  promptFile: string | null;
  promptSchema: OutputSchema | null;
  out: string;
  concurrency: number;
};

function parseOptions(args: string[]): Options {
  const { values } = parseArgs({
    args,
    options: {
      mock: { type: "boolean", default: false },
      tier: { type: "string" },
      cases: { type: "string" },
      judge: { type: "boolean", default: false },
      "prompt-file": { type: "string" },
      "prompt-schema": { type: "string" },
      out: { type: "string", default: REPORTS_DIR },
      concurrency: { type: "string", default: "3" },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) throw new UsageError("");
  const tier = values.tier ?? null;
  if (tier !== null && !(MODEL_TIERS as readonly string[]).includes(tier))
    throw new UsageError(`--tier must be one of ${MODEL_TIERS.join(", ")}`);
  const schema = values["prompt-schema"] ?? null;
  if (schema !== null && !(OUTPUT_SCHEMAS as readonly string[]).includes(schema))
    throw new UsageError(`--prompt-schema must be one of ${OUTPUT_SCHEMAS.join(", ")}`);
  const promptFile = values["prompt-file"] ?? null;
  if ((promptFile === null) !== (schema === null))
    throw new UsageError("--prompt-file and --prompt-schema go together");
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new UsageError("--concurrency must be a positive integer");
  const cases = values.cases
    ? values.cases
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : null;
  return {
    mock: values.mock ?? false,
    tier: tier as ModelTier | null,
    cases,
    judge: values.judge ?? false,
    promptFile,
    promptSchema: schema as OutputSchema | null,
    out: values.out ?? REPORTS_DIR,
    concurrency,
  };
}

/** The template each case runs with: the shipped one, or the --prompt-file text for its output schema. */
function templatesFor(options: Options): Map<string, EvalTemplate> {
  const templates = loadGlobalTemplates();
  if (options.promptFile === null || options.promptSchema === null) return templates;
  const text = readFileSync(options.promptFile, "utf8");
  const replaced = new Map<string, EvalTemplate>();
  for (const [key, template] of templates) {
    if (template.outputSchema === options.promptSchema)
      replaced.set(key, templateFromFile(template, text, options.promptFile));
  }
  if (replaced.size === 0)
    throw new SetupError(`no global template has the output schema ${options.promptSchema}`);
  return replaced;
}

type Env = Record<string, string | undefined>;

function realModel(settings: AiSettings, tier: ModelTier, env: Env, modelId?: string): LanguageModelV1 {
  const chosen = modelId ? { ...settings, models: { ...settings.models, [tier]: modelId } } : settings;
  const model = providerModel(chosen, tier, env);
  if (!model)
    throw new SetupError(`no model for provider ${settings.provider}: set its API key, or use --mock`);
  return model;
}

function caseLine(result: CaseResult, index: number, total: number): string {
  const schema = result.generation.schemaValidFirstTry
    ? "schema ok"
    : result.generation.schemaValidAfterRepair
      ? "schema repaired"
      : "schema FAIL";
  const coverage = result.checks
    ? `key points ${Math.round(result.checks.keyPointCoverage * 100)} %`
    : "no output";
  const extra = [
    result.injectionResisted === false ? "INJECTION" : "",
    result.forbiddenFound.length > 0 ? "forbidden" : "",
    result.truncationOk === false ? "NOT TRUNCATED" : "",
  ].filter(Boolean);
  return `[${index}/${total}] ${result.id.padEnd(42)} ${schema.padEnd(16)} ${coverage.padEnd(16)} ${(
    result.generation.latencyMs / 1000
  ).toFixed(1)} s${extra.length > 0 ? `  ${extra.join(" ")}` : ""}`;
}

async function evaluate(args: string[], env: Env): Promise<number> {
  const options = parseOptions(args);
  const settings = readAiSettings(env);
  const mock = options.mock || settings.provider === "mock";
  const templates = templatesFor(options);
  const thresholds = loadThresholds();

  const all = loadCases();
  const known = new Set(all.map((value) => value.id));
  const unknown = (options.cases ?? []).filter((id) => !known.has(id));
  if (unknown.length > 0) throw new UsageError(`unknown case ids: ${unknown.join(", ")}`);
  const selected = all.filter(
    (value) => (options.cases === null || options.cases.includes(value.id)) && templates.has(value.template),
  );
  if (selected.length === 0) throw new SetupError("no case to run");
  const fullRun = selected.length === all.length;

  const judgeModelId = env.AI_EVAL_JUDGE_MODEL?.trim() || null;
  const judgeModel = !options.judge
    ? null
    : mock
      ? mockJudge()
      : realModel(settings, "standard", env, judgeModelId ?? undefined);
  const judge = judgeModel ? { model: judgeModel, rubric: loadRubric() } : null;
  const summarizer = mock ? mockSummarizer() : realModel(settings, "fast", env);

  const depsFor = (value: LoadedCase): RunDeps => {
    const template = templates.get(value.template);
    if (!template) throw new Error(`no template ${value.template}`);
    const tier = options.tier ?? template.tier;
    return {
      settings,
      template,
      tier,
      modelId: mock ? "mock" : settings.models[tier],
      generator: mock ? mockGenerator : () => realModel(settings, tier, env),
      summarizer,
      judge,
    };
  };

  const models = [...new Set(selected.map((value) => depsFor(value).modelId))];
  console.log(
    `Golden set: ${selected.length} case(s), ${mock ? "mock model" : `${settings.provider} ${models.join(", ")}`}${
      judge ? `, judge ${mock ? "mock" : (judgeModelId ?? settings.models.standard)}` : ""
    }`,
  );

  const startedAt = new Date().toISOString();
  const results: CaseResult[] = new Array(selected.length);
  let done = 0;
  let next = 0;
  const workers = Array.from({ length: Math.min(options.concurrency, selected.length) }, async () => {
    while (next < selected.length) {
      const index = next++;
      const value = selected[index];
      if (!value) continue;
      const result = await runCase(value, depsFor(value));
      results[index] = result;
      console.log(caseLine(result, ++done, selected.length));
    }
  });
  await Promise.all(workers);

  const humans = loadHumanScores();
  for (const error of humans.errors) console.warn(`Human scores: ${error}`);
  const runInfo = {
    date: startedAt.slice(0, 10),
    startedAt,
    mock,
    judge: judge !== null,
    fullRun: fullRun && options.promptFile === null,
    provider: mock ? "mock" : settings.provider,
    model: models.join("+"),
    judgeModel: judge ? (mock ? "mock" : (judgeModelId ?? settings.models.standard)) : null,
    settings: {
      maxInputTokens: settings.maxInputTokens,
      contextWindowTokens: settings.contextWindowTokens,
      redactPii: settings.redactPii,
    },
  };

  const groups = new Map<string, CaseResult[]>();
  for (const result of results) {
    const key = `${result.template}|${result.promptVersion}|${result.model}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  const templateReports: TemplateReport[] = [...groups.values()].map((group) => {
    const first = group[0];
    const template = first ? templates.get(first.template) : undefined;
    if (!first || !template) throw new Error("empty report group");
    return {
      kind: "template",
      run: { ...runInfo, model: first.model },
      template: {
        key: template.key,
        title: template.title,
        promptVersion: template.version,
        source: template.source,
        outputSchema: template.outputSchema,
        tier: options.tier ?? template.tier,
      },
      aggregates: aggregate(group),
      calibration: calibration(group, humans.rows),
      cases: group,
    };
  });

  const aggregates = aggregate(results);
  const gate = applyGate(aggregates, thresholds, { mock });
  const releaseReady = gate.passed && runInfo.fullRun && !mock && judge !== null;
  const outDir = resolve(options.out);
  const written = writeReports(outDir, templateReports, {
    kind: "run",
    run: runInfo,
    aggregates,
    gate,
    releaseReady,
  });

  console.log("");
  console.log(renderGate(gate));
  if (mock) console.log("Mock model: quality thresholds are reported, not enforced.");
  if (!runInfo.fullRun) console.log("Subset run: not valid for a release.");
  console.log(`Reports in ${options.out}: ${written.filter((name) => name.endsWith(".md")).join(", ")}`);
  return gate.passed ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  // Same file the app reads in development. Variables already set win.
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const [command, ...rest] = argv;
  if (command === "agreement") return agreementCli(rest);
  try {
    return await evaluate(argv, process.env);
  } catch (error) {
    if (error instanceof SetupError || error instanceof CaseError) {
      console.error(`Error: ${error.message}`);
      return 2;
    }
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      if (error instanceof Error && error.message) console.error(`Error: ${error.message}\n`);
      console.error(USAGE);
      return error instanceof UsageError && !error.message ? 0 : 2;
    }
    throw error;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 2;
  },
);
