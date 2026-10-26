// @vitest-environment node
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { PARSE_LIMITS, ParseError, type ParseResult } from "./types";
import { cellText, parseXlsx } from "./xlsx";

// The limits from before KRB-253, far smaller, keep these tests fast and
// light. The parsers read PARSE_LIMITS the same way whatever its values.
vi.mock("./types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./types")>();
  return {
    ...actual,
    PARSE_LIMITS: {
      ...actual.PARSE_LIMITS,
      maxSheets: 20,
      maxRowsPerSheet: 200,
      maxColumns: 30,
      maxCellChars: 500,
      maxMarkdownChars: 200_000,
      maxPdfPages: 300,
    },
  };
});

async function workbookBytes(build: (workbook: ExcelJS.Workbook) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function parsed(result: ParseResult) {
  if (result.status !== "parsed") throw new Error(`expected a parsed result, got ${result.status}`);
  return result;
}

function buildSummary(workbook: ExcelJS.Workbook) {
  const summary = workbook.addWorksheet("Synthèse");
  summary.getCell("A1").value = "Titre fusionné";
  summary.mergeCells("A1:B1");
  summary.getCell("C1").value = "Vertical";
  summary.mergeCells("C1:C2");
  summary.getCell("A2").value = 21;
  summary.getCell("B2").value = { formula: "A2*2", result: 42 };
  summary.getCell("A3").value = {
    richText: [{ text: "Très ", font: { bold: true } }, { text: "important" }],
  };
  summary.getCell("B3").value = { text: "Site", hyperlink: "https://exemple.bj" };
  summary.getCell("C3").value = new Date(Date.UTC(2026, 9, 13));
  summary.getCell("A4").value = new Date(Date.UTC(2026, 9, 13, 14, 30));
  summary.getCell("B4").value = 0.1 + 0.2;
  summary.getCell("C4").value = { formula: "1/0", result: { error: "#DIV/0!" } };
  summary.getCell("A5").value = "a|b *c* _d_ [e] `f` \\g";
  summary.getCell("B5").value = "Ligne 1\nLigne 2";
  summary.getCell("C5").value = true;

  workbook.addWorksheet("Cachée", { state: "hidden" }).getCell("A1").value = "secret caché";
  workbook.addWorksheet("Très cachée", { state: "veryHidden" }).getCell("A1").value = "secret très caché";
  workbook.addWorksheet("Vide");

  const budget = workbook.addWorksheet("Budget | 2026 _final_");
  budget.addRow(["Poste", "Montant"]);
  budget.addRow(["Études", 1500000]);

  // Data that starts at C3 keeps only its own columns.
  const offset = workbook.addWorksheet("Décalé");
  offset.getCell("C3").value = "x";
  offset.getCell("D4").value = "y";
}

const SUMMARY = `## Synthèse

| Titre fusionné |   | Vertical |
| --- | --- | --- |
| 21 | 42 |   |
| Très important | Site | 2026-10-13 |
| 2026-10-13 14:30 | 0.3 | #DIV/0! |
| a\\|b \\*c\\* \\_d\\_ \\[e\\] \\\`f\\\` \\\\g | Ligne 1 Ligne 2 | true |

## Vide

## Budget \\| 2026 \\_final\\_

| Poste | Montant |
| --- | --- |
| Études | 1500000 |

## Décalé

| x |   |
| --- | --- |
|   | y |`;

describe("parseXlsx on a small workbook", () => {
  it("renders the visible sheets as exact Markdown", async () => {
    const { markdown } = parsed(await parseXlsx(await workbookBytes(buildSummary)));
    expect(markdown).toBe(SUMMARY);
  });

  it("leaves hidden sheets out of the Markdown and the meta", async () => {
    const { markdown, meta } = parsed(await parseXlsx(await workbookBytes(buildSummary)));
    expect(markdown).not.toContain("secret");
    expect(meta.sheets?.map((sheet) => sheet.name)).toEqual([
      "Synthèse",
      "Vide",
      "Budget | 2026 _final_",
      "Décalé",
    ]);
  });

  it("measures each sheet and the Markdown", async () => {
    const { markdown, meta } = parsed(await parseXlsx(await workbookBytes(buildSummary)));
    expect(meta).toEqual({
      version: 1,
      kind: "spreadsheet",
      sheets: [
        { name: "Synthèse", rows: 5, columns: 3, keptRows: 5, keptColumns: 3 },
        { name: "Vide", rows: 0, columns: 0, keptRows: 0, keptColumns: 0 },
        { name: "Budget | 2026 _final_", rows: 2, columns: 2, keptRows: 2, keptColumns: 2 },
        { name: "Décalé", rows: 2, columns: 2, keptRows: 2, keptColumns: 2 },
      ],
      words: expect.any(Number),
      characters: markdown.length,
      tokenEstimate: Math.ceil(markdown.length / 4),
      truncated: false,
    });
  });
});

describe("parseXlsx limits", () => {
  it("keeps 200 rows and 30 columns of a 250 by 40 sheet", async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet("Grand");
      for (let row = 1; row <= 250; row++) {
        sheet.addRow(Array.from({ length: 40 }, (_, column) => `R${row}C${column + 1}`));
      }
    });
    const { markdown, meta } = parsed(await parseXlsx(bytes));
    expect(meta.sheets).toEqual([{ name: "Grand", rows: 250, columns: 40, keptRows: 200, keptColumns: 30 }]);
    const lines = markdown.split("\n");
    expect(lines[0]).toBe("## Grand");
    // Heading, blank line, header row, separator, 199 body rows.
    expect(lines).toHaveLength(2 + 1 + 1 + 199);
    expect(lines[2]).toBe(`| ${Array.from({ length: 30 }, (_, column) => `R1C${column + 1}`).join(" | ")} |`);
    expect(lines.at(-1)).toBe(
      `| ${Array.from({ length: 30 }, (_, column) => `R200C${column + 1}`).join(" | ")} |`,
    );
    expect(markdown).not.toMatch(/R201C|C31\b/);
    // Read in part: the AI won't draft from it (KRB-253).
    expect(meta.truncated).toBe(true);
  });

  it("cuts a long cell at 500 characters", async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet("Long");
      sheet.getCell("A1").value = "Texte";
      sheet.getCell("A2").value = "é".repeat(PARSE_LIMITS.maxCellChars) + "FIN".repeat(40);
    });
    const { markdown, meta } = parsed(await parseXlsx(bytes));
    expect(markdown).toBe(`## Long\n\n| Texte |\n| --- |\n| ${"é".repeat(PARSE_LIMITS.maxCellChars)} |`);
    expect(meta.truncated).toBe(true);
  });

  it("keeps the first 20 visible sheets", async () => {
    const bytes = await workbookBytes((workbook) => {
      workbook.addWorksheet("Masquée", { state: "hidden" }).getCell("A1").value = "m";
      for (let index = 1; index <= 22; index++) {
        workbook.addWorksheet(`Feuille ${index}`).getCell("A1").value = index;
      }
    });
    const { markdown, meta } = parsed(await parseXlsx(bytes));
    expect(meta.sheets).toHaveLength(PARSE_LIMITS.maxSheets);
    expect(meta.sheets?.at(-1)?.name).toBe("Feuille 20");
    expect(markdown).toContain("## Feuille 20\n");
    expect(markdown).not.toContain("Feuille 21");
    expect(meta.truncated).toBe(true);
  });

  it("stops reading once the text passes maxMarkdownChars", async () => {
    const bytes = await workbookBytes((workbook) => {
      for (let index = 1; index <= 3; index++) {
        const sheet = workbook.addWorksheet(`Feuille ${index}`);
        for (let row = 1; row <= 200; row++) sheet.addRow(Array.from({ length: 2 }, () => "x".repeat(400)));
      }
    });
    const { markdown, meta } = parsed(await parseXlsx(bytes));
    // 200 rows of 800 characters fill the 200,000 characters before the third sheet.
    expect(meta.sheets?.map((sheet) => sheet.name)).toEqual(["Feuille 1", "Feuille 2"]);
    expect(markdown.length).toBeLessThanOrEqual(PARSE_LIMITS.maxMarkdownChars);
    expect(meta.truncated).toBe(true);
  });

  it("shows nothing for a date it cannot represent instead of failing", async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet("Dates");
      sheet.getCell("A1").value = "Téléphone";
      sheet.getCell("A2").value = 22997000000;
      sheet.getCell("A2").numFmt = "dd/mm/yyyy";
      sheet.getCell("A3").value = 45000;
      sheet.getCell("A3").numFmt = "dd/mm/yyyy";
    });
    const { markdown } = parsed(await parseXlsx(bytes));
    expect(markdown).toBe("## Dates\n\n| Téléphone |\n| --- |\n|   |\n| 2023-03-15 |");
  });
});

