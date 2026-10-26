import { escapeInline, finishMarkdown, tableToMarkdown } from "./markdown";
import { PARSE_LIMITS, type ParseResult } from "./types";

// Windows-1252 characters for bytes 0x80 to 0x9F. Some Node versions decode
// "windows-1252" as Latin-1 and give control characters there instead of
// the euro sign, "œ" or the curly apostrophe.
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d,
  0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a,
  0x153, 0x9d, 0x17e, 0x178,
];

/**
 * UTF-8 when it is valid, UTF-16 with a byte order mark, otherwise
 * Windows-1252 (Excel's CSV). `partial` is for the start of a longer file:
 * a character cut at the end is then dropped instead of making the UTF-8
 * look invalid.
 */
export function decodeText(bytes: Uint8Array, partial = false): string {
  const options = { stream: partial };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes, options);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes, options);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes, options);
  } catch {
    return new TextDecoder("windows-1252")
      .decode(bytes)
      .replace(/[\u0080-\u009f]/g, (char) =>
        String.fromCharCode(WINDOWS_1252_HIGH[char.charCodeAt(0) - 0x80] ?? char.charCodeAt(0)),
      );
  }
}

/**
 * French Excel writes ";" between values, others "," or tabs. Counted on the
 * start of the first line, quoted values left out.
 */
function delimiterOf(text: string): string {
  const start = text.slice(0, 64 * 1024);
  const firstLine = start.slice(0, start.search(/\r?\n|$/)).replace(/"[^"]*"/g, "");
  const counts = [";", ",", "\t"].map((delimiter) => [delimiter, firstLine.split(delimiter).length] as const);
  return counts.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

/** Rows of a CSV text, quotes handled, cut at the parse limits. `cellsCut`: a value was longer than maxCellChars. */
export function parseCsvRows(text: string): {
  rows: string[][];
  totalRows: number;
  totalColumns: number;
  cellsCut: boolean;
} {
  const delimiter = delimiterOf(text);
  const rows: string[][] = [];
  // Values past the column limit are counted, not kept.
  let row: string[] = [];
  let columns = 0;
  let value = "";
  let quoted = false;
  let totalRows = 0;
  let totalColumns = 0;
  let cellsCut = false;
  const endValue = () => {
    if (columns < PARSE_LIMITS.maxColumns) row.push(value);
    columns++;
    value = "";
  };
  const endRow = () => {
    endValue();
    if (columns > 1 || row[0] !== "") {
      totalRows++;
      totalColumns = Math.max(totalColumns, columns);
      if (rows.length < PARSE_LIMITS.maxRowsPerSheet) rows.push(row);
    }
    row = [];
    columns = 0;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        value += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else if (value.length < PARSE_LIMITS.maxCellChars) {
        value += char;
      } else {
        cellsCut = true;
      }
    } else if (char === '"' && value === "") {
      quoted = true;
    } else if (char === delimiter) {
      endValue();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text.charAt(index + 1) === "\n") index++;
      endRow();
    } else if (value.length < PARSE_LIMITS.maxCellChars) {
      value += char;
    } else {
      cellsCut = true;
    }
  }
  if (value !== "" || columns > 0) endRow();
  return { rows, totalRows, totalColumns, cellsCut };
}

export function parseCsv(bytes: Uint8Array): ParseResult {
  const { rows, totalRows, totalColumns, cellsCut } = parseCsvRows(decodeText(bytes));
  const grid = rows.map((row) => row.map(escapeInline));
  const sheet = {
    name: "CSV",
    rows: totalRows,
    columns: totalColumns,
    keptRows: rows.length,
    keptColumns: Math.min(totalColumns, PARSE_LIMITS.maxColumns),
  };
  const { markdown, meta } = finishMarkdown(tableToMarkdown(grid), { kind: "spreadsheet", sheets: [sheet] });
  const partial = cellsCut || sheet.keptRows < sheet.rows || sheet.keptColumns < sheet.columns;
  return { status: "parsed", markdown, meta: { ...meta, truncated: meta.truncated || partial } };
}

/** Bytes of a text file that hold at least maxMarkdownChars characters, whatever the encoding. */
const TEXT_BYTES = PARSE_LIMITS.maxMarkdownChars * 3;

/**
 * Plain text and Markdown files are kept as they are, and previewed as plain
 * text. Only the start that can be kept is decoded.
 */
export function parsePlainText(bytes: Uint8Array): ParseResult {
  const cut = bytes.length > TEXT_BYTES;
  const { markdown, meta } = finishMarkdown(decodeText(bytes.subarray(0, TEXT_BYTES), cut), { kind: "text" });
  return { status: "parsed", markdown, meta: { ...meta, truncated: meta.truncated || cut } };
}
