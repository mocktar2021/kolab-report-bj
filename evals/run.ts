import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { CONTEXT_VERSION } from "@/lib/ai/context";
import { providerModel, readAiSettings, type AiSettings } from "@/lib/ai/models";
import { OUTPUT_SCHEMA_VERSION } from "@/lib/ai/schemas";
import { MODEL_TIERS, OUTPUT_SCHEMAS, type ModelTier, type OutputSchema } from "@/lib/prompts/catalog";
import { agreementCli, loadHumanScores } from "./human/agreement";
import { buildBaseline, readBaseline, writeBaseline } from "./lib/baseline";
import { BatchQueue, batchPrices } from "./lib/batch";
import { Budget, hasPrices } from "./lib/budget";
import { CaseError, loadCases, type LoadedCase } from "./lib/case";
import { renderComment, renderErrorComment } from "./lib/comment";
import { compareWithBaseline, hasRegression, renderComparison, type Comparison } from "./lib/compare";
import { SetupError } from "./lib/errors";
import { executeCases } from "./lib/execute";
import { applyGate, loadThresholds, renderGate } from "./lib/gate";
import { loadRubric } from "./lib/judge";
import { mockGenerator, mockJudge, mockSummarizer } from "./lib/mock";
import {
  aggregate,
  calibration,
  lowJudgeScores,
  REPORTS_DIR,
  writeReports,
  type TemplateReport,
} from "./lib/report";
import type { CaseResult, RunDeps } from "./lib/runner";
import { loadSubsets, subsetIds } from "./lib/subsets";
import { summarizeCase } from "./lib/summary";
import { templateWriterCli } from "./lib/template-writer";
import { loadGlobalTemplates, templateFromFile, type EvalTemplate } from "./lib/templates";

// Entry of `npm run eval` (bundled to build/evals.mjs by scripts/build-evals.mjs).
// Runs the golden set, writes the reports and exits 1 when the gate fails or
// a metric drops past its limit against the baseline (--compare).
// `npm run eval:agreement` runs the inter-rater agreement instead, and
// `npm run eval:template-writer` the cases of "Rédiger avec l'IA" (KRB-198).
// See evals/README.md and docs/ai-evaluation.md.

/** How long a run waits on batches by default. Past it, a CI runner spends minutes for nothing. */
const BATCH_WAIT_MINUTES = 20;

const USAGE = `Usage: npm run eval -- [options]
       npm run eval:agreement -- [scores.csv ...]
       npm run eval:template-writer -- [--mock] [--cases a,b] [--tier fast|standard]

Options:
  --mock                 Use the mock model (no API key, no network)
  --tier standard|fast   Model tier for every case (default: each template's model_tier)
  --cases a,b            Run only these case ids
  --subset name          Run the cases of a named subset of evals/subsets.json (e.g. pr)
  --judge                Score each draft with the LLM judge (AI_EVAL_JUDGE_MODEL, or AI_MODEL)
  --prompt-file path     Evaluate this template text instead of the shipped one...
  --prompt-schema key    ...for the templates with this output schema (${OUTPUT_SCHEMAS.join(", ")})
  --out dir              Report folder (default ${REPORTS_DIR})
  --concurrency n        Cases run at the same time (default 3; with --batch, all of them)
  --batch                Send the calls through the Batch API: half price, slower (Anthropic only)
  --batch-wait-minutes n Stop waiting on batches n minutes after the start: the rest goes to
                         the standard API at full price (default ${BATCH_WAIT_MINUTES})
  --budget-usd n         Start no case once the estimated spend would pass n USD (needs AI_PRICE_*)
  --budget-tokens n      Same, in tokens
  --compare file         Compare with a baseline run file (missing file: absolute thresholds only)
  --write-baseline file  Write this run as a baseline file
  --comment file         Write a Markdown summary for the pull request comment, in French

Exit codes: 0 pass, 1 threshold failed or regression against the baseline, 2 setup error.
`;

/** Bad command line: the usage is printed. */
class UsageError extends Error {}

type Options = {
  mock: boolean;
  tier: ModelTier | null;
  cases: string[] | null;
  subset: string | null;
  judge: boolean;
  promptFile: string | null;
  promptSchema: OutputSchema | null;
  out: string;
  concurrency: number;
  batch: boolean;
  batchWaitMinutes: number;
  budgetUsd: number | null;
  budgetTokens: number | null;
  compare: string | null;
  writeBaseline: string | null;
  comment: string | null;
};

