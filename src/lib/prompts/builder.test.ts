import { describe, expect, it } from "vitest";
import {
  BUILDER_LENGTHS,
  BUILDER_LIMITS,
  BUILDER_MISSING,
  BUILDER_TONES,
  builderAnswersSchema,
  builderFieldErrors,
  buildTemplate,
  DEFAULT_BUILDER_ANSWERS,
  headingLines,
  neutralizeText,
  wellFormed,
  type BuilderAnswers,
} from "./builder";
import { OUTPUT_SCHEMAS, PROMPT_LIMITS } from "./catalog";
import { promptVersionSchema } from "./schema";
import { checkTemplate } from "./template";

const ANSWERS: BuilderAnswers = {
  ...DEFAULT_BUILDER_ANSWERS,
  title: "Diagnostic du réseau d'eau",
  content: "Présenter l'état du réseau, les fuites relevées et les zones les plus touchées.",
  headings: "Contexte\n- Constats\n2. Zones prioritaires",
};

/** The editor's check on a first version, as the server runs it. */
function saves(built: ReturnType<typeof buildTemplate>) {
  return promptVersionSchema(true).safeParse({
    title: built.title,
    description: built.description,
    template: built.template,
    outputSchema: built.outputSchema,
    modelTier: "standard",
    temperature: "",
    maxOutputTokens: "",
    changelog: "",
    publish: false,
  });
}

describe("buildTemplate", () => {
  it("writes a template in the style of the global ones, with the section's variables", () => {
    const built = buildTemplate(ANSWERS);
    expect(built.title).toBe("Diagnostic du réseau d'eau");
    expect(built.outputSchema).toBe("section_draft");
    expect(built.template.startsWith("Tu rédiges une section d'un rapport d'expertise, en français.")).toBe(
      true,
    );
    expect(checkTemplate(built.template)).toEqual({
      variables: ["report_title", "report_context", "section_title", "section_instructions", "deliverables"],
      unknown: [],
      unclosed: false,
    });
    expect(built.template).toContain(
      "Contenu attendu :\nPrésenter l'état du réseau, les fuites relevées et les zones les plus touchées.",
    );
    expect(built.template).toContain(
      "Organise ta réponse avec ces intertitres, dans cet ordre :\n- Contexte\n- Constats\n- Zones prioritaires",
    );
    expect(built.template).toContain("N'invente aucun chiffre, aucune date ni aucun nom");
    expect(built.template).toContain("cite le fichier d'où il vient");
    expect(saves(built).success).toBe(true);
  });

  it("lets the AI choose the headings when none are given", () => {
    const built = buildTemplate({ ...ANSWERS, headings: "  \n" });
    expect(built.template).toContain("Organise ta réponse avec des intertitres si le contenu le demande.");
    expect(built.template).not.toContain("dans cet ordre");
  });

  it("follows the tone, the length and what to do when a deliverable is missing", () => {
    const built = buildTemplate({
      ...ANSWERS,
      tone: "pedagogique",
      length: "longue",
      missing: "a_completer",
    });
    expect(built.template).toContain("lecteur qui n'est pas spécialiste");
    expect(built.template).toContain("Vise environ 1 200 mots.");
    expect(built.template).toContain("« [À compléter : ce qui manque] »");
    expect(buildTemplate({ ...ANSWERS, missing: "lister" }).template).toContain("« Points à compléter »");
    expect(buildTemplate({ ...ANSWERS, length: "courte" }).template).toContain("Vise environ 300 mots.");
  });

  it("opens with the type of result and adds its own rule", () => {
    expect(buildTemplate({ ...ANSWERS, outputSchema: "executive_summary" }).template).toMatch(
      /^Tu rédiges le résumé exécutif[\s\S]*trois à cinq points clés/,
    );
    expect(buildTemplate({ ...ANSWERS, outputSchema: "recommendations" }).template).toMatch(
      /^Tu formules les recommandations[\s\S]*priorité \(haute, moyenne ou basse\)/,
    );
    expect(buildTemplate({ ...ANSWERS, outputSchema: "data_analysis" }).template).toMatch(
      /^Tu analyses les données chiffrées[\s\S]*avec leur unité/,
    );
  });

  it("never turns the manager's text into a variable", () => {
    const built = buildTemplate({
      ...ANSWERS,
      content: "Citer {{client}} et {{ deliverables }}, puis {{{report_title}}} et {{ sans fin",
      headings: "Partie {{section_title}}\n}}{{",
    });
    const check = checkTemplate(built.template);
    expect(check.unknown).toEqual([]);
    expect(check.unclosed).toBe(false);
    // Each real variable appears once, where the builder puts it.
    expect(built.template.match(/\{\{deliverables\}\}/g)).toHaveLength(1);
    expect(built.template.match(/\{\{report_title\}\}/g)).toHaveLength(1);
    expect(built.template.match(/\{\{section_title\}\}/g)).toHaveLength(1);
    expect(built.template).toContain("Citer { {client} } et { { deliverables } }");
    expect(built.template).toContain("- Partie { {section_title} }");
    expect(saves(built).success).toBe(true);
  });

  it("drops control and invisible characters, the NUL Postgres refuses included", () => {
    const built = buildTemplate({
      ...ANSWERS,
      title: "  Note\u0000 de​  cadrage ",
      content: "Ligne\u0007 un\r\n\r\n\r\n\r\nLigne deux‮",
    });
    expect(built.title).toBe("Note de cadrage");
    expect(built.template).toContain("Contenu attendu :\nLigne un\n\nLigne deux");
    expect(built.template).not.toMatch(/[\u0000\u0007​‮\r]/);
  });

  it("derives a short description from the first line of the content", () => {
    expect(buildTemplate(ANSWERS).description).toBe(
      "Présenter l'état du réseau, les fuites relevées et les zones les plus touchées.",
    );
    const long = "Mot ".repeat(200);
    const description = buildTemplate({ ...ANSWERS, content: long }).description;
    expect([...description].length).toBeLessThanOrEqual(BUILDER_LIMITS.descriptionMax);
    expect(description.endsWith("…")).toBe(true);
  });

  it("gives a valid template for every choice, within the limits", () => {
    const longest: BuilderAnswers = {
      ...ANSWERS,
      title: "T".repeat(PROMPT_LIMITS.titleMax),
      content: "{".repeat(BUILDER_LIMITS.contentMax),
      headings: Array.from({ length: BUILDER_LIMITS.headingsMax }, () =>
        "}".repeat(BUILDER_LIMITS.headingMax),
      ).join("\n"),
    };
    for (const outputSchema of OUTPUT_SCHEMAS)
      for (const tone of BUILDER_TONES)
        for (const length of BUILDER_LENGTHS)
          for (const missing of BUILDER_MISSING) {
            const built = buildTemplate({ ...longest, outputSchema, tone, length, missing });
            const check = checkTemplate(built.template);
            expect(check.unknown).toEqual([]);
            expect(check.unclosed).toBe(false);
            expect(check.variables).toContain("deliverables");
            expect([...built.template].length).toBeLessThan(PROMPT_LIMITS.templateMax);
            expect(saves(built).success).toBe(true);
          }
  });
});

