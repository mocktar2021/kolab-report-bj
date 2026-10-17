// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { zip } from "../deliverables/parse/test-zip";
import { readErrorKey, readPlanFile } from "./read";

// The sample plans of tests/fixtures/plans, read as the worker reads them.
// make-fixtures.py there builds them.

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/plans/${name}`, import.meta.url)));

async function planOf(format: "docx" | "txt" | "md", name: string) {
  const result = await readPlanFile(format, fixture(name));
  if (result.kind !== "plan") throw new Error("expected a plan");
  return result.plan;
}

async function errorOf(work: Promise<unknown>): Promise<string> {
  return work.then(
    () => "no error",
    (error: unknown) => readErrorKey(error),
  );
}

describe("readPlanFile on Word files", () => {
  it("reads the heading styles of a French Word file, its title and footnotes left out", async () => {
    const plan = await planOf("docx", "tdr-titres.docx");
    expect(plan).toEqual({
      source: "headings",
      truncated: false,
      items: [
        {
          title: "Contexte et justification",
          level: 1,
          instructions: "La commune produit 300 tonnes de déchets par jour.",
        },
        { title: "Objectifs de l'étude", level: 1, instructions: "Cette partie présente les objectifs." },
        { title: "Objectif général", level: 2, instructions: "Rappeler l'objectif général en une phrase." },
        {
          title: "Objectifs spécifiques",
          level: 2,
          instructions:
            "Lister les objectifs spécifiques :\n\n- évaluer la collecte ;\n- proposer un plan d'action.",
        },
        { title: "Méthodologie", level: 1, instructions: "" },
        {
          title: "Livrables attendus",
          level: 1,
          instructions: "Un rapport provisoire puis un rapport final.",
        },
      ],
    });
  });

  it("reads styles named Titre 1 and Titre 2", async () => {
    const plan = await planOf("docx", "tdr-styles-nommes.docx");
    expect(plan?.items.map((item) => [item.level, item.title])).toEqual([
      [1, "Présentation du projet"],
      [2, "Zone d'intervention"],
      [1, "Résultats attendus"],
    ]);
    expect(plan?.items[0]?.instructions).toBe("Le projet couvre trois communes.");
  });

  it("reads typed numbers when the file has no heading style", async () => {
    const plan = await planOf("docx", "tdr-numerote.docx");
    expect(plan?.source).toBe("numbers");
    expect(plan?.items.map((item) => [item.level, item.title])).toEqual([
      [1, "CONTEXTE"],
      [1, "OBJECTIFS DE LA MISSION"],
      [2, "Objectif général"],
      [2, "Objectifs spécifiques"],
      [1, "MÉTHODOLOGIE"],
      [2, "Revue documentaire"],
      [2, "Entretiens"],
      [1, "CALENDRIER"],
    ]);
    expect(plan?.items[3]?.instructions).toBe(
      "Le consultant devra notamment :\n\n1. analyser les données de suivi ;\n\n2. rencontrer les bénéficiaires ;",
    );
  });

  it("refuses a file that is not a Word document", async () => {
    expect(await errorOf(readPlanFile("docx", fixture("tdr.md")))).toBe("unreadable");
    const notWord = zip([{ name: "bonjour.txt", data: new TextEncoder().encode("bonjour") }]);
    expect(await errorOf(readPlanFile("docx", notWord))).toBe("unreadable");
  });
});

describe("readPlanFile on text", () => {
  it("reads Markdown headings under a title", async () => {
    const plan = await planOf("md", "tdr.md");
    expect(plan?.items).toEqual([
      { title: "Contexte", level: 1, instructions: "Le programme couvre douze communes." },
      { title: "Objectifs", level: 1, instructions: "" },
      { title: "Objectif général", level: 2, instructions: "Mesurer l'avancement." },
      {
        title: "Objectifs spécifiques",
        level: 2,
        instructions:
          "- Vérifier les indicateurs.\n- Recueillir l'avis des usagers.\n\nIndicateurs suivis\n\nTaux d'accès à l'eau potable.",
      },
      { title: "Livrables", level: 1, instructions: "" },
    ]);
  });

  it("reads numbered lines of a Windows-1252 text file", async () => {
    const plan = await planOf("txt", "tdr.txt");
    expect(plan?.items.map((item) => [item.level, item.title])).toEqual([
      [1, "Contexte"],
      [1, "Objectifs"],
      [2, "Objectif général"],
      [2, "Objectifs spécifiques"],
      [1, "Méthodologie"],
      [2, "Collecte des données"],
      [2, "Analyse"],
      [1, "Profil du consultant"],
    ]);
    expect(plan?.items[3]?.instructions).toBe(
      "Les objectifs sont :\n1. former les membres ;\n2. équiper les ateliers.",
    );
    expect(plan?.items[6]?.instructions).toBe("2024. Une enquête de référence a eu lieu.");
  });

  it("answers nothing found for text without structure", async () => {
    const result = await readPlanFile("txt", new TextEncoder().encode("Juste une phrase."));
    expect(result).toEqual({ kind: "plan", plan: null });
  });
});

describe("readPlanFile on PDF", () => {
  it("gives the text of every page", async () => {
    const result = await readPlanFile("pdf", fixture("tdr.pdf"));
    expect(result).toMatchObject({ kind: "pdf", pages: 2, truncated: false });
    if (result.kind !== "pdf") return;
    expect(result.text.split("\n")).toEqual([
      "TERMES DE RÉFÉRENCE",
      "Évaluation du programme d'alphabétisation",
      "1. Contexte",
      "Le programme touche 12 000 adultes dans l'Atacora.",
      "2. Objectifs",
      "2.1 Objectif général",
      "Mesurer les acquis des apprenants.",
      "",
      "2.2 Objectifs spécifiques",
      "3. Méthodologie",
      "Enquête auprès de 600 apprenants.",
      "4. Livrables",
    ]);
  });

  it("says when a PDF can't be read", async () => {
    expect(await errorOf(readPlanFile("pdf", new TextEncoder().encode("%PDF-1.4\nrien")))).toBe("unreadable");
  });
});
