import { describe, expect, it } from "vitest";
import { foldForSearch } from "./search";

describe("foldForSearch", () => {
  it("drops accents and case", () => {
    expect(foldForSearch("Énergie Bénin")).toBe("energie benin");
    expect(foldForSearch("ÉTUDE D'IMPACT")).toBe("etude d'impact");
    expect(foldForSearch("Garçon, œuvre")).toBe("garcon, œuvre");
  });

  it("keeps text without accents as it is, in lowercase", () => {
    expect(foldForSearch("Audit Koffi 2026")).toBe("audit koffi 2026");
  });
});