describe("builderAnswersSchema", () => {
  it("accepts the answers of the form", () => {
    expect(builderAnswersSchema.safeParse(ANSWERS).success).toBe(true);
  });

  it("names the field and the problem", () => {
    const parsed = builderAnswersSchema.safeParse({
      ...ANSWERS,
      title: " x​ ",
      content: "Court",
      headings: Array.from({ length: BUILDER_LIMITS.headingsMax + 1 }, (_, index) => `Partie ${index}`).join(
        "\n",
      ),
      tone: "joyeux",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(builderFieldErrors(parsed.error)).toEqual({
      title: "titleLength",
      content: "contentLength",
      headings: "headingsTooMany",
      tone: "invalidChoice",
    });
  });

  it("refuses a heading that is too long and content past the limit", () => {
    const parsed = builderAnswersSchema.safeParse({
      ...ANSWERS,
      content: "a".repeat(BUILDER_LIMITS.contentMax + 1),
      headings: "b".repeat(BUILDER_LIMITS.headingMax + 1),
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(builderFieldErrors(parsed.error)).toEqual({ content: "contentLength", headings: "headingLength" });
  });
});

describe("helpers", () => {
  it("reads one heading per line, without list marks", () => {
    expect(headingLines("- Contexte\n\n* Constats\n• Suite\n1) Un\n2. Deux\n  ")).toEqual([
      "Contexte",
      "Constats",
      "Suite",
      "Un",
      "Deux",
    ]);
  });

  it("splits every double brace", () => {
    expect(neutralizeText("{{{{a}}}}")).toBe("{ { { {a} } } }");
    expect(checkTemplate(neutralizeText("{{x}} {{ y {{z")).variables).toEqual([]);
    expect(neutralizeText("{a} {b}")).toBe("{a} {b}");
  });
});

describe("wellFormed", () => {
  it("replaces lone surrogates without toWellFormed, as old Safari lacks it", () => {
    const proto = String.prototype as { toWellFormed?: () => string };
    const native = proto.toWellFormed;
    const text = "a\ud800b\udc00c😀d\ud83d";
    const expected = "a\ufffdb\ufffdc😀d\ufffd";
    expect(wellFormed(text)).toBe(expected);
    delete proto.toWellFormed;
    try {
      expect(wellFormed(text)).toBe(expected);
      expect(neutralizeText("Titre\ud800 {{client}}")).toBe("Titre\ufffd { {client} }");
    } finally {
      proto.toWellFormed = native;
    }
  });
});
