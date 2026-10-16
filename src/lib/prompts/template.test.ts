import { describe, expect, it } from "vitest";
import { approximatePages, approximateWords } from "./catalog";
import { checkTemplate, renderTemplate, templateKeyFromTitle } from "./template";

describe("checkTemplate", () => {
  it("lists the known variables once, in order of first use", () => {
    expect(checkTemplate("{{section_title}} puis {{ deliverables }} et {{section_title}}")).toEqual({
      variables: ["section_title", "deliverables"],
      unknown: [],
      unclosed: false,
    });
  });

  it("lists unknown names once", () => {
    expect(checkTemplate("{{client}} {{ client }} {{}} {{Section_Title}}").unknown).toEqual([
      "client",
      "",
      "Section_Title",
    ]);
  });

  it("flags braces that never close", () => {
    expect(checkTemplate("Bonjour {{section_title}} et {{report_title")).toEqual({
      variables: ["section_title"],
      unknown: [],
      unclosed: true,
    });
  });

  it("trims only spaces, tabs and line breaks around a name, like the database", () => {
    expect(checkTemplate("{{\t section_title \n}}").variables).toEqual(["section_title"]);
    expect(checkTemplate("{{\u00a0section_title}}").unknown).toEqual(["\u00a0section_title"]);
  });

  it("reads three braces as an unknown name", () => {
    expect(checkTemplate("{{{section_title}}}").unknown).toEqual(["{section_title"]);
  });

  it("accepts a template without variables", () => {
    expect(checkTemplate("Texte libre, sans accolades.")).toEqual({
      variables: [],
      unknown: [],
      unclosed: false,
    });
  });

  it("cuts a long unknown name to 40 characters", () => {
    expect(checkTemplate(`{{${"x".repeat(100)}}}`).unknown).toEqual(["x".repeat(40)]);
  });

  it("stays linear on many braces", () => {
    const start = performance.now();
    checkTemplate("{{".repeat(200_000));
    checkTemplate("{{a}}".repeat(200_000));
    expect(performance.now() - start).toBeLessThan(5000);
  });
});

describe("renderTemplate", () => {
  it("replaces variables, spaces in the braces included", () => {
    expect(
      renderTemplate("Section {{ section_title }} du rapport {{report_title}}", {
        section_title: "Bilan",
        report_title: "Audit",
      }),
    ).toBe("Section Bilan du rapport Audit");
  });

  it("leaves a missing value empty and unknown names as written", () => {
    expect(renderTemplate("[{{deliverables}}] {{client}}", {})).toBe("[] {{client}}");
  });

  it("never reads placeholders inside an inserted value", () => {
    expect(
      renderTemplate("{{deliverables}} / {{section_title}}", {
        deliverables: "{{section_title}}",
        section_title: "Titre",
      }),
    ).toBe("{{section_title}} / Titre");
  });

  it("keeps text after braces that never close", () => {
    expect(renderTemplate("{{section_title}} et {{fin", { section_title: "A" })).toBe("A et {{fin");
  });
});

describe("templateKeyFromTitle", () => {
  it.each([
    ["Résumé exécutif", "resume-executif"],
    ["Analyse  de   données (2026) !", "analyse-de-donnees-2026"],
    ["Cœur du rapport", "coeur-du-rapport"],
    ["--Déjà--", "deja"],
    ["!!!", "modele"],
    ["", "modele"],
  ])("turns %j into %j", (title, key) => {
    expect(templateKeyFromTitle(title)).toBe(key);
  });

  it("stops at a word boundary within 60 characters", () => {
    const key = templateKeyFromTitle("recommandations ".repeat(10));
    expect(key.length).toBeLessThanOrEqual(60);
    expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(key.endsWith("recommandations")).toBe(true);
  });
});

describe("approximateWords", () => {
  it("turns tokens into words and pages for the hints", () => {
    expect(approximateWords(4096)).toBe(2450);
    expect(approximateWords(256)).toBe(150);
    expect(approximateWords(10)).toBe(50);
    expect(approximatePages(2450)).toBe(5);
    expect(approximatePages(150)).toBe(1);
  });
});
