import { describe, expect, it } from "vitest";
import { PARSE_LIMITS, readInPart, type ParseMeta } from "./types";

const META: ParseMeta = {
  version: 1,
  kind: "document",
  words: 10,
  characters: 60,
  tokenEstimate: 15,
  truncated: false,
};

describe("PARSE_LIMITS", () => {
  it("lets real files through whole (KRB-253)", () => {
    expect(PARSE_LIMITS).toMatchObject({
      maxSheets: 50,
      maxRowsPerSheet: 5_000,
      maxColumns: 100,
      maxCellChars: 5_000,
      maxMarkdownChars: 2_000_000,
      maxPdfPages: 2_000,
    });
  });
});

describe("readInPart", () => {
  it("is false for a file read whole, or no meta", () => {
    expect(readInPart(META)).toBe(false);
    expect(readInPart(null)).toBe(false);
    expect(readInPart(undefined)).toBe(false);
    expect(
      readInPart({
        ...META,
        kind: "spreadsheet",
        sheets: [{ name: "A", rows: 10, columns: 3, keptRows: 10, keptColumns: 3 }],
      }),
    ).toBe(false);
    expect(readInPart({ ...META, kind: "pdf", pages: 12, pagesRead: 12 })).toBe(false);
  });

  it("is true when the text was cut", () => {
    expect(readInPart({ ...META, truncated: true })).toBe(true);
  });

  it("catches files read before KRB-253, which only flagged the text", () => {
    expect(readInPart({ ...META, kind: "pdf", pages: 400, pagesRead: 300 })).toBe(true);
    expect(
      readInPart({
        ...META,
        kind: "spreadsheet",
        sheets: [
          { name: "A", rows: 10, columns: 3, keptRows: 10, keptColumns: 3 },
          { name: "B", rows: 250, columns: 3, keptRows: 200, keptColumns: 3 },
        ],
      }),
    ).toBe(true);
    expect(
      readInPart({
        ...META,
        kind: "spreadsheet",
        sheets: [{ name: "A", rows: 10, columns: 40, keptRows: 10, keptColumns: 30 }],
      }),
    ).toBe(true);
  });
});
