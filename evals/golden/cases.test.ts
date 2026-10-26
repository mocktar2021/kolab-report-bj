// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContext, contextBudget, estimateTokens } from "@/lib/ai/context";
import { readAiSettings } from "@/lib/ai/models";
import { draftToMarkdown, parseDraftOutput, type DraftOutput, type SourceRefs } from "@/lib/ai/schemas";
import { PARSE_LIMITS } from "@/lib/deliverables/parse/types";
import type { OutputSchema } from "@/lib/prompts/catalog";
import {
  CaseError,
  CATEGORIES,
  CASES_DIR,
  expectedRefs,
  loadCase,
  loadCases,
  TEMPLATE_KEYS,
  type LoadedCase,
} from "../lib/case";
import { runChecks } from "../lib/checks";
import { generateContent } from "../lib/generate";
import { loadGlobalTemplates } from "../lib/templates";
import { containsTerm, countWords, normalize } from "../lib/text";

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
      expect(checks.styleTells).toEqual([]);
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

  /** The default budget for a template: the window with room for the answer and the thinking. */
  function budgetFor(value: LoadedCase, maxInputTokens = settings.maxInputTokens) {
    const template = templates.get(value.template);
    if (!template) throw new Error(`no template ${value.template}`);
    const budget = contextBudget({
      contextWindowTokens: settings.contextWindowTokens,
      maxOutputTokens: template.maxOutputTokens + settings.draftThinking.tokens,
      maxInputTokens,
    });
    return { template, budget };
  }

  for (const value of long) {
    it(`${value.id}: goes in whole under the default budget`, () => {
      const { template, budget } = budgetFor(value);
      const source = value.input.deliverables.reduce(
        (sum, deliverable) => sum + estimateTokens(deliverable.markdown),
        0,
      );
      // Past the 60,000 tokens a draft used to be cut to (before KRB-253).
      expect(source).toBeGreaterThan(60_000);
      const context = buildContext(value.input, budget, {
        redactPii: settings.redactPii,
        template: template.text,
      });
      expect(context.fits).toBe(true);
    });

    it(`${value.id}: is refused whole, never cut, under a small budget`, () => {
      const { template, budget } = budgetFor(value, 20_000);
      const context = buildContext(value.input, budget, {
        redactPii: settings.redactPii,
        template: template.text,
      });
      expect(context).toMatchObject({ fits: false, maxInputTokens: 20_000 });
      if (!context.fits) expect(context.estimatedInputTokens).toBeGreaterThan(20_000);
    });
  }
});

// The longest answer the golden cases of a template accept
// (reference.words.max), written as the JSON the model returns, must fit the
// template's max_output_tokens with a margin. Drafts run without thinking
// (noThinking), so the whole cap goes to the answer. The words come from the
// template's own reference sections, so the text has the characters per word
// of the French an expert writes, and estimateTokens counts it on the high side.
// The margin covers a model that writes past the bounds, indents its JSON or
// cuts numbers into more tokens.
describe("output caps", () => {
  const MARGIN = 1.5;

  /** The words of some reference sections, without Markdown marks. */
  function corpus(list: readonly LoadedCase[]): string[] {
    return list
      .flatMap((value) => value.reference.markdown.replace(/[#*_|>`]/g, " ").split(/\s+/))
      .filter((word) => /[\p{L}\p{N}]/u.test(word));
  }

  /** A valid output for `schema` shaped like a long answer, with `body` words in its free text. */
  function longOutput(schema: OutputSchema, refs: SourceRefs, words: string[], body: number): DraftOutput {
    let next = 0;
    const take = (count: number) =>
      Array.from({ length: Math.max(1, Math.ceil(count)) }, () => words[next++ % words.length]).join(" ");
    const sources = refs.map((ref) => ({ deliverable: ref, detail: take(15) }));
    const values: Record<OutputSchema, () => unknown> = {
      section_draft: () => ({
        title: take(8),
        summary: take(60),
        body_markdown: Array.from({ length: 4 }, () => `### ${take(5)}\n\n${take(body / 4)}`).join("\n\n"),
        recommendations: Array.from({ length: 4 }, () => take(25)),
        sources,
      }),
      executive_summary: () => ({
        summary: `${take(body / 2)}\n\n${take(body / 2)}`,
        key_points: Array.from({ length: 5 }, () => take(20)),
        sources,
      }),
      recommendations: () => ({
        introduction: take(35),
        recommendations: Array.from({ length: 8 }, (_, index) => ({
          title: take(7),
          rationale: take(body / 8),
          priority: index < 3 ? "haute" : "moyenne",
          priority_reason: take(20),
          sources: refs.slice(0, 2),
        })),
        sources,
      }),
      data_analysis: () => ({
        summary: take(60),
        observations: Array.from({ length: 10 }, () => ({
          label: take(5),
          detail: take(body / 10),
          sources: refs.slice(0, 1),
        })),
        limits: Array.from({ length: 4 }, () => take(18)),
        sources,
      }),
    };
    const output = parseDraftOutput(schema, refs, values[schema]());
    if (!output) throw new Error(`the ${schema} sample does not fit its schema`);
    return output;
  }

  for (const key of TEMPLATE_KEYS) {
    it(`${key}: leaves room for its longest accepted answer`, () => {
      const template = templates.get(key);
      if (!template) throw new Error(`no template ${key}`);
      const own = cases.filter((value) => value.template === key);
      const longest = own.reduce((a, b) => (b.reference.words.max > a.reference.words.max ? b : a));
      const target = longest.reference.words.max;
      const names = expectedRefs(longest);
      const refs = [...names.keys()].slice(0, 3) as unknown as SourceRefs;
      const words = corpus(own);

      // Grow the free text until the Markdown a reader gets has the target length.
      let body = 0;
      let output = longOutput(template.outputSchema, refs, words, body);
      let count = countWords(draftToMarkdown(output, names));
      while (count < target) {
        body += Math.max(1, Math.floor((target - count) / 2));
        output = longOutput(template.outputSchema, refs, words, body);
        count = countWords(draftToMarkdown(output, names));
      }
      const tokens = estimateTokens(JSON.stringify(output.value));
      expect(template.maxOutputTokens).toBeGreaterThanOrEqual(Math.ceil(tokens * MARGIN));
    });
  }

  it("leaves room in the window for the answer and the thinking", () => {
    for (const template of templates.values()) {
      const output = template.maxOutputTokens + settings.draftThinking.tokens;
      const budget = contextBudget({
        contextWindowTokens: settings.contextWindowTokens,
        maxOutputTokens: output,
        maxInputTokens: settings.maxInputTokens,
      });
      // The whole window minus the answer: a section can hold some 800,000 tokens of deliverables.
      expect(budget.maxInputTokens, template.key).toBeGreaterThan(800_000);
      expect(budget.maxInputTokens + output, template.key).toBeLessThan(settings.contextWindowTokens);
    }
  });
});
