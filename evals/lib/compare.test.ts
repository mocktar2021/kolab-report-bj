// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareWithBaseline, hasRegression, renderComparison, type Comparison } from "./compare";
import { loadThresholds } from "./gate";
import type { CaseSummary } from "./summary";
import { baselineOf, caseSummary, prCases, scores, VERSIONS } from "./testing";

const limits = loadThresholds().regression;
const FILE = "evals/baseline/production.json";

function compare(
  current: CaseSummary[],
  before: CaseSummary[] | null,
  options: { mock?: boolean; judge?: boolean } = {},
): Comparison {
  return compareWithBaseline(
    {
      cases: current,
      mock: options.mock ?? false,
      judge: options.judge ?? current.some((value) => value.judge !== null),
      versions: VERSIONS,
    },
    before === null ? null : baselineOf(before),
    limits,
    FILE,
  );
}

function compared(comparison: Comparison) {
  if (comparison.status !== "compared") throw new Error(`expected a comparison, got ${comparison.status}`);
  return comparison;
}

function row(comparison: Comparison, metric: string, scope: string | null = null) {
  const result = compared(comparison);
  const rows = scope === null ? result.overall : result.templates.find((item) => item.key === scope)?.rows;
  return rows?.find((item) => item.metric === metric);
}

/** The pr-like cases with one of them changed. */
function withCase(id: string, overrides: Partial<CaseSummary>): CaseSummary[] {
  return prCases().map((value) => (value.id === id ? { ...value, ...overrides } : value));
}

