import { describe, expect, it } from "vitest";
import { toWinAnsi } from "./winansi";

describe("toWinAnsi", () => {
  it("keeps French text whole", () => {
    const french = "Œuvre « été » à 12 € \u2013 déjà ; l’œil, Ÿ, ç, ù, æ, “guillemets”, … 1\u00a0000 °C";
    expect(toWinAnsi(french)).toBe(french);
  });

  it("maps spaces and dashes the fonts lack to their nearest form", () => {
    expect(toWinAnsi("12\u202f000\u2009€ \u2011 a\u2212b")).toBe("12\u00a0000 € - a-b");
  });

  it("recomposes accents and splits ligatures", () => {
    expect(toWinAnsi("été ﬁn ő")).toBe("été fin o");
  });

  it("draws other characters as one question mark each", () => {
    expect(toWinAnsi("ok 👍🏽 报告 Ω")).toBe("ok ?? ?? ?");
  });

  it("drops zero-width characters", () => {
    expect(toWinAnsi("a\u200bb\ufeffc\u200dd")).toBe("abcd");
  });
});
