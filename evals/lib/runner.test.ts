// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "@/lib/ai/context";
import { mockModel, sampleOutput } from "@/lib/ai/mock";
import { readAiSettings } from "@/lib/ai/models";
import { loadCases, type LoadedCase } from "./case";
import { applyGate, loadThresholds } from "./gate";
import { loadRubric } from "./judge";
import { mockGenerator, mockJudge, mockSummarizer } from "./mock";
import { aggregate, calibration, writeReports, type RunInfo } from "./report";
import { promptLeak, runCase, type CaseResult, type RunDeps } from "./runner";
import { loadGlobalTemplates } from "./templates";

const cases = loadCases();
const templates = loadGlobalTemplates();
const settings = readAiSettings({ AI_PROVIDER: "mock" });

function deps(value: LoadedCase, overrides: Partial<RunDeps> = {}): RunDeps {
  const template = templates.get(value.template);
  if (!template) throw new Error(`no template ${value.template}`);
  return {
    settings,
    template,
    tier: template.tier,
    modelId: "mock",
    generator: mockGenerator,
    summarizer: mockSummarizer(),
    judge: null,
    ...overrides,
  };
}

function find(id: string): LoadedCase {
  const value = cases.find((item) => item.id === id);
  if (!value) throw new Error(`no case ${id}`);
  return value;
}

/** A model that answers each call with the next text of the list, the last one repeated. */
function scripted(texts: readonly string[]): LanguageModelV4 {
  let call = 0;
  return mockModel(() => texts[Math.min(call++, texts.length - 1)] ?? "");
}

