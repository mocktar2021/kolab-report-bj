import type { FileExtension } from "../file-types";
import { parseDocx } from "./docx";
import { parseCsv, parsePlainText } from "./text";
import type { ParseResult } from "./types";
import { parseXlsx } from "./xlsx";

export { PARSE_LIMITS, ParseError, type ParseErrorKey, type ParseMeta, type ParseResult } from "./types";

/** Extensions the app reads. Everything else is stored as is. */
export function isParsed(extension: FileExtension): boolean {
  return ["docx", "xlsx", "csv", "txt", "md"].includes(extension);
}

const STORED: ParseResult = {
  status: "skipped",
  meta: { version: 1, kind: "stored", words: 0, characters: 0, tokenEstimate: 0, truncated: false },
};

/** Reads a deliverable into Markdown. Throws a ParseError when it cannot. */
export async function parseDeliverableFile(extension: FileExtension, bytes: Buffer): Promise<ParseResult> {
  switch (extension) {
    case "docx":
      return parseDocx(bytes);
    case "xlsx":
      return parseXlsx(bytes);
    case "csv":
      return parseCsv(bytes);
    case "txt":
    case "md":
      return parsePlainText(bytes);
    default:
      return STORED;
  }
}
