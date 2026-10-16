// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Block } from "./markdown";
import { buildReportPdf, pageGroups } from "./pdf";
import { FRENCH_SAMPLE, SAMPLE_DOCUMENT } from "./test-document";
import { pdfText, squash } from "./test-pdf-text";

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
