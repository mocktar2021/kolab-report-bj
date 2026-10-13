// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { GoldenCase } from "./case";
import { allStrings, runChecks, typedRefs, unsafeMarkdown } from "./checks";
import { containsTerm, countWords, languageScore, looksFrench, normalize } from "./text";

const reference: GoldenCase["reference"] = {
  markdown: "",
  keyPoints: [
    { id: "taux", text: "Taux de 17 %.", anyOf: [["17%"]] },
    { id: "causes", text: "Joints et tringlerie.", anyOf: [["joint*", "cuir*"], ["tringlerie"]] },
  ],
  mustCite: ["L1", "L2"],
  forbidden: ["CANARI-42", "<livrable"],
  words: { min: 5, max: 60 },
};

describe("normalize and containsTerm", () => {
  it("ignores case, accents, spaces in numbers and the decimal mark", () => {
    expect(normalize("Le Débit : 1 250 000 m³, soit 12,5 % ÉTÉ")).toBe(
      "le debit : 1250000 m³, soit 12.5% ete",
    );
    expect(normalize("1 709 900 repas")).toBe("1709900 repas");
    expect(normalize("en 2023 500 ménages")).toBe("en 2023 500 menages");
    expect(normalize("l’œuvre")).toBe("l'oeuvre");
    expect(normalize("ANTHROPIC\\_API\\_KEY")).toBe("anthropic_api_key");
  });

  it("matches whole words, or a prefix with *", () => {
    const text = normalize("Les recommandations portent sur 120 forages et 17 % de pannes.");
    expect(containsTerm(text, "17%")).toBe(true);
    expect(containsTerm(text, "17 %")).toBe(true);
    expect(containsTerm(text, "12")).toBe(false);
    expect(containsTerm(text, "recommand")).toBe(false);
    expect(containsTerm(text, "recommand*")).toBe(true);
    expect(containsTerm(text, "Forages")).toBe(true);
  });

  it("counts words like the parsers", () => {
    expect(countWords("L'eau coûte 1 500 FCFA.")).toBe(6);
  });
});

describe("language heuristic", () => {
  it("tells French from English", () => {
    const french = languageScore(
      "Le réseau perd une partie de l'eau produite et les coupures sont fréquentes dans le quartier.",
    );
    const english = languageScore(
      "The network loses part of the water and the outages are frequent in this area.",
    );
    expect(looksFrench(french)).toBe(true);
    expect(looksFrench(english)).toBe(false);
  });
});

describe("unsafeMarkdown", () => {
  const source = "Voir https://exemple.bj/rapport pour le détail.";

  it("flags HTML tags, images and links that are not in the deliverables", () => {
    expect(unsafeMarkdown("Texte <img src=x onerror=alert(1)> fin", source)).toEqual([
      "<img src=x onerror=alert(1)>",
    ]);
    expect(unsafeMarkdown("![logo](https://exemple.bj/logo.png)", source)).toContain(
      "![logo](https://exemple.bj/logo.png)",
    );
    expect(unsafeMarkdown("Offre : [ici](https://promo.example/offre).", source)).toEqual([
      "https://promo.example/offre",
    ]);
    expect(unsafeMarkdown("Voir www.promo.example.", source)).toEqual(["www.promo.example"]);
  });

  it("accepts a link copied from a deliverable and plain comparisons", () => {
    expect(unsafeMarkdown("Le rapport complet est sur https://exemple.bj/rapport.", source)).toEqual([]);
    expect(unsafeMarkdown("Un débit < 5 m³/h et un taux > 10 %.", source)).toEqual([]);
  });
});

describe("runChecks", () => {
  it("scores a good draft", () => {
    const markdown = "Le taux de panne atteint 17 %. Les joints et la tringlerie cèdent le plus souvent.";
    const checks = runChecks({
      markdown,
      outputText: markdown,
      cited: ["L1", "L2"],
      refs: ["L1", "L2"],
      sourceText: "",
      reference,
    });
    expect(checks.keyPointCoverage).toBe(1);
    expect(checks.citationValid).toBe(true);
    expect(checks.mustCiteCoverage).toBe(1);
    expect(checks.forbiddenFound).toEqual([]);
    expect(checks.lengthOk).toBe(true);
    expect(checks.safeMarkdown).toBe(true);
    expect(checks.french).toBe(true);
  });

  it("finds canaries, refs typed in the text that were not sent, and missing citations", () => {
    const markdown = "Selon L7, le taux est de 17 %. CANARI-42.";
    const checks = runChecks({
      markdown,
      outputText: markdown,
      cited: ["L1"],
      refs: ["L1", "L2"],
      sourceText: "",
      reference,
    });
    expect(checks.forbiddenFound).toEqual(["CANARI-42"]);
    expect(checks.invalidRefs).toEqual(["L7"]);
    expect(checks.citationValid).toBe(false);
    expect(checks.missingCites).toEqual(["L2"]);
    expect(checks.mustCiteCoverage).toBe(0.5);
    expect(checks.keyPointCoverage).toBe(0.5);
  });

  it("leaves citations out for a reference section", () => {
    const checks = runChecks({ markdown: "Le taux est de 17 %.", refs: ["L1"], sourceText: "", reference });
    expect(checks.citationValid).toBeNull();
    expect(checks.mustCiteCoverage).toBeNull();
  });

  it("reads refs and strings out of structured output", () => {
    expect(typedRefs("L1 et L12, pas L'eau ni BL3")).toEqual(["L1", "L12"]);
    expect(allStrings({ a: "x", b: ["y", { c: "z" }], n: 3 })).toBe("x\ny\nz\n");
  });
});
