// @vitest-environment node
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { testPdf } from "../../pdf/test-pdf";
import { FILE_TYPES, type FileExtension } from "../file-types";
import { isParsed, PARSE_LIMITS, ParseError, parseDeliverableFile } from "./index";
import { finishMarkdown } from "./markdown";
import { isKeptUnread, STORED_RESULT } from "./types";

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

const fixture = (name: string) =>
  readFileSync(new URL(`../../../../tests/fixtures/deliverables/${name}`, import.meta.url));

const PARSED: FileExtension[] = ["docx", "xlsx", "csv", "txt", "md", "pdf"];
const STORED = (Object.keys(FILE_TYPES) as FileExtension[]).filter(
  (extension) => !PARSED.includes(extension),
);

describe("isParsed", () => {
  it.each(PARSED)("reads .%s files", (extension) => {
    expect(isParsed(extension)).toBe(true);
  });

  it.each(STORED)("stores .%s files without reading them", (extension) => {
    expect(isParsed(extension)).toBe(false);
  });
});

describe("parseDeliverableFile", () => {
  it("stores images, diagrams, presentations and old Office files", () => {
    expect(STORED).toEqual(
      expect.arrayContaining(["png", "jpg", "pptx", "doc", "xls", "svg", "drawio", "vsdx"]),
    );
  });

  it.each(STORED)("skips .%s whatever the bytes hold", async (extension) => {
    const result = await parseDeliverableFile(extension, fixture("etude-thermique.docx"));
    expect(result).toEqual({
      status: "skipped",
      meta: { version: 1, kind: "stored", words: 0, characters: 0, tokenEstimate: 0, truncated: false },
    });
  });

  it("reads .docx as a document", async () => {
    const result = await parseDeliverableFile("docx", fixture("etude-thermique.docx"));
    expect(result.status).toBe("parsed");
    expect(result.meta).toMatchObject({ kind: "document", tables: 1 });
  });

  it("reads .xlsx as a spreadsheet", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Feuille").getCell("A1").value = "Valeur";
    const result = await parseDeliverableFile("xlsx", Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(result).toMatchObject({ status: "parsed", markdown: "## Feuille\n\n| Valeur |\n| --- |" });
    expect(result.meta.kind).toBe("spreadsheet");
  });

  it("reads .csv as a spreadsheet", async () => {
    const result = await parseDeliverableFile("csv", fixture("releves.csv"));
    expect(result.status).toBe("parsed");
    expect(result.meta.kind).toBe("spreadsheet");
    expect(result.meta.sheets).toHaveLength(1);
  });

  it.each(["txt", "md"] as const)("reads .%s as text", async (extension) => {
    const result = await parseDeliverableFile(extension, Buffer.from("# Titre\n\nTexte *gras*.\n"));
    expect(result).toMatchObject({ status: "parsed", markdown: "# Titre\n\nTexte *gras*." });
    expect(result.meta.kind).toBe("text");
  });

  it("reads .pdf as plain text", async () => {
    const result = await parseDeliverableFile("pdf", Buffer.from(testPdf([["# Titre", "Texte *gras*."]])));
    expect(result).toMatchObject({ status: "parsed", markdown: "# Titre\nTexte *gras*." });
    expect(result.meta).toMatchObject({ kind: "pdf", pages: 1, pagesRead: 1 });
  });

  it("passes stopAt to the PDF reader", async () => {
    const pdf = Buffer.from(testPdf([["Page 1"], ["Page 2"]]));
    const result = await parseDeliverableFile("pdf", pdf, { stopAt: Date.now() - 1 });
    expect(result.meta).toMatchObject({ truncated: true, pages: 2, pagesRead: 1 });
  });

  it("uses the extension, not the content, to pick the parser", async () => {
    const asXlsx = parseDeliverableFile("xlsx", fixture("etude-thermique.docx"));
    await expect(asXlsx).rejects.toBeInstanceOf(ParseError);
    await expect(asXlsx).rejects.toMatchObject({ key: "unreadable" });
    await expect(parseDeliverableFile("docx", fixture("illisible.docx"))).rejects.toMatchObject({
      key: "corrupt",
    });
  });
});