describe("compareWithBaseline", () => {
  it("finds nothing when the run matches the baseline", () => {
    const result = compared(compare(prCases(), prCases()));
    expect(result.common).toHaveLength(6);
    expect(result.regressions).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.overall.filter((item) => item.rule === "drop").every((item) => item.status === "ok")).toBe(
      true,
    );
    expect(hasRegression(result)).toBe(false);
  });

  it("fails on a drop beyond the limit and names the case", () => {
    const result = compare(withCase("mixed-c", { citationValid: false }), prCases());
    expect(row(result, "citationValidRate")).toMatchObject({ status: "regression", limit: 0.02 });
    expect(row(result, "citationValidRate")?.change).toBeCloseTo(-1 / 6);
    expect(hasRegression(result)).toBe(true);
    expect(compared(result).cases).toEqual([
      { id: "mixed-c", lost: ["citationValid"], gained: [], keyPoints: null, judge: [] },
    ]);
  });

  it("accepts a drop within the limit", () => {
    // One case loses 0.15 of its key points: 0.025 on the mean, under the 0.05 limit.
    const small = compare(withCase("docx-a", { keyPointCoverage: 0.65 }), prCases());
    expect(row(small, "keyPointCoverage")?.status).toBe("ok");
    expect(hasRegression(small)).toBe(false);
    const large = compare(withCase("docx-a", { keyPointCoverage: 0.2 }), prCases());
    expect(row(large, "keyPointCoverage")?.status).toBe("regression");
  });

  it("lets injection resistance and safe output drop not at all", () => {
    const injection = compare(withCase("injection-e", { injectionResisted: false }), prCases());
    expect(row(injection, "injectionResistedRate")).toMatchObject({ status: "regression", limit: 0 });
    const unsafe = compare(withCase("docx-a", { safeOutput: false }), prCases());
    expect(row(unsafe, "safeOutputRate")?.status).toBe("regression");
  });

  it("only warns on cost and latency", () => {
    const result = compared(compare(prCases({ costUsd: 0.06, latencyMs: 16_000 }), prCases()));
    expect(row(result, "costPerCase")).toMatchObject({ rule: "increase", status: "warning" });
    expect(row(result, "costPerCase")?.change).toBeCloseTo(1);
    expect(row(result, "latencyP95")?.status).toBe("warning");
    expect(result.regressions).toEqual([]);
    expect(result.warnings.map((item) => item.row.metric)).toEqual(["costPerCase", "latencyP95"]);
    expect(hasRegression(result)).toBe(false);
  });

  it("compares tokens per case when a side has no price", () => {
    const result = compare(prCases({ costUsd: null, tokens: { input: 9000, output: 800 } }), prCases());
    expect(row(result, "costPerCase")).toBeUndefined();
    expect(row(result, "tokensPerCase")).toMatchObject({ status: "warning", unit: "tokens" });
  });

  it("says there is no baseline yet when the file is missing", () => {
    expect(compare(prCases(), null)).toEqual({ status: "no-baseline", file: FILE });
  });

  it("never compares a mock run or a mock baseline", () => {
    expect(compare(prCases(), prCases(), { mock: true })).toEqual({
      status: "mock",
      file: FILE,
      reason: "run",
    });
    const mockBaseline = baselineOf(prCases(), { mock: true });
    expect(
      compareWithBaseline(
        { cases: prCases(), mock: false, judge: false, versions: VERSIONS },
        mockBaseline,
        limits,
        FILE,
      ),
    ).toEqual({ status: "mock", file: FILE, reason: "baseline" });
  });

  it("compares the judge only when both runs had it", () => {
    const judged = prCases({ judge: scores(4) });
    const both = compare(
      judged.map((value) =>
        value.id === "docx-a" ? { ...value, judge: scores(4, { fidelite: 1 }) } : value,
      ),
      judged,
    );
    expect(row(both, "judge.fidelite")).toMatchObject({ status: "regression", limit: 0.25 });
    expect(row(both, "judge.fidelite")?.change).toBeCloseTo(-0.5);
    expect(row(both, "judge.langue")?.status).toBe("ok");
    expect(compared(both).cases[0]?.judge).toEqual([{ criterion: "fidelite", current: 1, baseline: 4 }]);

    // Judge in this run, not in the baseline: no judge row, and tokens per case
    // would count the judge on one side only, so it is skipped.
    const oneSide = compared(
      compare(prCases({ judge: scores(2), costUsd: null }), prCases({ costUsd: null })),
    );
    expect(oneSide.judgeCompared).toBe(false);
    expect(oneSide.overall.some((item) => item.metric.startsWith("judge."))).toBe(false);
    expect(row(oneSide, "tokensPerCase")?.status).toBe("skipped");
    expect(oneSide.regressions).toEqual([]);
  });

  it("skips a metric only one side measured", () => {
    // The long case lost its category in this run: truncation is measured in the baseline only.
    const current = withCase("long-d", { truncationOk: null });
    expect(row(compare(current, prCases()), "longCasesTruncatedRate")).toMatchObject({
      status: "skipped",
      change: null,
    });
  });

  it("compares on the cases both runs have", () => {
    const full = [...prCases(), caseSummary("noisy-g", { keyPointCoverage: 0.1, citationValid: false })];
    const result = compared(compare([...prCases(), caseSummary("new-h", { citationValid: false })], full));
    expect(result.common).toHaveLength(6);
    expect(result.onlyCurrent).toEqual(["new-h"]);
    expect(result.regressions).toEqual([]);
    expect(compare([caseSummary("other")], prCases()).status).toBe("no-common-cases");
  });

  it("fails on a template drop only when that template's prompt changed", () => {
    // xlsx-b, long-d and injection-f use analyse-donnees; one loses its length bounds.
    const drop = { lengthOk: false };
    const unchanged = compared(compare(withCase("xlsx-b", drop), prCases()));
    expect(row(unchanged, "lengthOkRate")?.status).toBe("ok");
    expect(row(unchanged, "lengthOkRate", "analyse-donnees")?.status).toBe("regression");
    expect(unchanged.regressions).toEqual([]);
    expect(unchanged.warnings.map((item) => [item.scope, item.row.metric])).toEqual([
      ["analyse-donnees", "lengthOkRate"],
    ]);

    const current = prCases().map((value) =>
      value.template === "analyse-donnees"
        ? { ...value, promptVersion: "cccc3333", ...(value.id === "xlsx-b" ? drop : {}) }
        : value,
    );
    const changed = compared(compare(current, prCases()));
    const template = changed.templates.find((item) => item.key === "analyse-donnees");
    expect(template).toMatchObject({ promptChanged: true, baselinePromptVersion: "bbbb2222" });
    expect(changed.regressions.map((item) => [item.scope, item.row.metric])).toEqual([
      ["analyse-donnees", "lengthOkRate"],
    ]);
    expect(hasRegression(changed)).toBe(true);
  });

  it("renders the comparison in English for the console", () => {
    const text = renderComparison(compare(withCase("mixed-c", { citationValid: false }), prCases()));
    expect(text).toContain("on 6 common case(s)");
    expect(text).toContain("Regressions: citationValidRate -16.7 pts");
    expect(renderComparison(compare(prCases(), null))).toContain("No baseline yet");
  });
});
