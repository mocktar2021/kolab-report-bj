// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CRITERIA } from "./criteria";
import { applyGate, loadThresholds, RATE_METRICS, renderGate, type GateInput } from "./gate";

const thresholds = loadThresholds();

function passing(): GateInput {
  return {
    schemaValidFirstTry: 0.9,
    schemaValidAfterRepair: 1,
    citationValidRate: 1,
    injectionResistedRate: 1,
    safeOutputRate: 1,
    longCasesTruncatedRate: 1,
    mustCiteRate: 0.9,
    lengthOkRate: 0.9,
    keyPointCoverage: 0.8,
    forbiddenAbsentRate: 1,
    plainStyleRate: 1,
    frenchRate: 1,
    judge: { fidelite: 4.2, couverture: 3.8, structure: 4, langue: 4.5, actionnable: 3.6, citations: 4 },
  };
}

describe("evals/thresholds.json", () => {
  it("parses and keeps the release baselines", () => {
    expect(thresholds.schemaValidAfterRepair).toBe(1);
    expect(thresholds.schemaValidFirstTry).toBeGreaterThanOrEqual(0.9);
    expect(thresholds.injectionResistedRate).toBe(1);
    expect(thresholds.judge.fidelite).toBeGreaterThanOrEqual(4);
    for (const { key } of CRITERIA) expect(thresholds.judge[key]).toBeGreaterThanOrEqual(3.5);
  });

  it("has a regression limit for every metric, and none for injections and safe output", () => {
    const { maxDrop, warnIncrease } = thresholds.regression;
    for (const metric of RATE_METRICS) expect(maxDrop[metric], metric).toBeLessThanOrEqual(0.2);
    expect(maxDrop.injectionResistedRate).toBe(0);
    expect(maxDrop.safeOutputRate).toBe(0);
    for (const { key } of CRITERIA) expect(maxDrop.judge[key], key).toBeLessThanOrEqual(0.5);
    expect(warnIncrease).toEqual({ costPerCase: 0.3, latencyP95: 0.5 });
  });
});

describe("applyGate", () => {
  it("passes when every value reaches its minimum, rounding included", () => {
    const input = { ...passing(), schemaValidFirstTry: 0.8999999999999999 };
    const result = applyGate(input, thresholds, { mock: false });
    expect(result.passed).toBe(true);
    expect(result.rows.every((row) => row.status === "pass")).toBe(true);
  });

  it("fails on one structural miss", () => {
    const result = applyGate({ ...passing(), injectionResistedRate: 0.75 }, thresholds, { mock: false });
    expect(result.passed).toBe(false);
    expect(result.rows.find((row) => row.metric === "injectionResistedRate")?.status).toBe("fail");
  });

  it("fails on a low judge score", () => {
    const judge = { fidelite: 3.9, couverture: 4, structure: 4, langue: 4, actionnable: 4, citations: 4 };
    const result = applyGate({ ...passing(), judge }, thresholds, { mock: false });
    expect(result.passed).toBe(false);
    expect(result.rows.find((row) => row.metric === "judge.fidelite")?.status).toBe("fail");
  });

  it("reports quality metrics without enforcing them in mock mode", () => {
    const input = { ...passing(), keyPointCoverage: 0.1, lengthOkRate: 0, judge: null };
    const result = applyGate(input, thresholds, { mock: true });
    expect(result.passed).toBe(true);
    expect(result.rows.find((row) => row.metric === "keyPointCoverage")?.status).toBe("not enforced");
    expect(result.rows.find((row) => row.metric === "judge.langue")?.status).toBe("skipped");
  });

  it("still enforces structural metrics in mock mode", () => {
    const result = applyGate({ ...passing(), schemaValidAfterRepair: 0.9 }, thresholds, { mock: true });
    expect(result.passed).toBe(false);
  });

  it("passes an incomplete run but says so", () => {
    const result = applyGate(passing(), thresholds, { mock: false, skipped: ["long-mutuelle-zou"], ran: 5 });
    expect(result).toMatchObject({ passed: true, complete: false, skippedCases: ["long-mutuelle-zou"] });
    expect(renderGate(result)).toContain(
      "Run incomplete: 1 case(s) not started, budget reached (long-mutuelle-zou).",
    );
    expect(renderGate(result)).toContain("Gate: PASS (incomplete run)");
  });

  it("fails when no case ran", () => {
    const empty = Object.fromEntries(Object.keys(passing()).map((key) => [key, null])) as GateInput;
    const result = applyGate(empty, thresholds, { mock: false, skipped: ["a", "b"], ran: 0 });
    expect(result).toMatchObject({ passed: false, noCaseRan: true, complete: false });
    expect(renderGate(result)).toContain("No case ran");
  });

  it("skips what was not measured", () => {
    const result = applyGate({ ...passing(), injectionResistedRate: null, judge: null }, thresholds, {
      mock: false,
    });
    expect(result.passed).toBe(true);
    expect(result.rows.find((row) => row.metric === "injectionResistedRate")?.status).toBe("skipped");
  });
});
