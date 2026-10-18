// @vitest-environment node
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import messages from "../../../messages/fr.json";
import { exportChars } from ".";
import { annexChars, annexes } from "./annexes";
import { buildReportDocx } from "./docx";
import { UNKNOWN_MEMBER_LABEL } from "./labels";
import { buildReportPdf } from "./pdf";
import { pdfPageCount, pdfText, squash } from "./test-pdf-text";
import type { ExportDocument } from "./types";

// The "Annexes" page of the exports (KRB-215).

const DOC: ExportDocument = {
  title: "Audit du siège",
  workspaceName: "Cabinet Dossou & Associés",
  generatedAt: new Date("2026-10-14T09:30:00Z"),
  withAnnexes: true,
  sections: [
    {
      title: "Contexte",
      status: "completed",
      assigneeName: null,
      markdown: "Introduction du contexte.",
      // 23:30 UTC is already the next day in Porto-Novo (UTC+1).
      deliverables: [
        { fileName: "plan-du-site.pdf", addedBy: "Fatou Dossou", addedAt: new Date("2026-10-12T23:30:00Z") },
      ],
    },
    {
      title: "Objectifs",
      level: 2,
      status: "in_progress",
      assigneeName: null,
      markdown: null,
      deliverables: [
        { fileName: "relevés « été ».xlsx", addedBy: null, addedAt: new Date("2026-10-01T10:00:00Z") },
      ],
    },
    {
      title: "Diagnostic",
      status: "in_progress",
      assigneeName: null,
      markdown: "Mesures.",
      deliverables: [],
    },
    {
      title: "Recommandations",
      status: "not_started",
      assigneeName: null,
      markdown: null,
      deliverables: [
        { fileName: "devis.docx", addedBy: "Koffi Agbo", addedAt: new Date("2026-10-14T08:00:00Z") },
        { fileName: "photos.zip", addedBy: "Fatou Dossou", addedAt: new Date("2026-10-14T09:00:00Z") },
      ],
    },
  ],
};

const WITHOUT_OPTION: ExportDocument = { ...DOC, withAnnexes: false };

const WITHOUT_FILES: ExportDocument = {
  ...DOC,
  sections: DOC.sections.map((section) => ({ ...section, deliverables: [] })),
};

describe("annexes", () => {
  it("lists the sections with files in report order, numbered like the export", () => {
    expect(annexes(DOC)).toEqual([
      {
        title: "1. Contexte",
        files: [{ name: "plan-du-site.pdf", addedBy: "Fatou Dossou", addedOn: "13 octobre 2026" }],
      },
      {
        title: "1.1 Objectifs",
        files: [{ name: "relevés « été ».xlsx", addedBy: "Membre inconnu", addedOn: "1 octobre 2026" }],
      },
      {
        title: "3. Recommandations",
        files: [
          { name: "devis.docx", addedBy: "Koffi Agbo", addedOn: "14 octobre 2026" },
          { name: "photos.zip", addedBy: "Fatou Dossou", addedOn: "14 octobre 2026" },
        ],
      },
    ]);
  });

  it("is empty when the box is unticked or no section has a file", () => {
    expect(annexes(WITHOUT_OPTION)).toEqual([]);
    expect(annexes(WITHOUT_FILES)).toEqual([]);
    expect(annexes({ ...DOC, withAnnexes: undefined })).toEqual([]);
  });

  it("names an unknown uploader like the section page", () => {
    expect(UNKNOWN_MEMBER_LABEL).toBe(messages.Deliverables.unknownMember);
  });

  it("counts the file names toward the size limit only when they are listed", () => {
    const names = "plan-du-site.pdf".length + "relevés « été ».xlsx".length + "devis.docx".length;
    const people = "Fatou Dossou".length * 2 + "Koffi Agbo".length;
    expect(annexChars(DOC)).toBe(names + "photos.zip".length + people);
    expect(annexChars(WITHOUT_OPTION)).toBe(0);
    expect(exportChars(DOC) - exportChars(WITHOUT_OPTION)).toBe(annexChars(DOC));
  });
});

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The text of the runs, one line per paragraph or table cell. */
function docxText(xml: string): string {
  return xml
    .split(/<\/w:p>/)
    .map((paragraph) =>
      [...paragraph.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1] ?? "").join(""),
    )
    .join("\n")
    .replace(/&(amp|lt|gt|quot|apos);/g, (_entity, name: string) => ENTITIES[name] ?? "");
}

async function documentXml(doc: ExportDocument): Promise<string> {
  const zip = await JSZip.loadAsync(await buildReportDocx(doc));
  return (await zip.file("word/document.xml")?.async("string")) ?? "";
}

/** The text from the last `marker` on. */
function after(text: string, marker: string): string {
  const start = text.lastIndexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return text.slice(start);
}

