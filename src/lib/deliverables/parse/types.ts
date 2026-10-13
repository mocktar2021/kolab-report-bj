// What the app keeps after reading a deliverable. parsed_content holds the
// Markdown, parse_meta the ParseMeta below. Messages for ParseErrorKey are
// under Deliverables.parseErrors in messages/fr.json.

/** Safeguards for files people upload. */
export const PARSE_LIMITS = {
  /** Declared size of all the files inside a .docx or .xlsx, unpacked. */
  maxUnpackedBytes: 100 * 1024 * 1024,
  maxZipEntries: 5000,
  maxSheets: 20,
  maxRowsPerSheet: 200,
  maxColumns: 30,
  maxCellChars: 500,
  /** About 50,000 tokens, more than a section draft needs. */
  maxMarkdownChars: 200_000,
  timeoutMs: 45_000,
} as const;

export type ParseErrorKey = "corrupt" | "tooLarge" | "timeout" | "unreadable";

export class ParseError extends Error {
  constructor(readonly key: ParseErrorKey) {
    super(`deliverable parse failed: ${key}`);
    this.name = "ParseError";
  }
}

export type SheetMeta = {
  name: string;
  rows: number;
  columns: number;
  keptRows: number;
  keptColumns: number;
};

export type ParseMeta = {
  version: 1;
  /** "stored" files are kept but not read (PDF, images, diagrams). */
  kind: "document" | "spreadsheet" | "text" | "stored";
  words: number;
  characters: number;
  /** Rough count for the AI draft: about four characters per token. */
  tokenEstimate: number;
  /** The Markdown was cut at maxMarkdownChars. */
  truncated: boolean;
  tables?: number;
  sheets?: SheetMeta[];
};

export type ParseResult =
  | { status: "parsed"; markdown: string; meta: ParseMeta }
  | { status: "skipped"; meta: ParseMeta };
