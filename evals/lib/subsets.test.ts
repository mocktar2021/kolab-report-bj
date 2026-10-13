// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCases, TEMPLATE_KEYS } from "./case";
import { SetupError } from "./errors";
import { loadSubsets, subsetIds } from "./subsets";

const cases = loadCases();
const known = new Set(cases.map((value) => value.id));

describe("evals/subsets.json", () => {
  const subsets = loadSubsets();

  it("lists only cases of the golden set", () => {
    for (const [name, ids] of Object.entries(subsets)) {
      expect(
        ids.filter((id) => !known.has(id)),
        name,
      ).toEqual([]);
    }
  });

  it("keeps the pr subset small and covers every kind of case that matters on a PR", () => {
    const pr = subsetIds("pr", subsets, known);
    expect(pr.length).toBeGreaterThanOrEqual(4);
    expect(pr.length).toBeLessThanOrEqual(7);
    const chosen = cases.filter((value) => pr.includes(value.id));
    const categories = new Set(chosen.map((value) => value.category));
    for (const category of ["docx", "xlsx", "mixed", "long", "injection"] as const) {
      expect(categories.has(category), category).toBe(true);
    }
    // Each template has at least one case, so a template change is always measured.
    expect(new Set(chosen.map((value) => value.template))).toEqual(new Set(TEMPLATE_KEYS));
  });
});

describe("subsetIds", () => {
  const subsets = { pr: ["docx-audit-eau-parakou", "xlsx-cantines-zou"] };

  it("returns the ids of a known subset", () => {
    expect(subsetIds("pr", subsets, known)).toEqual(["docx-audit-eau-parakou", "xlsx-cantines-zou"]);
  });

  it("refuses an unknown subset and lists the known ones", () => {
    expect(() => subsetIds("nightly", subsets, known)).toThrow(SetupError);
    expect(() => subsetIds("nightly", subsets, known)).toThrow('unknown subset "nightly", known subsets: pr');
    expect(() => subsetIds("constructor", subsets, known)).toThrow(SetupError);
  });

  it("refuses a subset with an id that is not a case", () => {
    expect(() => subsetIds("pr", { pr: ["docx-audit-eau-parakou", "docx-disparu"] }, known)).toThrow(
      'subset "pr" lists unknown case ids: docx-disparu',
    );
  });
});

describe("loadSubsets", () => {
  it("refuses a file with a case listed twice or a bad name", () => {
    const dir = mkdtempSync(join(tmpdir(), "subsets-"));
    try {
      const file = join(dir, "subsets.json");
      writeFileSync(file, JSON.stringify({ pr: ["a-b", "a-b"] }));
      expect(() => loadSubsets(file)).toThrow("a case id is listed twice");
      writeFileSync(file, JSON.stringify({ "Mon sous-ensemble": ["a-b"] }));
      expect(() => loadSubsets(file)).toThrow(SetupError);
      writeFileSync(file, "{");
      expect(() => loadSubsets(file)).toThrow(SetupError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