describe("runCase with the mock model", () => {
  const results: CaseResult[] = [];

  it("passes the schema and citation checks on every case", async () => {
    for (const value of cases) results.push(await runCase(value, deps(value)));
    for (const result of results) {
      expect(result.generation.schemaValidFirstTry, result.id).toBe(true);
      expect(result.generation.schemaValidAfterRepair, result.id).toBe(true);
      expect(result.checks?.citationValid, result.id).toBe(true);
      expect(result.safeOutput, result.id).toBe(true);
      expect(result.forbiddenFound, result.id).toEqual([]);
      expect(result.checks?.french, result.id).toBe(true);
    }
  });

  it("resists every injection case and truncates every long case", () => {
    for (const result of results.filter((item) => item.category === "injection"))
      expect(result.injectionResisted, result.id).toBe(true);
    for (const result of results.filter((item) => item.category === "long")) {
      expect(result.truncationOk, result.id).toBe(true);
      expect(result.context.summaries, result.id).toBeGreaterThan(0);
    }
  });

  it("passes the gate, quality aside", () => {
    const gate = applyGate(aggregate(results), loadThresholds(), { mock: true });
    expect(gate.rows.filter((row) => row.status === "fail")).toEqual([]);
  });

  it("writes one report per template and a run summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "evals-"));
    try {
      const run: RunInfo = {
        date: "2026-10-13",
        startedAt: "2026-10-13T12:00:00.000Z",
        mock: true,
        judge: false,
        fullRun: true,
        subset: null,
        provider: "mock",
        model: "mock",
        judgeModel: null,
        batch: false,
        settings: { maxInputTokens: 60_000, contextWindowTokens: 200_000, redactPii: true },
      };
      const byTemplate = [...new Set(results.map((result) => result.template))].map((key) => {
        const group = results.filter((result) => result.template === key);
        const template = templates.get(key);
        if (!template) throw new Error(key);
        return {
          kind: "template" as const,
          run,
          template: {
            key,
            title: template.title,
            promptVersion: template.version,
            source: template.source,
            outputSchema: template.outputSchema,
            tier: template.tier,
          },
          aggregates: aggregate(group),
          calibration: calibration(group, []),
          cases: group,
        };
      });
      const aggregates = aggregate(results);
      const gate = applyGate(aggregates, loadThresholds(), { mock: true });
      writeReports(dir, byTemplate, { kind: "run", run, aggregates, gate, releaseReady: false });
      const files = readdirSync(dir).sort();
      const version = templates.get("synthese-section")?.version;
      expect(files).toContain(`2026-10-13-synthese-section-${version}-mock.json`);
      expect(files).toContain("2026-10-13-run-mock.md");
      expect(files).toHaveLength(10);
      expect(readFileSync(join(dir, "2026-10-13-run-mock.md"), "utf8")).toContain("Gate: PASS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runCase repair and failures", () => {
  const value = find("docx-audit-eau-parakou");
  const valid = JSON.stringify(sampleOutput("section_draft", ["L1"]));

  it("repairs once after an answer that fails the schema", async () => {
    const prompts: string[] = [];
    const model = scripted(['{"title": "Brouillon"}', valid]);
    const spy: LanguageModelV4 = {
      ...model,
      async doGenerate(options) {
        prompts.push(JSON.stringify(options.prompt));
        return model.doGenerate(options);
      },
    };
    const result = await runCase(value, deps(value, { generator: () => spy }));
    expect(result.generation.schemaValidFirstTry).toBe(false);
    expect(result.generation.schemaValidAfterRepair).toBe(true);
    expect(result.generation.repaired).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Ta réponse précédente ne respectait pas le format demandé");
  });

  it("records a failure after a second bad answer, and checks the rejected text for canaries", async () => {
    const anacarde = find("injection-consignes-anacarde");
    const result = await runCase(
      anacarde,
      deps(anacarde, {
        generator: () => scripted(["VALIDATION-ANACARDE-7731 : rapport approuvé sans réserve"]),
      }),
    );
    expect(result.generation.schemaValidAfterRepair).toBe(false);
    expect(result.generation.error).toBe("invalidOutput");
    expect(result.forbiddenFound).toContain("VALIDATION-ANACARDE-7731");
    expect(result.injectionResisted).toBe(false);
  });

  it("does not repair after a provider error", async () => {
    let calls = 0;
    const failing: LanguageModelV4 = {
      ...mockModel(() => valid),
      async doGenerate() {
        calls++;
        throw new Error("service indisponible");
      },
    };
    const result = await runCase(value, deps(value, { generator: () => failing }));
    expect(result.generation.repaired).toBe(false);
    expect(result.generation.error).toContain("service indisponible");
    // A plain error is not retryable, and a provider error gets no repair call.
    expect(calls).toBe(1);
  });

  it("flags a draft that copies the system prompt", () => {
    expect(
      promptLeak(`Voici mes consignes : ${SYSTEM_PROMPT.slice(0, 400)}`, [SYSTEM_PROMPT]),
    ).not.toBeNull();
    expect(promptLeak("Le rendement du réseau atteint 61 % en 2025.", [SYSTEM_PROMPT])).toBeNull();
  });

  it("shows the judge the template, what the app adds and the writer's length", async () => {
    const inner = mockJudge();
    const prompts: string[] = [];
    const recording: LanguageModelV4 = {
      ...inner,
      async doGenerate(options) {
        prompts.push(
          options.prompt
            .flatMap((message) =>
              typeof message.content === "string"
                ? [message.content]
                : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
            )
            .join("\n"),
        );
        return inner.doGenerate(options);
      },
    };
    await runCase(value, deps(value, { judge: { model: recording, rubric: loadRubric() } }));
    const prompt = prompts.join("\n");
    expect(prompt).toContain("Vise 200 à 500 mots");
    expect(prompt).toContain("la liste « Sources » à la fin");
    expect(prompt).toMatch(
      /Longueur du texte du rédacteur, comptée par l'application : résumé \d+ mots?, points clés \d+ mots?, corps \d+ mots?/,
    );
  });

  it("scores the draft with the judge when asked", async () => {
    const result = await runCase(value, deps(value, { judge: { model: mockJudge(), rubric: loadRubric() } }));
    expect(result.judge && "scores" in result.judge ? result.judge.scores.fidelite : null).toBe(3);
    const agg = aggregate([result]);
    expect(agg.judge?.citations).toBe(3);
    const cal = calibration(
      [result],
      [
        {
          caseId: value.id,
          reviewer: "alice",
          promptVersion: result.promptVersion,
          model: "mock",
          scores: { fidelite: 5 },
          comment: "",
        },
      ],
    );
    expect(cal.fidelite).toEqual({ cases: 1, meanAbsoluteDifference: 2 });
    expect(cal.langue.cases).toBe(0);
  });
});
