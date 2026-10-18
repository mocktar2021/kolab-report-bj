// @vitest-environment node
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildReportDocx } from "./docx";
import { EXPORT_LIMITS } from "./markdown";
import { FRENCH_SAMPLE, SAMPLE_DOCUMENT } from "./test-document";
import { JPEG_4X2, pngImage, withExifOrientation } from "./test-images";
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

describe("buildReportDocx with images (KRB-216)", () => {
  const PHOTO = "0b6f5e1c-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
  const DIAGRAM = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  const GONE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const ref = (id: string, caption: string) => `![${caption}](/api/deliverables/${id}/file)`;

  function document(markdown: string, images: ExportDocument["images"]): ExportDocument {
    return {
      ...SAMPLE_DOCUMENT,
      sections: [{ title: "Constats", status: "in_progress", assigneeName: null, markdown }],
      images,
    };
  }

  async function media(doc: ExportDocument) {
    const zip = await JSZip.loadAsync(await buildReportDocx(doc));
    return Object.keys(zip.files).filter((name) => name.startsWith("word/media/"));
  }

  it("embeds the images in word/media with their caption in italics under them", async () => {
    const png = pngImage(1200, 600);
    const doc = document(
      `Relevé :\n\n${ref(DIAGRAM, "Schéma de la toiture")}\n\n${ref(PHOTO, "Façade nord")}`,
      new Map([
        [DIAGRAM, { status: "ready", format: "png", data: png, width: 1200, height: 600, orientation: 1 }],
        [PHOTO, { status: "ready", format: "jpeg", data: JPEG_4X2, width: 4, height: 2, orientation: 1 }],
      ]),
    );
    const files = await media(doc);
    expect(files.filter((name) => name.endsWith(".png"))).toHaveLength(1);
    expect(files.filter((name) => name.endsWith(".jpg"))).toHaveLength(1);
    const { document: xml, relationships } = await parts(doc);
    expect(relationships.match(/relationships\/image"/g)).toHaveLength(2);
    expect(xml.match(/<pic:pic\b/g)).toHaveLength(2);
    expect(xml).toContain('descr="Schéma de la toiture"');
    expect(text(xml)).toMatch(/Relevé :\n(?:.*\n)?Schéma de la toiture/);
    expect(xml).toMatch(/<w:i\/>(?:(?!<\/w:r>).)*<w:t[^>]*>Façade nord<\/w:t>/);
    // The diagram is scaled down to the width of the text, 9638 twips: 642 pixels, 6 116 350 EMU.
    const [cx, cy] = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)][0]!.slice(1).map(Number);
    expect(cx).toBe(Math.round(((11906 - 2 * 1134) / 15) * 9525));
    expect(cx! / cy!).toBeCloseTo(2, 2);
    // The 4 by 2 photo is not blown up.
    expect(xml).toContain('<wp:extent cx="38100" cy="19050"/>');
  });

  it("turns a photo the way its Exif orientation says, since Word does not", async () => {
    const jpeg = withExifOrientation(JPEG_4X2, 6);
    const { document: xml } = await parts(
      document(
        ref(PHOTO, "Portrait"),
        new Map([
          [PHOTO, { status: "ready", format: "jpeg", data: jpeg, width: 4, height: 2, orientation: 6 }],
        ]),
      ),
    );
    expect(xml).toMatch(/<a:xfrm rot="5400000"/);
    // The frame keeps the stored sides: 4 wide, 2 high.
    expect(xml).toContain('<wp:extent cx="38100" cy="19050"/>');
  });

  it("shows the caption and why when an image is not there", async () => {
    const doc = document(
      `${ref(GONE, "Plan disparu")}\n\n${ref(PHOTO, "Photo lourde")}\n\n${ref(DIAGRAM, "")}`,
      new Map([
        [PHOTO, { status: "tooLarge" }],
        [DIAGRAM, { status: "limit" }],
      ]),
    );
    expect(await media(doc)).toEqual([]);
    const body = text((await parts(doc)).document);
    expect(body).toContain("Plan disparu (image indisponible)");
    expect(body).toContain("Photo lourde (image trop lourde pour l'export)");
    expect(body).toContain("(image non reprise : l'export a atteint sa limite d'images)");
  });

  it("never draws an image of another address", async () => {
    const doc = document("![Pixel](https://evil.example/p.png)", new Map());
    expect(await media(doc)).toEqual([]);
    expect(text((await parts(doc)).document)).toContain("Pixel");
  });
});
