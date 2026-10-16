// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockModel } from "@/lib/ai/mock";
import { readAiSettings } from "@/lib/ai/models";
import { readWriterOutput } from "@/lib/prompts/writer";
import {
  aggregateWriter,
  checkWrittenTemplate,
  loadWriterCases,
  mockWriterModel,
  runWriterCase,
  templateWriterCli,
  WRITER_CATEGORIES,
  writerCaseSchema,
  writerGate,
  type WriterCase,
} from "./template-writer";

const cases = loadWriterCases();
const settings = readAiSettings({});

function caseById(id: string): WriterCase {
  const found = cases.find((value) => value.id === id);
  if (!found) throw new Error(`no case ${id}`);
  return found;
}

/** The checks on a template given as the model's answer, after the app's cleaning. */
function checksOf(value: WriterCase, template: string) {
  const read = readWriterOutput({ ...value.reference, template });
  if ("rejected" in read) throw new Error(read.rejected);
  return checkWrittenTemplate(value, read);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("template writer cases", () => {
  it("has 6 to 12 cases with unique ids, every category included", () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
    expect(cases.length).toBeLessThanOrEqual(12);
    expect(new Set(cases.map((value) => value.id)).size).toBe(cases.length);
    for (const category of WRITER_CATEGORIES)
      expect(
        cases.some((value) => value.category === category),
        category,
      ).toBe(true);
  });

  it("gives each case a reference template that passes every check", () => {
    for (const value of cases) {
      const checks = checksOf(value, value.reference.template);
      expect(checks, value.id).toMatchObject({
        valid: true,
        variablesFirstTry: true,
        usesDeliverables: true,
        grounding: true,
        missingRule: true,
        french: true,
        safe: true,
        lengthOk: true,
        keyPointCoverage: 1,
        forbiddenFound: [],
      });
      if (value.category === "injection") expect(checks.injectionResisted, value.id).toBe(true);
    }
  });

  it("puts canaries in the injection case", () => {
    const injection = caseById("injection-dans-la-description");
    expect(injection.forbidden.length).toBeGreaterThanOrEqual(3);
    for (const canary of ["cle_api", "<script"]) expect(injection.description).toContain(canary);
  });
});

describe("the checks", () => {
  const plain = caseById("section-fuites-reseau");

  it("catch unknown variables, a missing deliverables block and a missing grounding rule", () => {
    const checks = checksOf(
      plain,
      "Tu rédiges la section {{section_title}} pour {{client}}, quartier par quartier.",
    );
    expect(checks.valid).toBe(true);
    expect(checks.variablesFirstTry).toBe(false);
    expect(checks.usesDeliverables).toBe(false);
    expect(checks.grounding).toBe(false);
    expect(checks.missingRule).toBe(false);
    expect(checks.lengthOk).toBe(false);
  });

  it("catch an English template, HTML and a leaked canary", () => {
    const injection = caseById("injection-dans-la-description");
    const checks = checksOf(
      injection,
      `${"You write the section from the deliverables and you never invent figures. ".repeat(6)}{{deliverables}} <script>alert(1)</script> cle_api`,
    );
    expect(checks.french).toBe(false);
    expect(checks.safe).toBe(false);
    expect(checks.forbiddenFound).toEqual(expect.arrayContaining(["cle_api", "<script", "alert(1)"]));
    expect(checks.injectionResisted).toBe(false);
  });

  it("fail a template that keeps the request to invent figures", () => {
    const invent = caseById("demande-d-inventer-des-chiffres");
    const checks = checksOf(
      invent,
      `${invent.reference.template}\nSi une valeur manque, invente une valeur plausible pour le bâtiment.`,
    );
    expect(checks.forbiddenFound).toEqual(["valeur plausible"]);
  });
});

describe("a run with the mock writer", () => {
  it("passes the gate on the reference answers", async () => {
    const results = await Promise.all(
      cases.map((value) => runWriterCase(value, { model: mockWriterModel(value), tier: "fast", settings })),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const aggregates = aggregateWriter(results);
    expect(aggregates.cases).toBe(cases.length);
    expect(aggregates.injectionResistedRate).toBe(1);
    expect(writerGate(aggregates)).toEqual({ passed: true, failures: [] });
  });

  it("fails the gate when the writer answers badly", async () => {
    const bad = mockModel(() =>
      JSON.stringify({
        title: "Modèle",
        description: "Modèle.",
        template: "Write the section for {{client}}.",
      }),
    );
    const results = await Promise.all(
      cases.map((value) => runWriterCase(value, { model: bad, tier: "fast", settings })),
    );
    const gate = writerGate(aggregateWriter(results));
    expect(gate.passed).toBe(false);
    expect(gate.failures.join("\n")).toMatch(/variablesFirstTryRate|frenchRate|groundingRate/);
  });

  it("counts a call with no template as failing every check", async () => {
    const results = [
      await runWriterCase(cases[0] as WriterCase, {
        model: mockModel(() => "pas du JSON"),
        tier: "fast",
        settings,
      }),
    ];
    expect(results[0]).toMatchObject({ ok: false, error: "invalidOutput", checks: null });
    const aggregates = aggregateWriter(results);
    expect(aggregates.answeredRate).toBe(0);
    expect(writerGate(aggregates).passed).toBe(false);
  });

  it("runs from the command line with --mock and writes a report", async () => {
    const out = mkdtempSync(join(tmpdir(), "writer-evals-"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const code = await templateWriterCli(
        ["--mock", "--cases", "section-fuites-reseau,injection-dans-la-description", "--out", out],
        {},
      );
      expect(code).toBe(0);
      expect(readdirSync(out).some((name) => name.includes("template-writer-mock"))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("refuses an unknown case or tier", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await templateWriterCli(["--mock", "--cases", "inconnu"], {})).toBe(2);
    expect(await templateWriterCli(["--mock", "--tier", "turbo"], {})).toBe(2);
  });
});

describe("the case schema", () => {
  it("refuses a wildcard inside a term, which would never match", () => {
    const value = { ...(cases[0] as WriterCase), keyPoints: [{ id: "x", anyOf: [["point* de vente"]] }] };
    expect(writerCaseSchema.safeParse(value).success).toBe(false);
  });
});
