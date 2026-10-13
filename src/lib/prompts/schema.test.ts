import { describe, expect, it } from "vitest";
import { promptFieldErrors, promptVersionSchema, type PromptVersionInput } from "./schema";

const VALID: PromptVersionInput = {
  title: "  Synthèse maison  ",
  description: "",
  template: "Rédige {{section_title}} à partir de {{deliverables}}.",
  outputSchema: "section_draft",
  modelTier: "standard",
  temperature: "",
  maxOutputTokens: "",
  changelog: "",
  publish: true,
};

function errors(input: Partial<PromptVersionInput>, isFirstVersion = true) {
  const result = promptVersionSchema(isFirstVersion).safeParse({ ...VALID, ...input });
  return result.success ? {} : promptFieldErrors(result.error);
}

describe("promptVersionSchema", () => {
  it("trims text and turns empty optional fields into null", () => {
    expect(promptVersionSchema(true).parse(VALID)).toEqual({
      ...VALID,
      title: "Synthèse maison",
      description: null,
      temperature: null,
      maxOutputTokens: null,
      changelog: null,
    });
  });

  it("reads a temperature with a comma and a token count as text", () => {
    const parsed = promptVersionSchema(true).parse({ ...VALID, temperature: "0,4", maxOutputTokens: "2048" });
    expect(parsed.temperature).toBe(0.4);
    expect(parsed.maxOutputTokens).toBe(2048);
  });

  it.each([
    [{ title: "A" }, { title: "titleLength" }],
    [{ description: "x".repeat(501) }, { description: "descriptionLength" }],
    [{ template: "   " }, { template: "templateEmpty" }],
    [{ template: "x".repeat(20_001) }, { template: "templateLength" }],
    [{ template: "{{section_title" }, { template: "templateUnclosed" }],
    [{ template: "{{client}}" }, { template: "templateUnknown" }],
    [{ outputSchema: "poeme" as never }, { outputSchema: "outputSchema" }],
    [{ modelTier: "gpt" as never }, { modelTier: "modelTier" }],
    [{ temperature: "1,5" }, { temperature: "temperatureRange" }],
    [{ temperature: "chaud" }, { temperature: "temperatureRange" }],
    [{ maxOutputTokens: "100" }, { maxOutputTokens: "maxOutputTokensRange" }],
    [{ maxOutputTokens: "1000.5" }, { maxOutputTokens: "maxOutputTokensRange" }],
    [{ changelog: "x".repeat(501) }, { changelog: "changelogLength" }],
  ] satisfies [Partial<PromptVersionInput>, object][])("refuses %j", (input, expected) => {
    expect(errors(input)).toEqual(expected);
  });

  it("refuses NUL characters, which Postgres can't store", () => {
    expect(errors({ title: "Titre\u0000" })).toEqual({ title: "invalidCharacters" });
    expect(errors({ template: "{{section_title}}\u0000" })).toEqual({ template: "invalidCharacters" });
  });

  it("counts a title in characters, as Postgres does", () => {
    expect(errors({ title: "😀" })).toEqual({ title: "titleLength" });
    expect(errors({ title: "😀😀" })).toEqual({});
  });

  it("reads a blank or null number as no value", () => {
    const parsed = promptVersionSchema(true).parse({ ...VALID, temperature: "   ", maxOutputTokens: null });
    expect(parsed.temperature).toBeNull();
    expect(parsed.maxOutputTokens).toBeNull();
  });

  it("asks for a changelog from the second version on", () => {
    expect(errors({ changelog: "  " }, false)).toEqual({ changelog: "changelogRequired" });
    expect(errors({ changelog: "Ton plus direct" }, false)).toEqual({});
    expect(errors({ changelog: "" }, true)).toEqual({});
  });
});
