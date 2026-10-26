// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { testPdf } from "../../pdf/test-pdf";
import { parsePdf } from "./pdf";
import { PARSE_LIMITS, ParseError } from "./types";

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

// PDF deliverables (KRB-214) on PDFs built by src/lib/pdf/test-pdf.ts, with
// the real limits.

const SKIPPED_META = { version: 1, kind: "pdf", words: 0, characters: 0, tokenEstimate: 0, truncated: false };

describe("parsePdf", () => {
  it("keeps the text as plain text, Markdown signs and all", async () => {
    const result = await parsePdf(testPdf([["# Bilan", "*Consommation* : 1. chauffage"], ["Annexe"]]));
    expect(result).toEqual({
      status: "parsed",
      markdown: "# Bilan\n*Consommation* : 1. chauffage\n\nAnnexe",
      meta: {
        version: 1,
        kind: "pdf",
        words: 5,
        characters: 45,
        tokenEstimate: 12,
        truncated: false,
        pages: 2,
        pagesRead: 2,
      },
    });
  });

  it("keeps a PDF without text as is and says why", async () => {
    expect(await parsePdf(testPdf([[]], { image: true }))).toEqual({
      status: "skipped",
      meta: { ...SKIPPED_META, reason: "noText" },
    });
  });

  it("keeps a PDF locked by a password as is and says why", async () => {
    expect(await parsePdf(testPdf([["Secret"]], { password: "motdepasse" }))).toEqual({
      status: "skipped",
      meta: { ...SKIPPED_META, reason: "locked" },
    });
  });

  it("fails on a file pdf.js cannot open", async () => {
    const work = parsePdf(new TextEncoder().encode("%PDF-1.7\n%%EOF"));
    await expect(work).rejects.toBeInstanceOf(ParseError);
    await expect(work).rejects.toMatchObject({ key: "unreadable" });
  });

  it("reads the first maxPdfPages pages", async () => {
    const count = PARSE_LIMITS.maxPdfPages + 2;
    const result = await parsePdf(
      testPdf(Array.from({ length: count }, (_, index) => [`Page ${index + 1}`])),
    );
    expect(result.status).toBe("parsed");
    expect(result.meta).toMatchObject({ truncated: true, pages: count, pagesRead: PARSE_LIMITS.maxPdfPages });
    expect(result.status === "parsed" && result.markdown.endsWith(`Page ${PARSE_LIMITS.maxPdfPages}`)).toBe(
      true,
    );
  });

  it("stops at maxMarkdownChars", async () => {
    const line = "Relevé de consommation du bâtiment principal, chaufferie et ventilation comprises.";
    const page = Array.from({ length: 50 }, () => line);
    const result = await parsePdf(
      testPdf(
        Array.from({ length: 60 }, () => page),
        { deflate: true },
      ),
    );
    expect(result.status).toBe("parsed");
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.characters).toBeLessThanOrEqual(PARSE_LIMITS.maxMarkdownChars);
    expect(result.meta.characters).toBeGreaterThan(PARSE_LIMITS.maxMarkdownChars - line.length - 2);
    expect(result.meta.pagesRead).toBeLessThan(60);
  });
});