describe("parseXlsx on files it cannot read", () => {
  it("refuses bytes that are not a ZIP as corrupt", async () => {
    const failure = parseXlsx(Buffer.from("PK\x03\x04 pas un classeur"));
    await expect(failure).rejects.toBeInstanceOf(ParseError);
    await expect(failure).rejects.toMatchObject({ key: "corrupt" });
  });

  it("calls a ZIP without a workbook unreadable", async () => {
    const docx = readFileSync(
      new URL("../../../../tests/fixtures/deliverables/etude-thermique.docx", import.meta.url),
    );
    const failure = parseXlsx(docx);
    await expect(failure).rejects.toBeInstanceOf(ParseError);
    await expect(failure).rejects.toMatchObject({ key: "unreadable" });
  });
});

// exceljs types a hyperlink's text as a string, but rich text shows up there too.
const richHyperlink = {
  text: { richText: [{ text: "lien " }, { text: "riche" }] },
  hyperlink: "https://exemple.bj",
} as unknown as ExcelJS.CellValue;

const CELL_TEXTS: [ExcelJS.CellValue, string][] = [
  [null, ""],
  [undefined, ""],
  ["texte", "texte"],
  [42, "42"],
  [0.1 + 0.2, "0.3"],
  [1 / 3, "0.333333333333333"],
  [2 ** 60, "1152921504606850000"],
  [1e21, "1e+21"],
  [-0.5, "-0.5"],
  [false, "false"],
  [new Date(Date.UTC(2026, 0, 2)), "2026-01-02"],
  [new Date(Date.UTC(2026, 0, 2, 8, 5, 59)), "2026-01-02 08:05"],
  [{ formula: "A1", result: "résultat" }, "résultat"],
  [{ formula: "A1" }, ""],
  [{ sharedFormula: "B2", result: 7 }, "7"],
  [{ formula: "TODAY()", result: new Date(Date.UTC(2026, 9, 13)) }, "2026-10-13"],
  [{ text: "lien", hyperlink: "https://exemple.bj" }, "lien"],
  [richHyperlink, "lien riche"],
  [{ richText: [{ text: "a" }, { text: "b" }] }, "ab"],
  [{ error: "#N/A" }, "#N/A"],
];

describe("cellText", () => {
  it.each(CELL_TEXTS)("shows %j as %j", (value, expected) => {
    expect(cellText(value)).toBe(expected);
  });

  it("shows nothing for an invalid date", () => {
    expect(cellText(new Date(Number.NaN))).toBe("");
  });
});
