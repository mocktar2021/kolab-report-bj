// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Block } from "./markdown";
import { buildReportPdf, pageGroups } from "./pdf";
import { FRENCH_SAMPLE, SAMPLE_DOCUMENT } from "./test-document";
import { JPEG_4X2, pngImage, withExifOrientation } from "./test-images";
import { pdfText, squash } from "./test-pdf-text";
import type { ExportDocument } from "./types";

function expectText(pdf: Buffer, ...expected: string[]) {
  const text = squash(pdfText(pdf));
  for (const part of expected) expect(text).toContain(squash(part));
}

describe("buildReportPdf", () => {
  it("renders a PDF of a sensible size", async () => {
    const pdf = await buildReportPdf(SAMPLE_DOCUMENT);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(3_000);
    expect(pdf.length).toBeLessThan(200_000);
  });

  it("draws the cover, the contents, the sections and the footer in French", async () => {
    const pdf = await buildReportPdf(SAMPLE_DOCUMENT);
    expectText(
      pdf,
      "Cabinet Dossou & Associés",
      "Généré le 14 octobre 2026",
      "Sommaire",
      "1. Contexte et périmètre",
      "Responsable : Non attribuée · Statut : En cours",
      `${FRENCH_SAMPLE}, coût 1 000,50 €.`,
      "Page 3 sur 5",
    );
    expect(pdfText(pdf).match(/Section non rédigée\./g)).toHaveLength(2);
  });

  it("writes links as text with their address and keeps code indentation", async () => {
    const pdf = await buildReportPdf(SAMPLE_DOCUMENT);
    expectText(pdf, "rapport complet (https://exemple.bj/rapport)", "Plan du site");
    expect(squash(pdfText(pdf))).not.toContain("plan.png");
    expect(pdfText(pdf)).toMatch(/\u00a0\u00a0\n?GROUP BY zone;/);
    // Only the internal links of the contents page, and the bookmarks.
    expect(pdf.toString("latin1")).not.toContain("/URI");
    expect(pdf.toString("latin1")).toContain("/Outlines");
  });

  it("draws characters the standard fonts lack as question marks", async () => {
    const pdf = await buildReportPdf({
      ...SAMPLE_DOCUMENT,
      sections: [
        {
          title: "Symboles 📄",
          status: "completed",
          assigneeName: "李雷",
          markdown: "Prix\u202f: 12 € 👍 ok",
        },
      ],
    });
    expectText(pdf, "Symboles ?", "Responsable : ?? · Statut : Terminée", "Prix : 12 € ? ok");
    expect(pdfText(pdf)).toContain("Prix\u00a0:");
  });

  it("copes with a 500-column table, a list 50 levels deep and a long word", async () => {
    const columns = 500;
    const row = (cell: string) => `|${Array.from({ length: columns }, () => cell).join("|")}|`;
    const list = Array.from({ length: 50 }, (_, level) => `${"  ".repeat(level)}- niveau ${level}`).join(
      "\n",
    );
    const pdf = await buildReportPdf({
      ...SAMPLE_DOCUMENT,
      sections: [
        {
          title: "Limites",
          status: "in_progress",
          assigneeName: null,
          markdown: [row("cellule"), row("-"), row("val"), "", list, "", "x".repeat(5_000)].join("\n"),
        },
      ],
    });
    expectText(pdf, "niveau 49", "val | val | val");
  });

  it("keeps the end of a list item or a table row taller than a page", async () => {
    const words = Array.from({ length: 1_500 }, (_, index) => `mot${index}`).join(" ");
    const pdf = await buildReportPdf({
      ...SAMPLE_DOCUMENT,
      sections: [
        {
          title: "Longs blocs",
          status: "completed",
          assigneeName: null,
          markdown: `- ${words} finitem\n\n| A | B |\n| - | - |\n| ${words} fincellule | b |\n\nApres`,
        },
      ],
    });
    expectText(pdf, "mot1499 finitem", "mot1499 fincellule", "Apres");
  });
});