function expectInOrder(text: string, parts: string[]) {
  const positions = parts.map((part) => text.indexOf(part));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

describe("buildReportDocx with annexes", () => {
  it("ends with an Annexes page listed in the contents, a table per section with files", async () => {
    const xml = await documentXml(DOC);
    // A Heading 1 on a new page, bookmarked for the contents entry.
    const heading = xml.split("</w:p>").find((paragraph) => paragraph.includes('w:name="annexes"')) ?? "";
    expect(heading).toContain('<w:pStyle w:val="Heading1"/>');
    expect(heading).toContain("<w:pageBreakBefore/>");
    expect(xml).toContain('w:anchor="annexes"');
    expect(xml.lastIndexOf('w:name="annexes"')).toBeGreaterThan(xml.lastIndexOf('w:name="section_4"'));

    const annexPart = docxText(xml.slice(xml.indexOf('w:name="annexes"')));
    expectInOrder(annexPart, [
      "1. Contexte",
      "Fichier",
      "Ajouté par",
      "Date d'ajout",
      "plan-du-site.pdf",
      "Fatou Dossou",
      "13 octobre 2026",
      "1.1 Objectifs",
      "relevés « été ».xlsx",
      "Membre inconnu",
      "1 octobre 2026",
      "3. Recommandations",
      "devis.docx",
      "photos.zip",
    ]);
    // A section without files is left out.
    expect(annexPart).not.toContain("Diagnostic");
    // One table per section listed, with its header row repeated on each page.
    expect(xml.match(/<w:tbl>/g)).toHaveLength(3);
    expect(xml.match(/<w:tblHeader\/>/g)).toHaveLength(3);
  });

  it("has no annexes when the box is unticked or no section has a file", async () => {
    for (const doc of [WITHOUT_OPTION, WITHOUT_FILES]) {
      const xml = await documentXml(doc);
      expect(xml).not.toContain('w:name="annexes"');
      expect(xml).not.toContain('w:anchor="annexes"');
      expect(docxText(xml)).not.toContain("Annexes");
      expect(docxText(xml)).not.toContain("Date d'ajout");
      expect(xml).not.toContain("<w:tbl>");
    }
    expect(docxText(await documentXml(WITHOUT_OPTION))).not.toContain("plan-du-site.pdf");
  });
});

describe("buildReportPdf with annexes", () => {
  it("ends with an Annexes page listed in the contents, a table per section with files", async () => {
    const pdf = await buildReportPdf(DOC);
    const text = squash(pdfText(pdf));
    // Cover, contents, the three sections (1.1 on the page of 1.), then the annexes.
    expect(pdfPageCount(pdf)).toBe(6);
    expect(text).toContain(squash("Page 6 sur 6"));
    const contents = text.slice(text.indexOf("Sommaire"), text.indexOf(squash("Introduction du contexte.")));
    expect(contents).toContain("Annexes");

    const annexPart = after(text, "Annexes");
    expectInOrder(
      annexPart,
      [
        "1. Contexte",
        "Fichier",
        "Ajouté par",
        "Date d'ajout",
        "plan-du-site.pdf",
        "Fatou Dossou",
        "13 octobre 2026",
        "1.1 Objectifs",
        "relevés « été ».xlsx",
        "Membre inconnu",
        "3. Recommandations",
        "devis.docx",
        "photos.zip",
      ].map(squash),
    );
    expect(annexPart).not.toContain("Diagnostic");
  });

  it("has no annexes when the box is unticked or no section has a file", async () => {
    for (const doc of [WITHOUT_OPTION, WITHOUT_FILES]) {
      const pdf = await buildReportPdf(doc);
      const text = squash(pdfText(pdf));
      expect(pdfPageCount(pdf)).toBe(5);
      expect(text).not.toContain("Annexes");
      expect(text).not.toContain(squash("Date d'ajout"));
    }
    expect(squash(pdfText(await buildReportPdf(WITHOUT_OPTION)))).not.toContain("plan-du-site.pdf");
  });

  it("splits a long list over several Pages, each starting with the table header", async () => {
    // Short words: react-pdf draws a hyphen where it cuts a long one.
    const files = Array.from({ length: 320 }, (_, index) => ({
      fileName: `Relevé de la campagne de mesures ${index}.pdf`,
      addedBy: "Fatou Dossou de la direction technique",
      addedAt: new Date("2026-10-12T10:00:00Z"),
    }));
    const pdf = await buildReportPdf({
      ...DOC,
      sections: [
        { title: "Mesures", status: "completed", assigneeName: null, markdown: null, deliverables: files },
      ],
    });
    const annexPart = after(squash(pdfText(pdf)), "Annexes");
    expect(annexPart).toContain(squash("Relevé de la campagne de mesures 0.pdf"));
    expect(annexPart).toContain(squash("Relevé de la campagne de mesures 319.pdf"));
    expect(annexPart.match(/Dated'ajout/g)?.length).toBeGreaterThan(1);
  }, 30_000);
});
