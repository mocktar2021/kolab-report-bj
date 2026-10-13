import { describe, expect, it } from "vitest";
import { wordCount, wordEditDistance } from "./metrics";

describe("wordEditDistance", () => {
  it("is zero for the same text", () => {
    expect(wordEditDistance("Le bâtiment consomme trop.", "Le bâtiment consomme trop.")).toBe(0);
  });

  it("counts a replaced word twice, once removed and once added", () => {
    expect(wordEditDistance("Le bâtiment consomme trop.", "Le bâtiment consomme peu.")).toBe(2);
  });

  it("counts added sentences word by word", () => {
    expect(wordEditDistance("Constat.", "Constat. Deux mots ajoutés ici.")).toBe(4);
  });

  it("ignores changes of spacing", () => {
    expect(wordEditDistance("Un  texte\nsur deux lignes", "Un texte sur deux lignes")).toBe(0);
  });

  it("counts every word when the text was rewritten from scratch", () => {
    const before = Array.from({ length: 3000 }, (_, index) => `a${index}`).join(" ");
    const after = Array.from({ length: 3000 }, (_, index) => `b${index}`).join(" ");
    expect(wordEditDistance(before, after)).toBe(6000);
  });
});

describe("wordCount", () => {
  it("splits on any blank", () => {
    expect(wordCount("  un\tdeux\ntrois  ")).toBe(3);
    expect(wordCount("")).toBe(0);
  });
});
