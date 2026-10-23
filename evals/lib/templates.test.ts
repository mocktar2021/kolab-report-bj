// @vitest-environment node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadGlobalTemplates,
  MIGRATIONS_DIR,
  parseTemplates,
  promptVersion,
  templateFromFile,
  type EvalTemplate,
} from "./templates";

function migration(name: string): EvalTemplate[] {
  return parseTemplates(
    readFileSync(join(resolve(MIGRATIONS_DIR), name), "utf8"),
    `${MIGRATIONS_DIR}/${name}`,
  );
}

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

  it("picks up the raised output caps of KRB-184, with the text of version 1", () => {
    const seeded = new Map(
      migration("20261013210100_global_prompt_templates.sql").map((template) => [template.key, template]),
    );
    const raised = migration("20261015120000_prompt_output_caps.sql");
    expect(raised.map((template) => [template.key, template.maxOutputTokens])).toEqual([
      ["resume-executif", 2048],
      ["recommandations", 4096],
    ]);
    for (const template of raised) {
      const before = seeded.get(template.key);
      if (!before) throw new Error(`no version 1 of ${template.key}`);
      expect(template.maxOutputTokens).toBeGreaterThan(before.maxOutputTokens);
      // Same text (so the same prompt version), title, schema, tier and temperature.
      expect({ ...template, maxOutputTokens: before.maxOutputTokens, source: before.source }).toEqual(before);
      expect(templates.get(template.key)).toEqual(template);
    }
  });

  it("picks up the section template of KRB-224: new text, same settings", () => {
    const seeded = migration("20261013210100_global_prompt_templates.sql").find(
      (template) => template.key === "synthese-section",
    );
    const [structured, ...others] = migration("20261022220000_synthese_section_structure.sql");
    if (!seeded || !structured) throw new Error("missing synthese-section");
    expect(others).toEqual([]);
    expect(structured.version).not.toBe(seeded.version);
    expect(structured.text).toContain("Dis chaque constat une seule fois");
    expect(structured.text).toContain("Vise 200 à 500 mots");
    // Title, schema, tier, temperature and output cap are those of version 1.
    expect({ ...structured, text: seeded.text, version: seeded.version, source: seeded.source }).toEqual(
      seeded,
    );
  });

  it("picks up the data analysis template of KRB-224: new text, same settings", () => {
    const seeded = migration("20261013210100_global_prompt_templates.sql").find(
      (template) => template.key === "analyse-donnees",
    );
    const [structured, ...others] = migration("20261023100000_analyse_donnees_structure.sql");
    if (!seeded || !structured) throw new Error("missing analyse-donnees");
    expect(others).toEqual([]);
    expect(templates.get("analyse-donnees")).toEqual(structured);
    expect(structured.version).not.toBe(seeded.version);
    expect(structured.text).toContain("Dis chaque chiffre une seule fois");
    expect(structured.text).toContain("trois limites au plus");
    expect(structured.text).toContain("Vise 250 à 400 mots");
    // Title, schema, tier, temperature and output cap are those of version 1.
    expect({ ...structured, text: seeded.text, version: seeded.version, source: seeded.source }).toEqual(
      seeded,
    );
  });

  it("picks up the section template without key points (KRB-224): new text, same settings", () => {
    const [before] = migration("20261022220000_synthese_section_structure.sql");
    const [latest, ...others] = migration("20261023130000_synthese_section_without_key_points.sql");
    if (!before || !latest) throw new Error("missing synthese-section");
    expect(others).toEqual([]);
    expect(templates.get("synthese-section")).toEqual(latest);
    expect(latest.version).not.toBe(before.version);
    expect(latest.text).not.toContain("points clés");
    expect(latest.text).toContain("Le résumé dit l'essentiel en deux ou trois phrases");
    expect(latest.text).toContain("Vise 200 à 500 mots");
    // Title, schema, tier, temperature and output cap are those of version 2.
    expect({ ...latest, text: before.text, version: before.version, source: before.source }).toEqual(before);
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
