import { describe, expect, it } from "vitest";
import { OUTPUT_SCHEMAS } from "@/lib/prompts/catalog";
import { sampleOutput } from "./mock";
import { partialDraftMarkdown } from "./preview";
import { draftToMarkdown, parseDraftOutput, type DraftOutput, type SourceRefs } from "./schemas";

const refs: SourceRefs = ["L1", "L2"];
const names = new Map([
  ["L1", "Rapport d'étude.docx"],
  ["L2", "Consommations_2025.xlsx"],
]);

function checked(schema: DraftOutput["schema"], value: unknown): DraftOutput {
  const output = parseDraftOutput(schema, refs, value);
  if (!output) throw new Error(`invalid sample for ${schema}`);
  return output;
}

describe("partialDraftMarkdown", () => {
  it.each(OUTPUT_SCHEMAS)("gives draftToMarkdown's text for a complete %s", (schema) => {
    const value = sampleOutput(schema, refs);
    expect(partialDraftMarkdown(schema, value, names)).toBe(draftToMarkdown(checked(schema, value), names));
  });

  it("matches draftToMarkdown on untrimmed text, newlines in items and names to escape", () => {
    const value = {
      title: " Titre ",
      summary: "  Résumé avec espaces.  ",
      key_findings: ["Constat\nsur deux lignes", " Autre constat "],
      body_markdown: "\n### Contexte\n\nTexte.\n",
      recommendations: [],
      sources: [{ deliverable: "L2", detail: " Tableau des consommations. " }],
    };
    const odd = new Map([
      ["L1", "a.docx"],
      ["L2", "bilan_*final*.xlsx"],
    ]);
    expect(partialDraftMarkdown("section_draft", value, odd)).toBe(
      draftToMarkdown(checked("section_draft", value), odd),
    );
  });

  it("matches draftToMarkdown for recommendations with an empty introduction", () => {
    const value = { ...sampleOutput("recommendations", refs), introduction: "  " };
    expect(partialDraftMarkdown("recommendations", value, names)).toBe(
      draftToMarkdown(checked("recommendations", value), names),
    );
  });

  it("returns an empty text before anything arrived", () => {
    for (const schema of OUTPUT_SCHEMAS) {
      expect(partialDraftMarkdown(schema, undefined, names)).toBe("");
      expect(partialDraftMarkdown(schema, {}, names)).toBe("");
    }
  });

  it("ignores values that aren't objects", () => {
    for (const value of [null, "texte", 42, true, ["a"]]) {
      expect(partialDraftMarkdown("section_draft", value, names)).toBe("");
    }
  });

  it("shows a string cut in the middle", () => {
    expect(partialDraftMarkdown("section_draft", { title: "Bilan", summary: "Le siège consom" }, names)).toBe(
      "**Résumé.** Le siège consom",
    );
  });

  it("skips missing fields and keeps the order of the final text", () => {
    const markdown = partialDraftMarkdown(
      "section_draft",
      { key_findings: ["Premier constat"], body_markdown: "### Contexte\n\nDébut du" },
      names,
    );
    expect(markdown).toBe("### Points clés\n\n- Premier constat\n\n### Contexte\n\nDébut du");
  });

  it("ignores fields of the wrong type", () => {
    const markdown = partialDraftMarkdown(
      "section_draft",
      {
        summary: 12,
        key_findings: "pas une liste",
        body_markdown: { text: "objet" },
        recommendations: [null, 3, "Vérifier les relevés", { text: "objet" }, ""],
        sources: "L1",
      },
      names,
    );
    expect(markdown).toBe("### Recommandations\n\n- Vérifier les relevés");
  });

  it("lists sources partly filled", () => {
    const markdown = partialDraftMarkdown(
      "executive_summary",
      {
        summary: "Synthèse.",
        key_points: ["Un point"],
        sources: [
          { deliverable: "L1", detail: "Constats" },
          { deliverable: "L2" },
          { detail: "Sans réf" },
          {},
          5,
        ],
      },
      names,
    );
    expect(markdown).toBe(
      [
        "Synthèse.",
        "### Points clés\n\n- Un point",
        "### Sources\n\n- Rapport d'étude.docx : Constats\n- Consommations\\_2025.xlsx\n- Sans réf",
      ].join("\n\n"),
    );
  });

  it("shows a ref the names don't know as is", () => {
    const markdown = partialDraftMarkdown(
      "executive_summary",
      { sources: [{ deliverable: "L", detail: "x" }] },
      names,
    );
    expect(markdown).toBe("### Sources\n\n- L : x");
  });

  it("builds recommendations partly filled, keeping their numbers", () => {
    const markdown = partialDraftMarkdown(
      "recommendations",
      {
        introduction: "Trois mesures.",
        recommendations: [
          {
            title: "Confirmer les données",
            rationale: "Chiffres à vérifier.",
            priority: "haute",
            priority_reason: "Le reste en dépend.",
            sources: ["L1", "L2"],
          },
          "pas un objet",
          { title: "Régler les brûleurs", rationale: "Deux pics en fév", priority: "moy" },
          { priority: "basse", priority_reason: "Peu urgent." },
          {},
        ],
      },
      names,
    );
    expect(markdown).toBe(
      [
        "Trois mesures.",
        "### 1. Confirmer les données\n\nChiffres à vérifier.\n\n*Priorité haute.* Le reste en dépend.\n\nSources : Rapport d'étude.docx, Consommations\\_2025.xlsx",
        "### 3. Régler les brûleurs\n\nDeux pics en fév",
        "*Priorité basse.* Peu urgent.",
      ].join("\n\n"),
    );
  });

  it("doesn't take inherited names for a priority", () => {
    const markdown = partialDraftMarkdown(
      "recommendations",
      { recommendations: [{ title: "Titre", priority: "toString" }] },
      names,
    );
    expect(markdown).toBe("### 1. Titre");
  });

  it("builds observations partly filled", () => {
    const markdown = partialDraftMarkdown(
      "data_analysis",
      {
        summary: "Valeurs stables.",
        observations: [
          { label: "Tendance", detail: "Hausse de 3 %.", sources: ["L2"] },
          { label: "Pics" },
          { detail: "Sans intitulé" },
          {},
          null,
        ],
        limits: ["Février manque", 7],
      },
      names,
    );
    expect(markdown).toBe(
      [
        "Valeurs stables.",
        "### Observations\n\n- **Tendance.** Hausse de 3 %. (Consommations\\_2025.xlsx)\n- **Pics.**\n- Sans intitulé",
        "### Limites des données\n\n- Février manque",
      ].join("\n\n"),
    );
  });

  it("skips the observations heading while none has text", () => {
    expect(partialDraftMarkdown("data_analysis", { summary: "Début", observations: [{}] }, names)).toBe(
      "Début",
    );
  });

  it("never throws on odd input", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const odd: unknown[] = [
      cyclic,
      { summary: Symbol("x") },
      { recommendations: [{ sources: [1, null, "L1"] }] },
      { observations: "texte", sources: [{ deliverable: 4, detail: [] }] },
      Object.create(null),
    ];
    for (const schema of OUTPUT_SCHEMAS) {
      for (const value of odd) expect(() => partialDraftMarkdown(schema, value, names)).not.toThrow();
    }
  });
});
