import ExcelJS from "exceljs";
import { escapeInline, finishMarkdown, heading, storableText, tableToMarkdown } from "./markdown";
import { PARSE_LIMITS, ParseError, type ParseResult, type SheetMeta } from "./types";
import { guardZip } from "./zip";

function dateText(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** What a cell shows: formulas give their result, rich text its plain text. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  // A number too large for a date gives an invalid Date. Excel shows ### for it.
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : dateText(value);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("formula" in value || "sharedFormula" in value) return cellText(value.result ?? null);
    if ("hyperlink" in value) return typeof value.text === "string" ? value.text : cellText(value.text);
    if ("error" in value) return value.error;
    return "";
  }
  if (typeof value === "number") return String(Number(value.toPrecision(15)));
  return String(value);
}

export async function parseXlsx(bytes: Buffer): Promise<ParseResult> {
  guardZip(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs types its Buffer against an older @types/node.
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new ParseError("unreadable");
  }
  // exceljs loads any ZIP without complaint. A real workbook has at least one sheet.
  if (workbook.worksheets.length === 0) throw new ParseError("unreadable");

  const parts: string[] = [];
  const sheets: SheetMeta[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== "visible") continue;
    if (sheets.length === PARSE_LIMITS.maxSheets) break;
    const { top, left, bottom, right } = sheet.dimensions;
    const rows = sheet.actualRowCount === 0 ? 0 : bottom - top + 1;
    const columns = rows === 0 ? 0 : right - left + 1;
    const keptRows = Math.min(rows, PARSE_LIMITS.maxRowsPerSheet);
    const keptColumns = Math.min(columns, PARSE_LIMITS.maxColumns);
    // The name goes into parse_meta, which Postgres stores as JSON.
    const name = storableText(sheet.name);
    sheets.push({ name, rows, columns, keptRows, keptColumns });

    const grid: string[][] = [];
    for (let row = top; row < top + keptRows; row++) {
      const cells: string[] = [];
      for (let column = left; column < left + keptColumns; column++) {
        const cell = sheet.getRow(row).getCell(column);
        // Merged cells show their value once, in the top left cell.
        const text = cell.isMerged && cell.master.address !== cell.address ? "" : cellText(cell.value);
        cells.push(escapeInline(text.slice(0, PARSE_LIMITS.maxCellChars)));
      }
      grid.push(cells);
    }
    parts.push(heading(2, escapeInline(name)), grid.length > 0 ? tableToMarkdown(grid) : "");
  }
  return { status: "parsed", ...finishMarkdown(parts.join("\n\n"), { kind: "spreadsheet", sheets }) };
}