describe("pageGroups", () => {
  const paragraph = (chars: number): Block => ({ type: "paragraph", runs: [{ text: "a".repeat(chars) }] });
  const heading = (depth: number): Block => ({ type: "heading", depth, runs: [{ text: "Partie" }] });

  it("keeps a short section on one Page", () => {
    const blocks = [heading(1), paragraph(5_000), heading(2), paragraph(5_000)];
    expect(pageGroups(blocks)).toEqual([blocks]);
  });

  it("starts a new Page at a heading once a group is long", () => {
    const blocks = [paragraph(13_000), heading(3), paragraph(100), heading(2), paragraph(100)];
    expect(pageGroups(blocks).map((group) => group.length)).toEqual([3, 2]);
  });

  it("starts a new Page anywhere once a group is very long", () => {
    const groups = pageGroups(Array.from({ length: 10 }, () => paragraph(10_000)));
    expect(groups.map((group) => group.length)).toEqual([4, 4, 2]);
  });
});

describe("buildReportPdf with subsections (KRB-195)", () => {
  it("lists subsections in the contents and draws them after their section's text", async () => {
    const pdf = await buildReportPdf({
      ...SAMPLE_DOCUMENT,
      sections: [
        { title: "Contexte", status: "completed", assigneeName: null, markdown: "Introduction du contexte." },
        { title: "Objectifs", level: 2, status: "in_progress", assigneeName: null, markdown: "Moins 12 %." },
        { title: "Analyse", status: "not_started", assigneeName: null, markdown: null },
      ],
    });
    const text = squash(pdfText(pdf));
    expect(text).toContain(squash("1.1 Objectifs"));
    // Contents, then the section page holding its subsection, then the next section.
    const order = ["Introduction du contexte.", "1.1 Objectifs", "Moins 12 %.", "2. Analyse"].map((part) =>
      text.lastIndexOf(squash(part)),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).toContain(squash("Page 4 sur 4"));
  });
});

describe("buildReportPdf with images (KRB-216)", () => {
  const PHOTO = "0b6f5e1c-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
  const DIAGRAM = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  const GONE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const HEAVY = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
  const ref = (id: string, caption: string) => `![${caption}](/api/deliverables/${id}/file)`;

  function document(markdown: string, images: ExportDocument["images"]): ExportDocument {
    return {
      ...SAMPLE_DOCUMENT,
      sections: [{ title: "Constats", status: "in_progress", assigneeName: null, markdown }],
      images,
    };
  }

  /** Image XObjects drawn in the PDF. */
  const imageObjects = (pdf: Buffer) => pdf.toString("latin1").match(/\/Subtype\s*\/Image/g)?.length ?? 0;

  it("draws PNG and JPEG images with their caption", async () => {
    const png = pngImage(40, 20, { alpha: true });
    const jpeg = withExifOrientation(JPEG_4X2, 6);
    const pdf = await buildReportPdf(
      document(
        `Relevé :\n\n${ref(DIAGRAM, "Schéma de la toiture")}\n\n${ref(PHOTO, "Façade nord")}`,
        new Map([
          [DIAGRAM, { status: "ready", format: "png", data: png, width: 40, height: 20, orientation: 1 }],
          [PHOTO, { status: "ready", format: "jpeg", data: jpeg, width: 4, height: 2, orientation: 6 }],
        ]),
      ),
    );
    // The PNG with transparency is drawn with a soft mask: two objects for it, one for the JPEG.
    expect(imageObjects(pdf)).toBe(3);
    expectText(pdf, "Relevé :", "Schéma de la toiture", "Façade nord");
    expect(squash(pdfText(pdf))).not.toContain("indisponible");
  });

  it("shows the caption and why when an image is not there", async () => {
    const pdf = await buildReportPdf(
      document(
        `${ref(GONE, "Plan disparu")}\n\n${ref(HEAVY, "Photo lourde")}\n\n${ref(PHOTO, "")}`,
        new Map([
          [HEAVY, { status: "tooLarge" }],
          [PHOTO, { status: "limit" }],
        ]),
      ),
    );
    expect(imageObjects(pdf)).toBe(0);
    expectText(
      pdf,
      "Plan disparu (image indisponible)",
      "Photo lourde (image trop lourde pour l'export)",
      "(image non reprise : l'export a atteint sa limite d'images)",
    );
  });
});
