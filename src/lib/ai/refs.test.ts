import { describe, expect, it } from "vitest";
import { nameInlineRefs } from "./refs";

const names = new Map([
  ["L1", "rapport-provisoire-v1.pdf"],
  ["L2", "Consommations_2025.xlsx"],
]);

describe("nameInlineRefs", () => {
  it("turns a ref in parentheses into the file name", () => {
    expect(nameInlineRefs("Une faiblesse de la méthode (L1).", names)).toBe(
      "Une faiblesse de la méthode (rapport-provisoire-v1.pdf).",
    );
  });

  it("turns a group of refs into the file names, escaped and without repeats", () => {
    expect(nameInlineRefs("Deux sources (L1, L2) et (L2 ; L1 et L1).", names)).toBe(
      "Deux sources (rapport-provisoire-v1.pdf, Consommations\\_2025.xlsx) et (Consommations\\_2025.xlsx, rapport-provisoire-v1.pdf).",
    );
  });

  it("turns a ref in brackets into the file name in parentheses", () => {
    expect(nameInlineRefs("Le tableau de synthèse [L1].", names)).toBe(
      "Le tableau de synthèse (rapport-provisoire-v1.pdf).",
    );
  });

  it("replaces every group, in lists and across lines", () => {
    expect(nameInlineRefs("- Titres fonciers (L1).\n- Consommations ( L2 ).", names)).toBe(
      "- Titres fonciers (rapport-provisoire-v1.pdf).\n- Consommations (Consommations\\_2025.xlsx).",
    );
  });

  it("leaves a group with other words, an unknown ref or mismatched signs as written", () => {
    const text = "Voir (L1, tableau 3), (L9), (L1 ou L2), (L1] et [L2), (étudiants en L1) et L1 seul.";
    expect(nameInlineRefs(text, names)).toBe(text);
  });

  it("leaves a longer ref and a link text as written", () => {
    const text = "Lots (L12) et [L1](https://exemple.org).";
    expect(nameInlineRefs(text, names)).toBe(text);
  });

  it("leaves the text as it is without names", () => {
    expect(nameInlineRefs("Méthode (L1).", new Map())).toBe("Méthode (L1).");
  });
});
