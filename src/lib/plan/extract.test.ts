// @vitest-environment node
import { describe, expect, it } from "vitest";
import { linesFromDocxHtml } from "./docx";
import { extractPlan, finishPlan } from "./extract";
import { linesFromText } from "./lines";
import { parseNumbering, romanValue } from "./numbering";
import { cleanInstructions, cleanTitle, plainInline } from "./text";

const plan = (text: string) => extractPlan(linesFromText(text));

/** "1 Contexte", "2 Objectif général"... with each item's level, for short assertions. */
const outline = (text: string) => plan(text)?.items.map((item) => `${item.level} ${item.title}`);

describe("parseNumbering", () => {
  it.each([
    ["1. Contexte", "decimal", [1], "."],
    ["12) Contexte", "decimal", [12], ")"],
    ["3 - Contexte", "decimal", [3], "-"],
    ["2.1 Objectif", "dotted", [2, 1], ""],
    ["2.1. Objectif", "dotted", [2, 1], ""],
    ["1.2.3 Détail", "dotted", [1, 2, 3], ""],
    ["IV. Calendrier", "upper-roman", [4], "."],
    ["xii) Annexe", "lower-roman", [12], ")"],
    ["B. Entretiens", "upper-letter", [2], "."],
    ["c) Suivi", "lower-letter", [3], ")"],
  ])("reads %s", (line, family, values, delimiter) => {
    expect(parseNumbering(line)).toMatchObject({ family, values, delimiter });
  });

  it("knows a single I, V or X can be a Roman numeral", () => {
    expect(parseNumbering("I. Contexte")).toMatchObject({
      family: "upper-letter",
      values: [9],
      romanValue: 1,
    });
    expect(parseNumbering("A. Contexte")).toMatchObject({ romanValue: null });
  });

  it.each([
    "2024. Le projet a démarré.",
    "1.Contexte",
    "Contexte",
    "CV. Joindre le CV",
    "Il. faut",
    "1.",
    "",
  ])("finds no number in %j", (line) => {
    expect(parseNumbering(line)).toBeNull();
  });

  it("reads Roman numerals", () => {
    expect([romanValue("I"), romanValue("IX"), romanValue("XIV"), romanValue("XL")]).toEqual([1, 9, 14, 40]);
    expect([romanValue("IIII"), romanValue("VX"), romanValue("CV"), romanValue("")]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("text cleaning", () => {
  it("drops Markdown marks and escapes but keeps underscores inside words", () => {
    expect(plainInline("**Gras**, *italique*, `code`, ~~barré~~ et [lien](https://exemple.bj)")).toBe(
      "Gras, italique, code, barré et lien",
    );
    expect(plainInline("rapport_final_v2.docx et __souligné__")).toBe("rapport_final_v2.docx et souligné");
    expect(plainInline("1\\. Contexte \\*")).toBe("1. Contexte *");
  });

  it("gives titles without their number, colon or closing hashes", () => {
    expect(cleanTitle("  1.2 **Objectifs**   spécifiques : ")).toBe("Objectifs spécifiques");
    expect(cleanTitle("II - Méthodologie ##")).toBe("Méthodologie");
    expect(cleanTitle("Chapitre 1 : Contexte")).toBe("Chapitre 1 : Contexte");
    expect(cleanTitle("Zéro\u0000​ caractère caché")).toBe("Zéro caractère caché");
  });

  it("cuts long titles and instructions at a space", () => {
    const title = cleanTitle(`${"mot ".repeat(80)}fin`);
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title).toMatch(/mot…$/);
    const instructions = cleanInstructions("phrase ".repeat(1000));
    expect(instructions.length).toBeLessThanOrEqual(4000);
    expect(instructions.endsWith(" […]")).toBe(true);
    expect(cleanTitle("😀".repeat(150)).length).toBeLessThanOrEqual(200);
  });

  it("keeps one blank line between paragraphs of instructions", () => {
    expect(cleanInstructions("\n\nUn.\n\n\n\nDeux.  \n")).toBe("Un.\n\nDeux.");
  });
});

describe("extractPlan with Markdown headings", () => {
  it("makes # sections and ## subsections, with the text under them as instructions", () => {
    const result = plan(`Préambule ignoré.

# Contexte
Le projet couvre **douze** communes.

Deuxième paragraphe.

## Historique
- Phase 1
- Phase 2

# Méthode
### Détail en dessous
Texte du détail.
`);
    expect(result).toEqual({
      source: "headings",
      truncated: false,
      items: [
        {
          title: "Contexte",
          level: 1,
          instructions: "Le projet couvre douze communes.\n\nDeuxième paragraphe.",
        },
        { title: "Historique", level: 2, instructions: "- Phase 1\n- Phase 2" },
        { title: "Méthode", level: 1, instructions: "Détail en dessous\nTexte du détail." },
      ],
    });
  });

  it("starts from the shallowest level present and leaves out a lone title on top", () => {
    expect(
      outline(`# Termes de référence
## 1. Contexte
### 1.1 Historique
#### Détail
## 2. Méthode`),
    ).toEqual(["1 Contexte", "2 Historique", "1 Méthode"]);
  });

  it("reads underlined headings", () => {
    expect(outline("Contexte\n========\nTexte.\n\nObjectifs\n---------\n\nMéthode\n========")).toEqual([
      "1 Contexte",
      "2 Objectifs",
      "1 Méthode",
    ]);
  });

  it("ignores headings inside code blocks", () => {
    expect(outline("# Plan\n\n```\n# pas un titre\n```\n\n# Suite")).toEqual(["1 Plan", "1 Suite"]);
  });
});

describe("extractPlan with numbered lines", () => {
  it("reads 1. and 1.1, and keeps a list that restarts at 1 in the instructions", () => {
    const result = plan(`TERMES DE REFERENCE

1. Contexte
Le projet accompagne 40 coopératives.

2. Objectifs
2.1 Objectif général
2.2 Objectifs spécifiques
Les objectifs sont :
1. former les membres ;
2. équiper les ateliers.

3. Méthodologie
2024. Une enquête de référence a eu lieu.
`);
    expect(result?.source).toBe("numbers");
    expect(result?.items).toEqual([
      { title: "Contexte", level: 1, instructions: "Le projet accompagne 40 coopératives." },
      { title: "Objectifs", level: 1, instructions: "" },
      { title: "Objectif général", level: 2, instructions: "" },
      {
        title: "Objectifs spécifiques",
        level: 2,
        instructions: "Les objectifs sont :\n1. former les membres ;\n2. équiper les ateliers.",
      },
      { title: "Méthodologie", level: 1, instructions: "2024. Une enquête de référence a eu lieu." },
    ]);
  });

  it("takes the first kind of number for sections and the next one for subsections", () => {
    expect(
      outline(`I. CONTEXTE
II. OBJECTIFS
A. Objectif général
B. Objectifs spécifiques
1. Premier point
2. Second point
C. Résultats
III. MÉTHODOLOGIE
A. Revue documentaire
IV. CALENDRIER
V. BUDGET`),
    ).toEqual([
      "1 CONTEXTE",
      "1 OBJECTIFS",
      "2 Objectif général",
      "2 Objectifs spécifiques",
      "2 Résultats",
      "1 MÉTHODOLOGIE",
      "2 Revue documentaire",
      "1 CALENDRIER",
      "1 BUDGET",
    ]);
  });

  it("tells a C after B from a Roman C, and an I after H from a Roman I", () => {
    expect(outline("A. Un\nB. Deux\nC. Trois\nD. Quatre")).toEqual(["1 Un", "1 Deux", "1 Trois", "1 Quatre"]);
    expect(outline("F. Six\nG. Sept\nH. Huit\nI. Neuf\nJ. Dix")).toHaveLength(5);
  });

  it("puts 1.1 under 1. even when another list comes first", () => {
    expect(
      outline(`1. Contexte
a) premier point
b) second point
2. Objectifs
2.1 Général
3.1 Mal placé
2.2 Spécifiques`),
    ).toEqual(["1 Contexte", "1 Objectifs", "2 Général", "2 Spécifiques"]);
  });

  it("reads a) and indented numbers as subsections", () => {
    expect(outline("1) Un\n   a) Sous un\n   b) Sous deux\n2) Deux")).toEqual([
      "1 Un",
      "2 Sous un",
      "2 Sous deux",
      "1 Deux",
    ]);
    expect(outline("1. Un\n   1. Sous un\n   2. Sous deux\n2. Deux")).toEqual([
      "1 Un",
      "2 Sous un",
      "2 Sous deux",
      "1 Deux",
    ]);
  });

  it("does not take sentences for titles", () => {
    expect(plan("1. Le consultant remet le rapport ;\n2. Il le présente,")).toBeNull();
    expect(plan(`1. ${"Une phrase très longue ".repeat(10)}`)).toBeNull();
  });

  it("reads bold numbered lines", () => {
    expect(outline("**1. Contexte**\nTexte.\n**2. Objectifs**")).toEqual(["1 Contexte", "1 Objectifs"]);
  });
});

describe("extractPlan choosing between headings and numbers", () => {
  it("uses numbered lines when headings only give the document's title", () => {
    expect(outline("# Termes de référence\n\n1. Contexte\n2. Objectifs\n2.1 Général")).toEqual([
      "1 Contexte",
      "1 Objectifs",
      "2 Général",
    ]);
  });

  it("uses headings when there are at least three", () => {
    expect(outline("# Un\n1. a\n2. b\n3. c\n4. d\n# Deux\n# Trois")).toEqual(["1 Un", "1 Deux", "1 Trois"]);
  });

  it("finds nothing in plain prose", () => {
    expect(plan("Bonjour,\n\nVoici le texte de la mission, sans titres ni numéros.")).toBeNull();
    expect(plan("")).toBeNull();
  });
});

describe("extractPlan limits", () => {
  it("keeps the first 200 items", () => {
    const text = Array.from({ length: 250 }, (_, index) => `# Titre ${index + 1}`).join("\n");
    const result = plan(text);
    expect(result?.items).toHaveLength(200);
    expect(result?.truncated).toBe(true);
    expect(result?.items.at(-1)?.title).toBe("Titre 200");
  });
});

describe("extractPlan on Word lines", () => {
  it("reads numbered Word lists as sections and subsections", () => {
    const html =
      "<p>Préambule</p><ol><li>Contexte<ol><li>Historique</li><li>Enjeux</li></ol></li></ol>" +
      "<p>Texte sous les enjeux.</p><ul><li>une puce</li></ul><ol><li>Méthode</li></ol>" +
      '<p>Note<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup></p>' +
      '<ol><li id="footnote-1"><p>Texte de la note <a href="#footnote-ref-1">↑</a></p></li></ol>';
    expect(extractPlan(linesFromDocxHtml(html))?.items).toEqual([
      { title: "Contexte", level: 1, instructions: "" },
      { title: "Historique", level: 2, instructions: "" },
      { title: "Enjeux", level: 2, instructions: "Texte sous les enjeux.\n\n- une puce" },
      { title: "Méthode", level: 1, instructions: "Note" },
    ]);
  });

  it("keeps table rows in the instructions", () => {
    const html = "<h1>Livrables</h1><table><tr><td>Rapport</td><td>J+30</td></tr></table>";
    expect(extractPlan(linesFromDocxHtml(html))?.items[0]?.instructions).toBe("Rapport | J+30");
  });
});

describe("finishPlan", () => {
  it("makes the first item a section, drops empty titles and cleans the rest", () => {
    expect(
      finishPlan(
        [
          { title: "  ", level: 1, instructions: "perdu" },
          { title: "1.1 Objectifs", level: 2, instructions: null },
          { title: "**Méthode**", level: 2, instructions: "  Faire court.  " },
          { title: "Annexes", level: 3 },
        ],
        "ai",
      ),
    ).toEqual({
      source: "ai",
      truncated: false,
      items: [
        { title: "Objectifs", level: 1, instructions: "" },
        { title: "Méthode", level: 2, instructions: "Faire court." },
        { title: "Annexes", level: 1, instructions: "" },
      ],
    });
    expect(finishPlan([], "ai")).toBeNull();
  });
});
