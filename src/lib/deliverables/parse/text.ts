import { escapeInline, finishMarkdown, tableToMarkdown } from "./markdown";
import { PARSE_LIMITS, type ParseResult } from "./types";

/** UTF-8 when it is valid, UTF-16 with a byte order mark, otherwise Windows-1252 (Excel's CSV). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** French Excel writes ";" between values, others "," or tabs. */
function delimiterOf(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = [";", ",", "\t"].map((delimiter) => [delimiter, firstLine.split(delimiter).length] as const);
  return counts.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

/** Rows of a CSV text, quotes handled, cut at the parse limits. */
export function parseCsvRows(text: string): { rows: string[][]; totalRows: number; totalColumns: number } {
  const delimiter = delimiterOf(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let totalRows = 0;
  let totalColumns = 0;
  const endValue = () => {
    row.push(value);
    value = "";
  };
  const endRow = () => {
    endValue();
    if (row.length > 1 || row[0] !== "") {
      totalRows++;
      totalColumns = Math.max(totalColumns, row.length);
      if (rows.length < PARSE_LIMITS.maxRowsPerSheet) rows.push(row.slice(0, PARSE_LIMITS.maxColumns));
    }
    row = [];
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
    }
  }
  if (value !== "" || row.length > 0) endRow();
  return { rows, totalRows, totalColumns };
}

export function parseCsv(bytes: Uint8Array): ParseResult {
  const { rows, totalRows, totalColumns } = parseCsvRows(decodeText(bytes));
  const grid = rows.map((row) => row.map(escapeInline));
  const sheet = {
    name: "CSV",
    rows: totalRows,
    columns: totalColumns,
    keptRows: rows.length,
    keptColumns: Math.min(totalColumns, PARSE_LIMITS.maxColumns),
  };
  return {
    status: "parsed",
    ...finishMarkdown(tableToMarkdown(grid), { kind: "spreadsheet", sheets: [sheet] }),
  };
}

/** Plain text and Markdown files are kept as they are. */
export function parsePlainText(bytes: Uint8Array): ParseResult {
  return { status: "parsed", ...finishMarkdown(decodeText(bytes), { kind: "text" }) };
}