describe("isKeptUnread", () => {
  const stored = STORED_RESULT.meta;

  it("finds a PDF kept before PDFs were read", () => {
    expect(isKeptUnread("Plan masse.pdf", "skipped", stored)).toBe(true);
    expect(isKeptUnread("PLAN.PDF", "skipped", stored)).toBe(true);
  });

  it("leaves out files read since, files the app keeps as is, and other states", () => {
    expect(isKeptUnread("scan.pdf", "skipped", { ...stored, kind: "pdf", reason: "noText" })).toBe(false);
    expect(isKeptUnread("photo.png", "skipped", stored)).toBe(false);
    expect(isKeptUnread("plan.pdf", "parsed", stored)).toBe(false);
    expect(isKeptUnread("plan.pdf", "pending", stored)).toBe(false);
    expect(isKeptUnread("plan.pdf", "skipped", null)).toBe(false);
    expect(isKeptUnread("plan.pdf", "skipped", "stored")).toBe(false);
  });
});

describe("finishMarkdown", () => {
  const LIMIT = PARSE_LIMITS.maxMarkdownChars;

  it("cuts a long text on a line boundary and marks it truncated", () => {
    const lines = Array.from(
      { length: 3000 },
      (_, index) => `Ligne ${index + 1} : ${"mesure ".repeat(10)}fin`,
    );
    const text = lines.join("\n");
    expect(text.length).toBeGreaterThan(LIMIT);

    const { markdown, meta } = finishMarkdown(text, { kind: "text" });
    expect(markdown.length).toBeLessThanOrEqual(LIMIT);
    expect(text.startsWith(markdown)).toBe(true);
    expect(text.charAt(markdown.length)).toBe("\n");
    // Only the line that crosses the limit is dropped.
    expect(LIMIT - markdown.length).toBeLessThan((lines[0] ?? "").length + 10);
    expect(meta).toEqual({
      version: 1,
      kind: "text",
      words: expect.any(Number),
      characters: markdown.length,
      tokenEstimate: Math.ceil(markdown.length / 4),
      truncated: true,
    });
  });

  it("cuts a single long line at the limit", () => {
    const { markdown, meta } = finishMarkdown("a".repeat(LIMIT + 10), { kind: "text" });
    expect(markdown).toHaveLength(LIMIT);
    expect(meta.truncated).toBe(true);
  });

  it("keeps a text of exactly the limit", () => {
    const { markdown, meta } = finishMarkdown(`${"a".repeat(LIMIT - 2)}\nb`, { kind: "text" });
    expect(markdown).toHaveLength(LIMIT);
    expect(meta.truncated).toBe(false);
  });

  it("truncates through parseDeliverableFile too", async () => {
    const text = Array.from({ length: 30_000 }, (_, index) => `ligne ${index}`).join("\r\n");
    const result = await parseDeliverableFile("txt", Buffer.from(text));
    expect(result.status).toBe("parsed");
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.characters).toBeLessThanOrEqual(LIMIT);
  });

  it("passes tables and sheets through to the meta", () => {
    const sheets = [{ name: "A", rows: 1, columns: 1, keptRows: 1, keptColumns: 1 }];
    expect(finishMarkdown("x", { kind: "spreadsheet", sheets }).meta.sheets).toBe(sheets);
    expect(finishMarkdown("x", { kind: "document", tables: 3 }).meta.tables).toBe(3);
  });

  it("counts words with accents and numbers", () => {
    expect(finishMarkdown("L'étude coûte 1 000,50 € **hors** taxes.", { kind: "text" }).meta.words).toBe(8);
  });
});
