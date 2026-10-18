import type { FileExtension } from "../file-types";
import { parseDocx } from "./docx";
import { parsePdf } from "./pdf";
import { parseCsv, parsePlainText } from "./text";
import { type ParseResult, STORED_RESULT } from "./types";
import { parseXlsx } from "./xlsx";

export {
  isParsed,
  PARSE_LIMITS,
  ParseError,
  type ParseErrorKey,
  type ParseMeta,
  type ParseResult,
} from "./types";

/**
 * Reads a deliverable into Markdown, or plain text for text and PDF files.
 * Throws a ParseError when it cannot. A PDF starts no new page past `stopAt`.
 */
export async function parseDeliverableFile(
  extension: FileExtension,
  bytes: Buffer,
  { stopAt }: { stopAt?: number } = {},
): Promise<ParseResult> {
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
    case "pdf":
      return parsePdf(bytes, { stopAt });
    default:
      return STORED_RESULT;
  }
}
