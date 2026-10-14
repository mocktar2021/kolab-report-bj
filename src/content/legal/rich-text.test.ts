import { describe, expect, it } from "vitest";
import { linkTarget, parseRichText } from "./rich-text";

describe("parseRichText", () => {
  it("keeps plain text as one token", () => {
    expect(parseRichText("Mocktar Technologies édite KolabReport.")).toEqual([
      { kind: "text", text: "Mocktar Technologies édite KolabReport." },
    ]);
  });

  it("finds links, bold and code between plain text", () => {
    expect(
      parseRichText("Voir les [CGU](/cgu#contenus), le cookie `kr-espace` et **Supabase Inc.** ici."),
    ).toEqual([
      { kind: "text", text: "Voir les " },
      { kind: "link", text: "CGU", href: "/cgu#contenus" },
      { kind: "text", text: ", le cookie " },
      { kind: "code", text: "kr-espace" },
      { kind: "text", text: " et " },
      { kind: "strong", text: "Supabase Inc." },
      { kind: "text", text: " ici." },
    ]);
  });

  it("reads a mark at the start and at the end of the string", () => {
    expect(parseRichText("**Compte** : voir [apdp.bj](https://apdp.bj)")).toEqual([
      { kind: "strong", text: "Compte" },
      { kind: "text", text: " : voir " },
      { kind: "link", text: "apdp.bj", href: "https://apdp.bj" },
    ]);
  });

  it("leaves unfinished marks as text", () => {
    expect(parseRichText("un [lien](sans fin et **gras")).toEqual([
      { kind: "text", text: "un [lien](sans fin et **gras" },
    ]);
  });

  it("returns no token for an empty string", () => {
    expect(parseRichText("")).toEqual([]);
  });
});

describe("linkTarget", () => {
  it("reads a page path with or without an anchor", () => {
    expect(linkTarget("/cgv")).toEqual({ kind: "page", path: "/cgv", hash: null });
    expect(linkTarget("/cgv#remboursement")).toEqual({ kind: "page", path: "/cgv", hash: "remboursement" });
  });

  it("reads an anchor on the same page", () => {
    expect(linkTarget("#cookies")).toEqual({ kind: "anchor", hash: "cookies" });
  });

  it("accepts https and mailto links", () => {
    expect(linkTarget("https://apdp.bj")).toEqual({ kind: "external", href: "https://apdp.bj" });
    expect(linkTarget("mailto:support@mocktar.com")).toEqual({
      kind: "external",
      href: "mailto:support@mocktar.com",
    });
  });

  it("refuses anything else", () => {
    for (const href of ["http://example.com", "javascript:alert(1)", "//example.com", "#", "cgu"]) {
      expect(linkTarget(href), href).toBeNull();
    }
  });
});
