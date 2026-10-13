// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadGlobalTemplates, parseTemplates, promptVersion, templateFromFile } from "./templates";

describe("global templates", () => {
  const templates = loadGlobalTemplates();

  it("reads the four templates from the migrations", () => {
    expect([...templates.keys()].sort()).toEqual([
      "analyse-donnees",
      "recommandations",
      "resume-executif",
      "synthese-section",
    ]);
    const synthese = templates.get("synthese-section");
    expect(synthese).toMatchObject({
      outputSchema: "section_draft",
      tier: "standard",
      temperature: 0.3,
      maxOutputTokens: 4096,
    });
    expect(synthese?.text).toContain("{{deliverables}}");
    expect(synthese?.text.startsWith("Tu rédiges une section")).toBe(true);
    expect(templates.get("resume-executif")?.title).toBe("Résumé exécutif");
  });

  it("gives each text a stable 8-character version", () => {
    expect(promptVersion("abc")).toBe("ba7816bf");
    for (const template of templates.values()) expect(template.version).toMatch(/^[0-9a-f]{8}$/);
  });

  it("keeps the last version of a key", () => {
    const sql = (text: string) =>
      `insert into public.prompt_library values (null, 'cle', 'Titre d''essai', 'Desc', $tpl$${text}$tpl$, '[]', 'section_draft', 'fast', 0.20, 1024, 'x');`;
    const [first] = parseTemplates(sql("v1"), "a.sql");
    const [second] = parseTemplates(sql("v2"), "b.sql");
    expect(first).toMatchObject({
      key: "cle",
      title: "Titre d'essai",
      text: "v1",
      tier: "fast",
      maxOutputTokens: 1024,
    });
    expect(second?.version).toBe(promptVersion("v2"));
  });

  it("replaces the text of a template from a prompt file", () => {
    const base = templates.get("synthese-section");
    if (!base) throw new Error("missing template");
    const replaced = templateFromFile(base, "Nouveau texte {{deliverables}}", "nouveau.txt");
    expect(replaced).toMatchObject({ key: base.key, outputSchema: base.outputSchema, source: "nouveau.txt" });
    expect(replaced.version).not.toBe(base.version);
  });
});
