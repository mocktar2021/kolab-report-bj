// @vitest-environment node
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildReportDocx } from "./docx";
import { EXPORT_LIMITS } from "./markdown";
import { FRENCH_SAMPLE, SAMPLE_DOCUMENT } from "./test-document";
import type { ExportDocument } from "./types";

// JSZip comes with the docx package.
async function parts(doc: ExportDocument) {
  const zip = await JSZip.loadAsync(await buildReportDocx(doc));
  const read = async (name: string) => {
    const file = zip.file(name);
    if (!file) throw new Error(`missing ${name}`);
    return file.async("string");
  };
  return {
    document: await read("word/document.xml"),
    relationships: await read("word/_rels/document.xml.rels"),
    settings: await read("word/settings.xml"),
    core: await read("docProps/core.xml"),
    numbering: await read("word/numbering.xml"),
    footer: (
      await Promise.all(
        Object.keys(zip.files)
          .filter((name) => /^word\/footer\d+\.xml$/.test(name))
          .map(read),
      )
    ).join(""),
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The text of the runs, one line per paragraph. */
function text(xml: string): string {
  return xml
    .split("</w:p>")
    .map((paragraph) =>
      [...paragraph.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:br\/>/g)]
        .map((match) => match[1] ?? "\n")
        .join(""),
    )
    .join("\n")
    .replace(/&(amp|lt|gt|quot|apos);/g, (_entity, name: string) => ENTITIES[name] ?? "");
}

describe("buildReportDocx", () => {
  it("writes the cover page, the sections and their meta line", async () => {
    const { document } = await parts(SAMPLE_DOCUMENT);
    const body = text(document);
    expect(body).toContain("Étude thermique : bâtiment « Les Palmiers »");
    expect(body).toContain("Cabinet Dossou & Associés");
    expect(body).toContain("Généré le 14 octobre 2026");
    for (const section of SAMPLE_DOCUMENT.sections) expect(body).toContain(section.title);
    expect(body).toContain("Responsable : Fatou Dossou · Statut : Terminée");
    expect(body).toContain("Responsable : Non attribuée · Statut : En cours");
    expect(body.match(/Section non rédigée\./g)).toHaveLength(2);
  });

  it("adds a Word table of contents, filled on open, that already lists the sections", async () => {
    const { document, settings } = await parts(SAMPLE_DOCUMENT);
    expect(document).toContain("TOC \\h \\o &quot;1-3&quot;");
    expect(document).toMatch(/<w:fldChar w:fldCharType="begin" w:dirty="true"\/>/);
    expect(settings).toMatch(/<w:updateFields(?: w:val="(?:true|1)")?\/>/);
    expect(text(document)).toMatch(/Sommaire\n(?:.*\n)?1\. Contexte et périmètre/);
    // Each cached entry links to the bookmark on its section heading.
    for (const anchor of ["section_1", "section_2", "section_3"]) {
      expect(document).toContain(`w:anchor="${anchor}"`);
      expect(document).toContain(`w:name="${anchor}"`);
    }
  });

  it("keeps French text and moves section headings one level down", async () => {
    const { document } = await parts(SAMPLE_DOCUMENT);
    expect(text(document)).toContain(`${FRENCH_SAMPLE}, coût 1 000,50 €.`);
    expect(document).toMatch(/<w:pStyle w:val="Heading2"\/>.*?Constats/);
    expect(document).toMatch(/<w:pStyle w:val="Heading3"\/>.*?Mesures/);
    expect(document).toMatch(/<w:pStyle w:val="Heading4"\/>.*?Étapes/);
  });

  it("writes links as text with their address, never as hyperlinks", async () => {
    const { document, relationships } = await parts(SAMPLE_DOCUMENT);
    const body = text(document);
    expect(body).toContain("rapport complet (https://exemple.bj/rapport)");
    expect(body).toContain("https://exemple.bj/annexe");
    expect(body).toContain("Plan du site");
    expect(body).not.toContain("plan.png");
    expect(body).toContain('<script>alert("x")</script>');
    expect(document).not.toMatch(/<w:hyperlink [^>]*r:id=/);
    expect(relationships).not.toContain("/hyperlink");
  });

  it("draws tables as Word tables with a bold header row", async () => {
    const { document } = await parts(SAMPLE_DOCUMENT);
    expect(document.match(/<w:tbl>/g)).toHaveLength(1);
    expect(document).toContain("<w:tblHeader/>");
    expect(document).toMatch(/<w:tc>.*?<w:b\/>.*?Zone/);
    expect(document).toMatch(/<w:jc w:val="center"\/>.*?24,5 °C/);
    expect(document).toMatch(/<w:jc w:val="right"\/>.*?60 %/);
  });

  it("numbers lists with Word numbering and nests them", async () => {
    const { document, numbering } = await parts(SAMPLE_DOCUMENT);
    expect(document).toMatch(/<w:ilvl w:val="1"\/>.*?Vitrages/);
    expect(numbering).toContain('<w:numFmt w:val="decimal"/>');
    expect(numbering).toContain('<w:numFmt w:val="bullet"/>');
    expect(text(document)).toContain("[x] Visite faite");
  });

  it("sets the properties, the header title and the page numbers", async () => {
    const { core, footer } = await parts(SAMPLE_DOCUMENT);
    expect(core).toContain("<dc:title>Étude thermique : bâtiment « Les Palmiers »</dc:title>");
    expect(core).toContain("<dc:creator>KolabReport</dc:creator>");
    expect(footer).toContain("PAGE");
    expect(footer).toContain("NUMPAGES");
    expect(footer).toContain("Page ");
    expect(footer).toContain(" sur ");
  });

  it("builds a report without sections", async () => {
    const { document } = await parts({ ...SAMPLE_DOCUMENT, sections: [] });
    expect(text(document)).toContain("Ce rapport ne contient aucune section.");
  });

  it("copes with a 500-column table, a list 50 levels deep and control characters", async () => {
    const columns = 500;
    const row = (cell: string) => `|${Array.from({ length: columns }, () => cell).join("|")}|`;
    const list = Array.from({ length: 50 }, (_, level) => `${"  ".repeat(level)}- niveau ${level}`).join(
      "\n",
    );
    const { document } = await parts({
      ...SAMPLE_DOCUMENT,
      title: "Rapport\u0000\u0007 limite",
      sections: [
        {
          title: "Limites\u0008",
          status: "in_progress",
          assigneeName: "A\u0000",
          markdown: [row("h"), row("-"), row("c"), "", list, "", "> ".repeat(60) + "citation"].join("\n"),
        },
      ],
    });
    expect(document.match(/<w:tc>/g)).toHaveLength(2 * EXPORT_LIMITS.tableColumns);
    expect(text(document)).toContain("niveau 49");
    expect(document).not.toMatch(/[\u0000-\u0008]/);
    expect(document).toContain("Rapport limite");
  });
});

describe("buildReportDocx with subsections (KRB-195)", () => {
  const nested: ExportDocument = {
    ...SAMPLE_DOCUMENT,
    sections: [
      { title: "Contexte", status: "completed", assigneeName: null, markdown: "Introduction." },
      {
        title: "Objectifs",
        level: 2,
        status: "in_progress",
        assigneeName: null,
        markdown: "# Cible\n\nMoins 12 %.",
      },
      { title: "Analyse", status: "not_started", assigneeName: null, markdown: null },
    ],
  };

  it("numbers sections and subsections and keeps a subsection on its section's page", async () => {
    const { document } = await parts(nested);
    const body = text(document);
    expect(body).toMatch(/1\. Contexte\n(?:.*\n)*1\.1 Objectifs\n(?:.*\n)*2\. Analyse/);
    const paragraphs = document.split("</w:p>");
    const heading = (title: string) =>
      paragraphs.findLast((paragraph) => text(paragraph).includes(title)) ?? "";
    expect(heading("1. Contexte")).toContain('<w:pStyle w:val="Heading1"/>');
    expect(heading("1. Contexte")).toContain("<w:pageBreakBefore/>");
    expect(heading("1.1 Objectifs")).toContain('<w:pStyle w:val="Heading2"/>');
    expect(heading("1.1 Objectifs")).not.toContain("<w:pageBreakBefore/>");
    // The # of a subsection's text is one level below its title.
    expect(paragraphs.find((paragraph) => text(paragraph).trim() === "Cible")).toContain(
      '<w:pStyle w:val="Heading3"/>',
    );
  });
});