function positive(value: string | undefined, flag: string, integer: boolean): number | null {
  if (value === undefined) return null;
  const number = Number(value);
  if (
    value.trim() === "" ||
    !Number.isFinite(number) ||
    number <= 0 ||
    (integer && !Number.isInteger(number))
  )
    throw new UsageError(`${flag} must be a positive ${integer ? "integer" : "number"}`);
  return number;
}

function path(value: string | undefined, flag: string): string | null {
  if (value === undefined) return null;
  if (value.trim() === "") throw new UsageError(`${flag} needs a file path`);
  return value;
}

function parseOptions(args: string[]): Options {
  const { values } = parseArgs({
    args,
    options: {
      mock: { type: "boolean", default: false },
      tier: { type: "string" },
      cases: { type: "string" },
      subset: { type: "string" },
      judge: { type: "boolean", default: false },
      "prompt-file": { type: "string" },
      "prompt-schema": { type: "string" },
      out: { type: "string", default: REPORTS_DIR },
      concurrency: { type: "string", default: "3" },
      batch: { type: "boolean", default: false },
      "batch-wait-minutes": { type: "string" },
      "budget-usd": { type: "string" },
      "budget-tokens": { type: "string" },
      compare: { type: "string" },
      "write-baseline": { type: "string" },
      comment: { type: "string" },
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
  const subset = values.subset?.trim() || null;
  if (values.subset !== undefined && subset === null) throw new UsageError("--subset needs a name");
  if (subset !== null && cases !== null) throw new UsageError("use --subset or --cases, not both");
  const batch = values.batch ?? false;
  const batchWaitMinutes = positive(values["batch-wait-minutes"], "--batch-wait-minutes", false);
  if (batchWaitMinutes !== null && !batch) throw new UsageError("--batch-wait-minutes goes with --batch");
  return {
    mock: values.mock ?? false,
    tier: tier as ModelTier | null,
    cases,
    subset,
    judge: values.judge ?? false,
    promptFile,
    promptSchema: schema as OutputSchema | null,
    out: values.out ?? REPORTS_DIR,
    concurrency,
    batch,
    batchWaitMinutes: batchWaitMinutes ?? BATCH_WAIT_MINUTES,
    budgetUsd: positive(values["budget-usd"], "--budget-usd", false),
    budgetTokens: positive(values["budget-tokens"], "--budget-tokens", true),
    compare: path(values.compare, "--compare"),
    writeBaseline: path(values["write-baseline"], "--write-baseline"),
    comment: path(values.comment, "--comment"),
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

function realModel(settings: AiSettings, tier: ModelTier, env: Env, modelId?: string): LanguageModelV4 {
  const chosen = modelId ? { ...settings, models: { ...settings.models, [tier]: modelId } } : settings;
  const model = providerModel(chosen, tier, env);
  if (!model)
    throw new SetupError(`no model for provider ${settings.provider}: set its API key, or use --mock`);
  return model;
}

function caseLine(result: CaseResult, index: number, total: number, mock: boolean): string {
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
  const why = result.generation.rejections.map((reason) => `\n      refused: ${reason}`).join("");
  // In the CI log, where the reports artifact can't be read (KRB-224). The
  // mock judge gives 3 everywhere, with no reason worth printing.
  const judgeWhy = (mock ? [] : lowJudgeScores(result))
    .map((low) => `\n      judge ${low.key} ${low.score}/5: ${low.justification}`)
    .join("");
  const latency =
    result.generation.latencyMs === null ? "batch" : `${(result.generation.latencyMs / 1000).toFixed(1)} s`;
  return `[${index}/${total}] ${result.id.padEnd(42)} ${schema.padEnd(16)} ${coverage.padEnd(16)} ${latency}${
    extra.length > 0 ? `  ${extra.join(" ")}` : ""
  }${why}${judgeWhy}`;
}

/** Link to the GitHub Actions run, when the runner is in one. */
function runUrl(env: Env): string | null {
  const server = env.GITHUB_SERVER_URL;
  const repository = env.GITHUB_REPOSITORY;
  const id = env.GITHUB_RUN_ID;
  if (
    !server ||
    !repository ||
    !id ||
    !/^https:\/\/[\w.-]+(:\d+)?$/.test(server) ||
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !/^\d+$/.test(id)
  )
    return null;
  return `${server}/${repository}/actions/runs/${id}`;
}

function writeText(file: string, text: string): void {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, text);
}

async function evaluate(options: Options, env: Env): Promise<number> {
  const settings = readAiSettings(env);
  const mock = options.mock || settings.provider === "mock";
  const templates = templatesFor(options);
  const thresholds = loadThresholds();

  const all = loadCases();
  const known = new Set(all.map((value) => value.id));
  const unknown = (options.cases ?? []).filter((id) => !known.has(id));
  if (unknown.length > 0) throw new UsageError(`unknown case ids: ${unknown.join(", ")}`);
  // A subset runs in its own order, so the budget cuts its last cases first.
  const byId = new Map(all.map((value) => [value.id, value]));
  const selected = (
    options.subset !== null
      ? subsetIds(options.subset, loadSubsets(), known).map((id) => byId.get(id))
      : all.filter((value) => options.cases === null || options.cases.includes(value.id))
  ).filter((value): value is LoadedCase => value !== undefined && templates.has(value.template));
  if (selected.length === 0) throw new SetupError("no case to run");
  const fullRun = selected.length === all.length;

  const priced = hasPrices(settings);
  if (options.budgetUsd !== null && !priced && options.budgetTokens === null)
    throw new SetupError(
      "--budget-usd needs prices for both tiers (AI_PRICE_INPUT_PER_MTOK, AI_PRICE_OUTPUT_PER_MTOK, AI_PRICE_FAST_INPUT_PER_MTOK, AI_PRICE_FAST_OUTPUT_PER_MTOK). Set them, or add --budget-tokens.",
    );
  // Read the baseline before spending anything: a broken file is a setup error.
  const baseline = options.compare !== null ? readBaseline(options.compare) : null;

  // The Batch API (KRB-229): every call waits in a queue that goes out as one
  // batch, at half price. Only the Anthropic provider is wired for it.
  const batching = options.batch && !mock && settings.provider === "anthropic";
  if (options.batch && !batching)
    console.log(
      `--batch: ${mock ? "mock model" : `provider ${settings.provider}`}, the calls go to the standard API.`,
    );
  const queue = batching
    ? new BatchQueue(createAnthropic({ apiKey: env.ANTHROPIC_API_KEY }).experimental_batch(), {
        deadline: Date.now() + options.batchWaitMinutes * 60_000,
        log: (line) => console.log(line),
      })
    : null;
  const live = (model: LanguageModelV4) => (queue ? queue.model(model) : model);
  // Prices only feed the cost estimates and the budget: batches cost half.
  const costSettings = batching ? batchPrices(settings) : settings;

  const judgeModelId = env.AI_EVAL_JUDGE_MODEL?.trim() || null;
  const judgeModel = !options.judge
    ? null
    : mock
      ? mockJudge()
      : live(realModel(settings, "standard", env, judgeModelId ?? undefined));
  const judge = judgeModel ? { model: judgeModel, rubric: loadRubric() } : null;
  const summarizer = mock ? mockSummarizer() : live(realModel(settings, "fast", env));

  const depsFor = (value: LoadedCase): RunDeps => {
    const template = templates.get(value.template);
    if (!template) throw new Error(`no template ${value.template}`);
    const tier = options.tier ?? template.tier;
    return {
      settings: costSettings,
      template,
      tier,
      modelId: mock ? "mock" : settings.models[tier],
      generator: mock ? mockGenerator : () => live(realModel(settings, tier, env)),
      summarizer,
      judge,
      // All the overflow chunks of a case in one batch, not three at a time.
      summaryConcurrency: batching ? Number.MAX_SAFE_INTEGER : undefined,
      timed: !batching,
    };
  };

  const models = [...new Set(selected.map((value) => depsFor(value).modelId))];
  console.log(
    `Golden set: ${selected.length} case(s)${options.subset ? ` (subset ${options.subset})` : ""}, ${
      mock ? "mock model" : `${settings.provider} ${models.join(", ")}`
    }${judge ? `, judge ${mock ? "mock" : (judgeModelId ?? settings.models.standard)}` : ""}${
      batching ? `, Batch API (wait cap ${options.batchWaitMinutes} min)` : ""
    }`,
  );
  if (options.budgetUsd !== null && !priced)
    console.log("No AI_PRICE_* for both tiers: the USD budget can't be checked, the token budget applies.");

  const startedAt = new Date().toISOString();
  const budget = new Budget({ usd: options.budgetUsd, tokens: options.budgetTokens }, priced);
  const { results, skipped } = await executeCases(selected, {
    // With batches, every case runs at once so their calls share each batch.
    concurrency: batching ? selected.length : options.concurrency,
    budget,
    depsFor,
    onResult: (result, done) => console.log(caseLine(result, done, selected.length, mock)),
    onSkip: (value) => console.log(`[skip] ${value.id}: budget reached`),
  });
  if (queue) {
    const { batches, batched, direct } = queue.stats;
    console.log(
      `Batch API: ${batches} batch(es), ${batched} call(s) answered at half price${
        direct > 0
          ? `, ${direct} sent to the standard API at full price (the cost estimate counts them at half)`
          : ""
      }.`,
    );
  }

  const humans = loadHumanScores();
  for (const error of humans.errors) console.warn(`Human scores: ${error}`);
  const runInfo = {
    date: startedAt.slice(0, 10),
    startedAt,
    mock,
    judge: judge !== null,
    fullRun: fullRun && options.promptFile === null,
    subset: options.subset,
    provider: mock ? "mock" : settings.provider,
    model: models.join("+"),
    judgeModel: judge ? (mock ? "mock" : (judgeModelId ?? settings.models.standard)) : null,
    batch: batching,
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
  const gate = applyGate(aggregates, thresholds, { mock, skipped, ran: results.length });
  const releaseReady = gate.passed && gate.complete && runInfo.fullRun && !mock && judge !== null;
  const summaries = results.map(summarizeCase);
  const versions = { outputSchema: OUTPUT_SCHEMA_VERSION, context: CONTEXT_VERSION };
  const comparison: Comparison =
    options.compare === null
      ? { status: "off" }
      : compareWithBaseline(
          { cases: summaries, mock, judge: judge !== null, versions },
          baseline,
          thresholds.regression,
          options.compare,
        );
  const regression = hasRegression(comparison);
  const budgetSummary = budget.summary();

  const outDir = resolve(options.out);
  const written = writeReports(outDir, templateReports, {
    kind: "run",
    run: runInfo,
    aggregates,
    gate,
    releaseReady,
    budget: budgetSummary,
    comparison,
  });

  if (options.writeBaseline !== null) {
    if (results.length === 0) {
      console.warn("No case ran: no baseline written.");
    } else {
      writeBaseline(
        options.writeBaseline,
        buildBaseline({ run: runInfo, complete: gate.complete, versions, cases: summaries }),
      );
      const caveats = [
        mock ? "mock model, never compared" : null,
        runInfo.fullRun ? null : "subset of the golden set",
        gate.complete ? null : "incomplete run",
        judge ? null : "no judge",
      ].filter(Boolean);
      console.log(
        `Baseline written to ${options.writeBaseline}${caveats.length > 0 ? ` (${caveats.join(", ")})` : ""}.`,
      );
    }
  }

  if (options.comment !== null) {
    writeText(
      options.comment,
      renderComment({
        run: runInfo,
        goldenCases: all.length,
        selected: selected.length,
        gate,
        aggregates,
        cases: summaries,
        comparison,
        budget: budgetSummary,
        reportsDir: options.out,
        runUrl: runUrl(env),
      }),
    );
  }

  console.log("");
  console.log(renderGate(gate));
  if (mock) console.log("Mock model: quality thresholds are reported, not enforced.");
  if (!runInfo.fullRun) console.log("Subset run: not valid for a release.");
  if (comparison.status !== "off") console.log(`\n${renderComparison(comparison)}`);
  console.log(`Reports in ${options.out}: ${written.filter((name) => name.endsWith(".md")).join(", ")}`);
  if (options.comment !== null) console.log(`Comment in ${options.comment}`);
  return gate.passed && !regression ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  // Same file the app reads in development. Variables already set win.
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const [command, ...rest] = argv;
  if (command === "agreement") return agreementCli(rest);
  if (command === "template-writer") return templateWriterCli(rest);
  try {
    const options = parseOptions(argv);
    try {
      return await evaluate(options, process.env);
    } catch (error) {
      // The pull request still gets a comment that says why nothing ran.
      if (options.comment !== null && (error instanceof SetupError || error instanceof CaseError))
        writeText(options.comment, renderErrorComment(error.message, runUrl(process.env)));
      throw error;
    }
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
