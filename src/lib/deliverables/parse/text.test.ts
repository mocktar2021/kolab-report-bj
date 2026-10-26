// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { decodeText, parseCsv, parseCsvRows, parsePlainText } from "./text";
import { PARSE_LIMITS, type ParseResult } from "./types";

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

function parsed(result: ParseResult) {
  if (result.status !== "parsed") throw new Error(`expected a parsed result, got ${result.status}`);
  return result;
}

const utf8 = (text: string) => new TextEncoder().encode(text);

function utf16(text: string, order: "le" | "be"): Uint8Array {
  const bytes = order === "le" ? [0xff, 0xfe] : [0xfe, 0xff];
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    bytes.push(...(order === "le" ? [unit & 0xff, unit >> 8] : [unit >> 8, unit & 0xff]));
  }
  return new Uint8Array(bytes);
}

const SAMPLE = "Façade «été» 1 000,50 € œuvre l’étude";

// Windows-1252 bytes 0x80 to 0x9F. The five unused ones stay as control characters.
const WINDOWS_1252_HIGH = String.fromCharCode(
  ...[0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d],
  ...[0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161],
  ...[0x203a, 0x153, 0x9d, 0x17e, 0x178],
);

describe("decodeText", () => {
  it("reads UTF-8", () => {
    expect(decodeText(utf8(SAMPLE))).toBe(SAMPLE);
  });

  it("drops a UTF-8 byte order mark", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("Nom;Prix")]))).toBe("Nom;Prix");
  });

  it("reads UTF-16 little endian with a byte order mark", () => {
    expect(decodeText(utf16(SAMPLE, "le"))).toBe(SAMPLE);
  });

  it("reads UTF-16 big endian with a byte order mark", () => {
    expect(decodeText(utf16(SAMPLE, "be"))).toBe(SAMPLE);
  });

  it("falls back to Windows-1252 when the bytes are not UTF-8", () => {
    // "Façade € œuvre l’étude" as Excel saves it on a French Windows.
    const bytes = new Uint8Array([
      0x46, 0x61, 0xe7, 0x61, 0x64, 0x65, 0x20, 0x80, 0x20, 0x9c, 0x75, 0x76, 0x72, 0x65, 0x20, 0x6c, 0x92,
      0xe9, 0x74, 0x75, 0x64, 0x65,
    ]);
    expect(decodeText(bytes)).toBe("Façade € œuvre l’étude");
  });

  it("maps the whole 0x80 to 0x9F range like Windows-1252", () => {
    const bytes = new Uint8Array(Array.from({ length: 32 }, (_, index) => 0x80 + index));
    expect(decodeText(bytes)).toBe(WINDOWS_1252_HIGH);
  });

  it("reads an empty file", () => {
    expect(decodeText(new Uint8Array())).toBe("");
  });
});

describe("parseCsvRows", () => {
  it.each([
    ["semicolons", "Nom;Valeur\nA;1,5\n"],
    ["commas", 'Nom,Valeur\nA,"1,5"\n'],
    ["tabs", "Nom\tValeur\nA\t1,5\n"],
  ])("detects %s", (_, text) => {
    expect(parseCsvRows(text)).toEqual({
      rows: [
        ["Nom", "Valeur"],
        ["A", "1,5"],
      ],
      totalRows: 2,
      totalColumns: 2,
      cellsCut: false,
    });
  });

  it("reads a single column", () => {
    expect(parseCsvRows("Nom\nA\nB").rows).toEqual([["Nom"], ["A"], ["B"]]);
  });

  it("handles quoted delimiters, doubled quotes and line breaks in quotes", () => {
    expect(parseCsvRows('a;"b;c";"d ""e""";"ligne 1\nligne 2";""\n').rows).toEqual([
      ["a", "b;c", 'd "e"', "ligne 1\nligne 2", ""],
    ]);
  });

  it("ignores delimiters inside quotes when it detects the delimiter", () => {
    expect(parseCsvRows('"Nom, prénom, titre";"Ville"\n"Dossou, Jean, M.";"Cotonou"\n').rows).toEqual([
      ["Nom, prénom, titre", "Ville"],
      ["Dossou, Jean, M.", "Cotonou"],
    ]);
  });

  it("accepts CRLF, CR and LF line endings and a missing last line ending", () => {
    expect(parseCsvRows("a;b\r\n1;2\r3;4\n5;6").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ]);
  });

  it("skips empty lines but keeps lines of empty values", () => {
    expect(parseCsvRows("a;b\n\n\r\n;\n1;2;\n\n")).toEqual({
      rows: [
        ["a", "b"],
        ["", ""],
        ["1", "2", ""],
      ],
      totalRows: 3,
      totalColumns: 3,
      cellsCut: false,
    });
  });

  it("reads an empty text", () => {
    expect(parseCsvRows("")).toEqual({ rows: [], totalRows: 0, totalColumns: 0, cellsCut: false });
  });

  it("keeps 200 rows and 30 columns but counts them all", () => {
    const text = Array.from({ length: 250 }, (_, row) =>
      Array.from({ length: 40 }, (_, column) => `R${row + 1}C${column + 1}`).join(";"),
    ).join("\r\n");
    const { rows, totalRows, totalColumns } = parseCsvRows(text);
    expect(totalRows).toBe(250);
    expect(totalColumns).toBe(40);
    expect(rows).toHaveLength(PARSE_LIMITS.maxRowsPerSheet);
    expect(rows.every((row) => row.length === PARSE_LIMITS.maxColumns)).toBe(true);
    expect(rows.at(-1)?.at(-1)).toBe("R200C30");
  });

  it("counts a very wide row without keeping its values", () => {
    const start = performance.now();
    const { rows, totalColumns } = parseCsvRows(",".repeat(1_000_000));
    expect(performance.now() - start).toBeLessThan(5000);
    expect(totalColumns).toBe(1_000_001);
    expect(rows).toEqual([Array(PARSE_LIMITS.maxColumns).fill("")]);
  });

  it("detects the delimiter from the start of a very long first line", () => {
    const text = `${"a;".repeat(100_000)}\n${"b,c,".repeat(100_000)}`;
    expect(parseCsvRows(text).rows[0]?.slice(0, 2)).toEqual(["a", "a"]);
  });

  it("cuts quoted and unquoted values at 500 characters", () => {
    const long = "x".repeat(PARSE_LIMITS.maxCellChars + 100);
    expect(parseCsvRows(`${long};"${long}"\n`).rows).toEqual([
      ["x".repeat(PARSE_LIMITS.maxCellChars), "x".repeat(PARSE_LIMITS.maxCellChars)],
    ]);
  });
});

