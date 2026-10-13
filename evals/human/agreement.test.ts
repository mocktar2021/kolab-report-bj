// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRITERIA } from "../lib/criteria";
import { agreement, agreementCli, humanMeans, parseHumanScores, quadraticWeightedKappa } from "./agreement";

const HEADER = `case_id,reviewer,prompt_version,model,${CRITERIA.map((criterion) => criterion.key).join(",")},comment`;

function sheet(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("quadraticWeightedKappa", () => {
  it("matches a worked example", () => {
    // Ten items, two raters:
    //   A: 1 2 3 4 5 3 2 4 5 3   (mean 3.2, population variance 1.56)
    //   B: 1 3 3 4 4 3 1 5 5 2   (mean 3.1, population variance 1.89)
    // Observed: sum of (a - b)^2 over the pairs = 0+1+0+0+1+0+1+1+0+1 = 5.
    // Expected under chance: (1/n) * sum over all (i, j) of (a_i - b_j)^2
    //   = n * (var A + var B + (mean A - mean B)^2) = 10 * (1.56 + 1.89 + 0.01) = 34.6.
    // The (k - 1)^2 weight denominator cancels, so kappa = 1 - 5 / 34.6 = 148 / 173.
    const a = [1, 2, 3, 4, 5, 3, 2, 4, 5, 3];
    const b = [1, 3, 3, 4, 4, 3, 1, 5, 5, 2];
    const pairs = a.map((score, index) => [score, b[index] ?? 0] as const);
    expect(quadraticWeightedKappa(pairs)).toBeCloseTo(148 / 173, 10);
  });

  it("gives 1 for perfect agreement and -1 for a mirrored scale", () => {
    expect(
      quadraticWeightedKappa([
        [1, 1],
        [3, 3],
        [5, 5],
        [2, 2],
      ]),
    ).toBeCloseTo(1, 10);
    expect(
      quadraticWeightedKappa([
        [1, 5],
        [2, 4],
        [3, 3],
        [4, 2],
        [5, 1],
      ]),
    ).toBeCloseTo(-1, 10);
  });

  it("is undefined without items or without any variance", () => {
    expect(quadraticWeightedKappa([])).toBeNull();
    expect(
      quadraticWeightedKappa([
        [4, 4],
        [4, 4],
        [4, 4],
      ]),
    ).toBeNull();
  });

  it("does not depend on which reviewer comes first", () => {
    const pairs: [number, number][] = [
      [1, 2],
      [3, 3],
      [4, 2],
      [5, 4],
      [2, 2],
      [3, 5],
    ];
    const swapped = pairs.map(([a, b]) => [b, a] as const);
    expect(quadraticWeightedKappa(swapped)).toBeCloseTo(quadraticWeightedKappa(pairs) ?? Number.NaN, 10);
  });
});

describe("parseHumanScores", () => {
  it("reads the template, which has a header only", () => {
    const parsed = parseHumanScores(readFileSync("evals/human/scores.template.csv", "utf8"));
    expect(parsed).toEqual({ rows: [], errors: [] });
  });

  it("reads quoted comments and empty scores", () => {
    const parsed = parseHumanScores(
      sheet([`cas-a,alice,abcd1234,claude-x,5,4,4,5,,4,"Bien, mais une source manque"`]),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      caseId: "cas-a",
      reviewer: "alice",
      scores: { fidelite: 5, couverture: 4, structure: 4, langue: 5, citations: 4 },
      comment: "Bien, mais une source manque",
    });
    expect(parsed.rows[0]?.scores.actionnable).toBeUndefined();
  });

  it("reads a semicolon sheet saved by French Excel", () => {
    const parsed = parseHumanScores(HEADER.replaceAll(",", ";") + "\ncas-a;alice;abcd1234;m;5;4;4;5;3;4;ok");
    expect(parsed.rows).toHaveLength(1);
  });

  it("rejects scores outside 1 to 5 and missing columns", () => {
    expect(parseHumanScores(sheet(["cas-a,alice,v,m,6,4,4,5,3,4,"])).errors[0]).toContain("fidelite");
    expect(parseHumanScores("case_id,reviewer\nx,y").errors[0]).toContain("missing columns");
  });
});

describe("agreement", () => {
  const rows = parseHumanScores(
    sheet([
      "c1,alice,v1,m,5,4,4,5,3,4,",
      "c1,bruno,v1,m,5,4,3,5,3,4,",
      "c2,alice,v1,m,2,3,4,4,2,3,",
      "c2,bruno,v1,m,4,3,4,4,2,3,",
      "c3,alice,v1,m,4,5,5,4,4,5,",
      "c3,bruno,v1,m,4,4,5,4,4,5,",
      "c4,alice,v1,m,3,2,3,3,3,2,",
      "c4,bruno,v1,m,3,2,3,3,3,2,",
      "c5,alice,v1,m,1,2,2,3,1,1,",
      "c5,bruno,v1,m,2,2,2,3,1,1,",
    ]),
  ).rows;

  it("computes kappa per criterion and lists gaps of 2 points", () => {
    const report = agreement(rows);
    expect(report.reviewers).toEqual(["alice", "bruno"]);
    const fidelite = report.criteria.find((row) => row.criterion === "fidelite");
    // alice 5 2 4 3 1, bruno 5 4 4 3 2: same formula as the worked example.
    expect(fidelite?.kappa).toBeCloseTo(
      quadraticWeightedKappa([
        [5, 5],
        [2, 4],
        [4, 4],
        [3, 3],
        [1, 2],
      ]) ?? Number.NaN,
      10,
    );
    expect(fidelite?.items).toBe(5);
    expect(report.criteria.find((row) => row.criterion === "langue")?.kappa).toBeCloseTo(1, 10);
    expect(report.disagreements).toEqual([
      {
        caseId: "c2",
        promptVersion: "v1",
        model: "m",
        criterion: "fidelite",
        scores: [
          { reviewer: "alice", score: 2 },
          { reviewer: "bruno", score: 4 },
        ],
      },
    ]);
  });

  it("averages the reviewers for the calibration", () => {
    expect(humanMeans(rows).get("c2|v1|m")?.fidelite).toBe(3);
  });

  it("marks criteria with too few items", () => {
    const report = agreement(rows.filter((row) => row.caseId === "c1" || row.caseId === "c2"));
    expect(report.criteria.every((row) => row.status === "few-items")).toBe(true);
  });

  it("returns exit code 2 on a sheet without scores", () => {
    const lines: string[] = [];
    expect(agreementCli(["evals/human/scores.template.csv"], (line) => lines.push(line))).toBe(2);
    expect(lines.join("\n")).toContain("No scores found");
  });
});
