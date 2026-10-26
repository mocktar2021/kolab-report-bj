// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readAiSettings } from "@/lib/ai/models";
import { Budget, caseSpend, hasPrices, upfrontSpend } from "./budget";
import { loadCases, type LoadedCase } from "./case";
import { executeCases } from "./execute";
import { applyGate, loadThresholds } from "./gate";
import { loadRubric } from "./judge";
import { mockGenerator, mockJudge } from "./mock";
import { aggregate } from "./report";
import type { RunDeps } from "./runner";
import { loadGlobalTemplates } from "./templates";

const cases = loadCases();
const templates = loadGlobalTemplates();
const mockSettings = readAiSettings({ AI_PROVIDER: "mock" });
const pricedSettings = readAiSettings({
  AI_PROVIDER: "mock",
  AI_PRICE_INPUT_PER_MTOK: "3",
  AI_PRICE_OUTPUT_PER_MTOK: "15",
  AI_PRICE_FAST_INPUT_PER_MTOK: "1",
  AI_PRICE_FAST_OUTPUT_PER_MTOK: "5",
});

function find(id: string): LoadedCase {
  const value = cases.find((item) => item.id === id);
  if (!value) throw new Error(`no case ${id}`);
  return value;
}

function deps(value: LoadedCase, options: { judge?: boolean; settings?: typeof mockSettings } = {}): RunDeps {
  const template = templates.get(value.template);
  if (!template) throw new Error(`no template ${value.template}`);
  return {
    settings: options.settings ?? mockSettings,
    template,
    tier: template.tier,
    modelId: "mock",
    generator: mockGenerator,
    judge: options.judge ? { model: mockJudge(), rubric: loadRubric() } : null,
  };
}

const spend = (tokens: number, usd = 0) => ({ tokens, usd });

describe("Budget", () => {
  it("stops starting cases once the estimate would pass the token cap", () => {
    const budget = new Budget({ usd: null, tokens: 250 }, false);
    expect(budget.start("a", spend(100))).toBe(true);
    budget.finish("a", spend(100));
    expect(budget.start("b", spend(100))).toBe(true);
    budget.finish("b", spend(100));
    expect(budget.start("c", spend(100))).toBe(false);
    // Once stopped, a smaller case doesn't start either: the run is cut at one point.
    expect(budget.start("d", spend(1))).toBe(false);
    expect(budget.summary()).toEqual({
      limits: { usd: null, tokens: 250 },
      priced: false,
      spent: { usd: null, tokens: 200 },
      skipped: ["c", "d"],
    });
  });

  it("counts the cases still running", () => {
    const budget = new Budget({ usd: null, tokens: 250 }, false);
    expect(budget.start("a", spend(100))).toBe(true);
    expect(budget.start("b", spend(100))).toBe(true);
    expect(budget.start("c", spend(100))).toBe(false);
  });

  it("scales the estimate by what the finished cases really cost", () => {
    const budget = new Budget({ usd: null, tokens: 1000 }, false);
    expect(budget.estimate(spend(400))).toEqual(spend(400));
    budget.start("a", spend(400));
    budget.finish("a", spend(100));
    expect(budget.estimate(spend(400)).tokens).toBe(100);
    // 100 spent + 4 cases estimated at 200 each = 900: still under the cap.
    for (const id of ["b", "c", "d", "e"]) expect(budget.start(id, spend(800)), id).toBe(true);
    expect(budget.start("f", spend(800))).toBe(false);
  });

  it("checks the USD cap only when both tiers have a price", () => {
    const priced = new Budget({ usd: 0.5, tokens: null }, true);
    expect(priced.start("a", spend(10, 0.4))).toBe(true);
    expect(priced.start("b", spend(10, 0.4))).toBe(false);
    const unpriced = new Budget({ usd: 0.5, tokens: null }, false);
    expect(unpriced.start("a", spend(10, 0.4))).toBe(true);
    expect(unpriced.start("b", spend(10, 0.4))).toBe(true);
    expect(hasPrices(mockSettings)).toBe(false);
    expect(hasPrices(pricedSettings)).toBe(true);
  });
});

describe("upfrontSpend and caseSpend", () => {
  it("estimates a long case far above a short one, and the judge on top", () => {
    const short = find("xlsx-cantines-zou");
    const long = find("long-mutuelle-zou");
    const small = upfrontSpend(short, deps(short));
    expect(small.usd).toBe(0);
    expect(upfrontSpend(long, deps(long)).tokens).toBeGreaterThan(10 * small.tokens);
    expect(upfrontSpend(short, deps(short, { judge: true })).tokens).toBeGreaterThan(small.tokens);
    expect(upfrontSpend(short, deps(short, { settings: pricedSettings })).usd).toBeGreaterThan(0);
  });

  it("adds draft and judge for a finished case", async () => {
    const value = find("long-mutuelle-zou");
    const { results } = await executeCases([value], {
      concurrency: 1,
      budget: new Budget({ usd: null, tokens: null }, true),
      depsFor: (item) => deps(item, { judge: true, settings: pricedSettings }),
    });
    const result = results[0];
    if (!result || !result.judge || !("scores" in result.judge)) throw new Error("no judged result");
    const actual = caseSpend(result, pricedSettings);
    const { generation, judge } = { ...result, judge: result.judge };
    expect(actual.tokens).toBe(
      generation.usage.inputTokens +
        generation.usage.outputTokens +
        judge.usage.inputTokens +
        judge.usage.outputTokens,
    );
    expect(actual.usd).toBeGreaterThan(generation.costUsd ?? 0);
  });
});

describe("executeCases with a budget", () => {
  const selected = [
    "docx-audit-eau-parakou",
    "xlsx-cantines-zou",
    "mixed-voirie-vierzon",
    "long-mutuelle-zou",
  ].map(find);

  it("runs everything without a cap, in selection order", async () => {
    const { results, skipped } = await executeCases(selected, {
      concurrency: 3,
      budget: new Budget({ usd: null, tokens: null }, false),
      depsFor: (value) => deps(value),
    });
    expect(results.map((result) => result.id)).toEqual(selected.map((value) => value.id));
    expect(skipped).toEqual([]);
  });

  it("skips the cases past the cap and marks the run incomplete", async () => {
    const seen: string[] = [];
    const { results, skipped } = await executeCases(selected, {
      concurrency: 1,
      // Room for the three short cases, not for the long one.
      budget: new Budget({ usd: null, tokens: 20_000 }, false),
      depsFor: (value) => deps(value),
      onSkip: (value) => seen.push(value.id),
    });
    expect(results.map((result) => result.id)).toEqual(selected.slice(0, 3).map((value) => value.id));
    expect(skipped).toEqual(["long-mutuelle-zou"]);
    expect(seen).toEqual(skipped);
    const gate = applyGate(aggregate(results), loadThresholds(), {
      mock: true,
      skipped,
      ran: results.length,
    });
    expect(gate).toMatchObject({ passed: true, complete: false, skippedCases: ["long-mutuelle-zou"] });
  });

  it("runs nothing when the first case doesn't fit", async () => {
    const { results, skipped } = await executeCases(selected, {
      concurrency: 2,
      budget: new Budget({ usd: null, tokens: 10 }, false),
      depsFor: (value) => deps(value),
    });
    expect(results).toEqual([]);
    expect(skipped).toHaveLength(4);
    const gate = applyGate(aggregate(results), loadThresholds(), { mock: true, skipped, ran: 0 });
    expect(gate).toMatchObject({ passed: false, noCaseRan: true });
  });
});