describe("parseCsv", () => {
  it("reads releves.csv, Windows-1252 with semicolons and CRLF", () => {
    const bytes = fixture("releves.csv");
    expect(bytes.includes(0x80)).toBe(true);
    expect(bytes.includes(0x9c)).toBe(true);
    expect(bytes.toString("latin1")).toContain("\r\n");

    const { markdown, meta } = parsed(parseCsv(bytes));
    expect(markdown).toBe(
      [
        "| Point de mesure | Température (°C) | Humidité (%) | Remarque |",
        "| --- | --- | --- | --- |",
        "| Façade nord | 24,5 | 60 | RAS |",
        '| Façade sud | 31,2 | 45 | Soleil direct; volets "ouverts" |',
        "| Toiture | 38 | 35 | Coût 1 000,50 €, œuvre à reprendre |",
      ].join("\n"),
    );
    expect(meta).toEqual({
      version: 1,
      kind: "spreadsheet",
      sheets: [{ name: "CSV", rows: 4, columns: 4, keptRows: 4, keptColumns: 4 }],
      words: expect.any(Number),
      characters: markdown.length,
      tokenEstimate: Math.ceil(markdown.length / 4),
      truncated: false,
    });
  });

  it("escapes Markdown and pipes in values", () => {
    expect(parsed(parseCsv(utf8("a*b;c|d;[e]_f\n"))).markdown).toBe(
      "| a\\*b | c\\|d | \\[e\\]\\_f |\n| --- | --- | --- |",
    );
  });

  it("reports the capped size in the sheet meta", () => {
    const text = Array.from({ length: 250 }, () => Array.from({ length: 40 }, () => "v").join(",")).join(
      "\n",
    );
    const { meta } = parsed(parseCsv(utf8(text)));
    expect(meta.sheets).toEqual([{ name: "CSV", rows: 250, columns: 40, keptRows: 200, keptColumns: 30 }]);
    // Read in part: the AI won't draft from it (KRB-253).
    expect(meta.truncated).toBe(true);
  });

  it("flags a value cut at maxCellChars", () => {
    const long = "x".repeat(PARSE_LIMITS.maxCellChars + 1);
    expect(parseCsvRows(`a;"${long}"\n`).cellsCut).toBe(true);
    expect(parsed(parseCsv(utf8(`a;${long}\n`))).meta.truncated).toBe(true);
    expect(parsed(parseCsv(utf8(`a;${"x".repeat(PARSE_LIMITS.maxCellChars)}\n`))).meta.truncated).toBe(false);
  });
});

describe("parsePlainText", () => {
  it("keeps Markdown as it is and tidies the spacing", () => {
    const { markdown, meta } = parsed(
      parsePlainText(utf8("\n# Titre  \n\n*gras* [lien](x)\t\nligne  \nsuite\n\n\n\nfin \n")),
    );
    expect(markdown).toBe("# Titre  \n\n*gras* [lien](x)\nligne  \nsuite\n\nfin");
    expect(meta).toEqual({
      version: 1,
      kind: "text",
      words: 7,
      characters: markdown.length,
      tokenEstimate: Math.ceil(markdown.length / 4),
      truncated: false,
    });
  });

  it("decodes only the start of a long file and says it was cut", () => {
    const line = "Le bâtiment consomme peu. 🌿\n";
    const text = line.repeat(Math.ceil((PARSE_LIMITS.maxMarkdownChars * 4) / line.length));
    const { markdown, meta } = parsed(parsePlainText(utf8(text)));
    expect(meta.truncated).toBe(true);
    expect(markdown.length).toBeLessThanOrEqual(PARSE_LIMITS.maxMarkdownChars);
    // A character cut at the end of the decoded start doesn't make the text look like Windows-1252.
    expect(markdown.startsWith("Le bâtiment consomme peu. 🌿")).toBe(true);
  });

  it("drops NUL bytes, which Postgres cannot store", () => {
    expect(parsed(parsePlainText(utf8("a\u0000b\u0000"))).markdown).toBe("ab");
  });

  it("decodes a Windows-1252 text file", () => {
    expect(parsed(parsePlainText(new Uint8Array([0x63, 0x6f, 0xfb, 0x74, 0x20, 0x80]))).markdown).toBe(
      "coût €",
    );
  });
});

describe("parsePlainText with Windows line endings", () => {
  it("keeps no carriage returns and folds blank lines", () => {
    const result = parsePlainText(new TextEncoder().encode("Ligne 1\r\n\r\n\r\n\r\nLigne 2\r\n"));
    expect(result.status === "parsed" && result.markdown).toBe("Ligne 1\n\nLigne 2");
  });
});
