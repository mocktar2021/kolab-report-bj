import { describe, expect, it } from "vitest";
import { safeNextPath, withoutLocale } from "./redirect";

describe("safeNextPath", () => {
  it.each(["/fr/tableau-de-bord", "/fr/tableau-de-bord?statut=completed", "/"])(
    "keeps same-site path %s",
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    ["absolute URL", "https://evil.example/fr"],
    ["protocol-relative URL", "//evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["relative path", "fr/tableau-de-bord"],
    ["control character", "/fr\n/x"],
    ["empty string", ""],
  ])("rejects %s", (_label, path) => {
    expect(safeNextPath(path)).toBeNull();
  });

  it("rejects null, undefined and very long values", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(`/${"a".repeat(600)}`)).toBeNull();
  });
});

describe("withoutLocale", () => {
  it("drops the locale prefix", () => {
    expect(withoutLocale("/fr/tableau-de-bord?x=1")).toBe("/tableau-de-bord?x=1");
    expect(withoutLocale("/fr")).toBe("/");
  });

  it("leaves other paths alone", () => {
    expect(withoutLocale("/frites")).toBe("/frites");
    expect(withoutLocale("/tableau-de-bord")).toBe("/tableau-de-bord");
  });
});
