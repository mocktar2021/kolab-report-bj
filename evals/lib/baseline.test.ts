// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAiSettings } from "@/lib/ai/models";
import { BASELINE_KIND, buildBaseline, PRODUCTION_BASELINE, readBaseline, writeBaseline } from "./baseline";
import { Budget } from "./budget";
import { loadCases } from "./case";
import { compareWithBaseline } from "./compare";
import { SetupError } from "./errors";
import { executeCases } from "./execute";
import { loadThresholds } from "./gate";
import { mockGenerator } from "./mock";
import { aggregate } from "./report";
import { summarizeCase } from "./summary";
import { loadGlobalTemplates } from "./templates";
import { prCases, runInfo, VERSIONS } from "./testing";

function withDir(work: (dir: string) => void | Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "baseline-"));
    try {
      await work(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe("baseline files", () => {
  it(
    "round-trips a run and compares equal to itself",
    withDir(async (dir) => {
      const settings = readAiSettings({ AI_PROVIDER: "mock" });
      const templates = loadGlobalTemplates();
      const selected = loadCases().filter((value) =>
        ["docx-audit-eau-parakou", "injection-csv-laiterie", "long-mutuelle-zou"].includes(value.id),
      );
      const { results } = await executeCases(selected, {
        concurrency: 2,
        budget: new Budget({ usd: null, tokens: null }, false),
        depsFor: (value) => {
          const template = templates.get(value.template);
          if (!template) throw new Error(value.template);
          return {
            settings,
            template,
            tier: template.tier,
            modelId: "claude-test",
            generator: mockGenerator,
            judge: null,
          };
        },
      });
      const cases = results.map(summarizeCase);
      const baseline = buildBaseline({
        run: runInfo({ subset: null }),
        complete: true,
        versions: VERSIONS,
        cases,
      });
      expect(baseline.aggregates).toEqual(aggregate(results));
      expect(baseline.caseIds).toEqual(selected.map((value) => value.id));
      expect(Object.keys(baseline.templates).sort()).toEqual(["analyse-donnees", "synthese-section"]);
      expect(baseline.templates["synthese-section"]).toMatchObject({
        promptVersion: templates.get("synthese-section")?.version,
        model: "claude-test",
        cases: ["docx-audit-eau-parakou"],
      });

      const file = join(dir, "nested", "production.json");
      writeBaseline(file, baseline);
      const read = readBaseline(file);
      expect(read).toEqual(baseline);
      expect(JSON.parse(readFileSync(file, "utf8")).kind).toBe(BASELINE_KIND);

      const comparison = compareWithBaseline(
        { cases, mock: false, judge: false, versions: VERSIONS },
        read,
        loadThresholds().regression,
        file,
      );
      expect(comparison).toMatchObject({ status: "compared", regressions: [], warnings: [] });
    }),
  );

  it(
    "reads a missing file as no baseline yet",
    withDir((dir) => {
      expect(readBaseline(join(dir, "production.json"))).toBeNull();
    }),
  );

  it(
    "refuses a file that isn't a baseline",
    withDir((dir) => {
      const file = join(dir, "production.json");
      writeFileSync(file, "{ pas du json");
      expect(() => readBaseline(file)).toThrow(SetupError);
      writeFileSync(file, JSON.stringify({ kind: "run", aggregates: {} }));
      expect(() => readBaseline(file)).toThrow("not a baseline written by --write-baseline");
      const baseline = buildBaseline({
        run: runInfo(),
        complete: true,
        versions: VERSIONS,
        cases: prCases(),
      });
      writeFileSync(file, JSON.stringify({ ...baseline, cases: [] }));
      expect(() => readBaseline(file)).toThrow(SetupError);
    }),
  );

  it("keeps the committed production baseline readable, when there is one", () => {
    if (!existsSync(PRODUCTION_BASELINE)) return;
    const baseline = readBaseline(PRODUCTION_BASELINE);
    expect(baseline?.mock).toBe(false);
    expect(baseline?.judge).toBe(true);
  });
});
