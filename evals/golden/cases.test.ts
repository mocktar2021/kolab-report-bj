// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contextBudget, planContext } from "@/lib/ai/context";
import { readAiSettings } from "@/lib/ai/models";
import { PARSE_LIMITS } from "@/lib/deliverables/parse/types";
import {
  CaseError,
  CATEGORIES,
  CASES_DIR,
  expectedRefs,
  loadCase,
  loadCases,
  TEMPLATE_KEYS,
} from "../lib/case";
import { runChecks } from "../lib/checks";
import { generateContent } from "../lib/generate";
import { loadGlobalTemplates } from "../lib/templates";
import { containsTerm, normalize } from "../lib/text";

const cases = loadCases();
const templates = loadGlobalTemplates();
const settings = readAiSettings({});

/** Forbidden strings every case carries; an injection case needs canaries beyond these. */
const GENERIC_FORBIDDEN = new Set(["<livrable", "{{"]);

describe("golden set", () => {
  it("has 12 to 16 cases with unique ids", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(cases.length).toBeLessThanOrEqual(16);
    expect(new Set(cases.map((value) => value.id)).size).toBe(cases.length);
  });

  it("covers every category at least twice and every template", () => {
    for (const category of CATEGORIES) {
      expect(cases.filter((value) => value.category === category).length, category).toBeGreaterThanOrEqual(2);
    }
    const byTemplate = new Map(
      TEMPLATE_KEYS.map((key) => [key, cases.filter((value) => value.template === key)]),
    );
    for (const [key, list] of byTemplate) expect(list.length, key).toBeGreaterThan(0);
    const synthese = byTemplate.get("synthese-section")?.length ?? 0;
    for (const [key, list] of byTemplate)
      if (key !== "synthese-section") expect(list.length).toBeLessThan(synthese);
  });

  it("uses templates that the migrations define", () => {
    for (const value of cases) expect(templates.has(value.template), value.id).toBe(true);
  });

  it("lists deliverables in ref order, with unique ids", () => {
    for (const value of cases) {
      expect([...expectedRefs(value).values()], value.id).toEqual(value.deliverables.map((d) => d.fileName));
      expect(new Set(value.deliverables.map((d) => d.id)).size, value.id).toBe(value.deliverables.length);
    }
  });

  it("only asks to cite refs that exist", () => {
    for (const value of cases) {
      const refs = new Set(expectedRefs(value).keys());
      expect(new Set(value.reference.mustCite).size, value.id).toBe(value.reference.mustCite.length);
      for (const ref of value.reference.mustCite) expect(refs.has(ref), `${value.id} ${ref}`).toBe(true);
    }
  });

  it("gives every injection case at least one canary", () => {
    for (const value of cases.filter((item) => item.category === "injection")) {
      const canaries = value.reference.forbidden.filter((term) => !GENERIC_FORBIDDEN.has(term));
      expect(canaries.length, value.id).toBeGreaterThan(0);
      // The canary must be planted in a deliverable, or the case tests nothing.
      const source = normalize(value.input.deliverables.map((d) => d.markdown).join("\n"));
      expect(
        canaries.some((term) => containsTerm(source, term)),
        value.id,
      ).toBe(true);
    }
  });

  it("names the file in the error of a broken case", () => {
    const dir = mkdtempSync(join(tmpdir(), "cases-"));
    try {
      const value = JSON.parse(readFileSync(join(CASES_DIR, "docx-audit-eau-parakou.json"), "utf8"));
      const file = join(dir, "autre-nom.json");
      writeFileSync(file, JSON.stringify(value));
      expect(() => loadCase(file, CASES_DIR)).toThrow(CaseError);
      expect(() => loadCase(file, CASES_DIR)).toThrow(/autre-nom\.json: id "docx-audit-eau-parakou"/);
      writeFileSync(file, JSON.stringify({ ...value, id: "autre-nom", template: "inconnu" }));
      expect(() => loadCase(file, CASES_DIR)).toThrow(/template/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps deliverables under the parser's size cap", () => {
    for (const value of cases) {
      for (const deliverable of value.input.deliverables) {
        expect(deliverable.markdown.length).toBeGreaterThan(0);
        expect(deliverable.markdown.length).toBeLessThanOrEqual(PARSE_LIMITS.maxMarkdownChars);
      }
    }
  });
});

describe("reference sections", () => {
  for (const value of cases) {
    it(`${value.id}: passes the deterministic checks on its own`, () => {
      const checks = runChecks({
        markdown: value.reference.markdown,
        refs: [...expectedRefs(value).keys()],
        sourceText: value.input.deliverables.map((d) => d.markdown).join("\n"),
        reference: value.reference,
      });
      expect(checks.keyPoints.filter((point) => !point.covered)).toEqual([]);
      expect(checks.keyPointCoverage).toBe(1);
      expect(checks.forbiddenFound).toEqual([]);
      expect(checks.unsafe).toEqual([]);
      expect(checks.french).toBe(true);
      expect(checks.words).toBeGreaterThanOrEqual(value.reference.words.min);
      expect(checks.words).toBeLessThanOrEqual(value.reference.words.max);
    });

    it(`${value.id}: names the file of each ref it must cite`, () => {
      const names = expectedRefs(value);
      for (const ref of value.reference.mustCite) {
        expect(value.reference.markdown, ref).toContain(names.get(ref));
      }
    });
  }
});

describe("long cases", () => {
  const long = cases.filter((value) => value.category === "long");

  it("generate the same content on every run", () => {
    for (const value of long) {
      for (const deliverable of value.deliverables) {
        if (!deliverable.generated) continue;
        expect(generateContent(deliverable.generated)).toBe(generateContent(deliverable.generated));
      }
    }
  });

  for (const value of long) {
    it(`${value.id}: makes planContext truncate`, () => {
      const template = templates.get(value.template);
      if (!template) throw new Error(`no template ${value.template}`);
      const budget = contextBudget({
        contextWindowTokens: settings.contextWindowTokens,
        maxOutputTokens: template.maxOutputTokens,
        maxInputTokens: settings.maxInputTokens,
      });
      const plan = planContext(value.input, budget, {
        redactPii: settings.redactPii,
        template: template.text,
      });
      const original = plan.entries.reduce((sum, entry) => sum + entry.originalTokens, 0);
      const actions = new Set(plan.decisions.map((decision) => decision.action));

      expect(original).toBeGreaterThan(budget.maxInputTokens);
      expect(plan.entries.some((entry) => entry.originalTokens > budget.perDeliverableTokens)).toBe(true);
      expect(actions.has("capped")).toBe(true);
      expect(actions.has("rowsCut")).toBe(true);
      expect(plan.overflow.length).toBeGreaterThan(0);
      expect(plan.estimatedInputTokens).toBeLessThanOrEqual(budget.maxInputTokens);
    });
  }

  it("include one case past the budget after the per-deliverable caps", () => {
    const shared = long.some((value) => {
      const template = templates.get(value.template);
      if (!template) return false;
      const budget = contextBudget({
        contextWindowTokens: settings.contextWindowTokens,
        maxOutputTokens: template.maxOutputTokens,
        maxInputTokens: settings.maxInputTokens,
      });
      const plan = planContext(value.input, budget, {
        redactPii: settings.redactPii,
        template: template.text,
      });
      return plan.decisions.some((decision) => decision.action === "cut" || decision.action === "dropped");
    });
    expect(shared).toBe(true);
  });
});
