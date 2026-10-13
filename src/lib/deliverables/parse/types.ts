import type { FileExtension } from "../file-types";

// What the app keeps after reading a deliverable. parsed_content holds the
// Markdown, parse_meta the ParseMeta below. Messages for ParseErrorKey are
// under Deliverables.parseErrors in messages/fr.json.

/** Safeguards for files people upload. */
export const PARSE_LIMITS = {
  /** Size of all the files inside a .docx or .xlsx, measured while unpacking them. */
  maxUnpackedBytes: 100 * 1024 * 1024,
  /** Of which the XML parts, which the parsers load into memory as text and trees. */
  maxXmlBytes: 20 * 1024 * 1024,
  maxZipEntries: 5000,
  maxSheets: 20,
  maxRowsPerSheet: 200,
  maxColumns: 30,
  maxCellChars: 500,
  /** About 50,000 tokens, more than a section draft needs. */
  maxMarkdownChars: 200_000,
  /** Download and read together. */
  timeoutMs: 45_000,
  /** Heap of the process that reads a file. Past it the process ends and the file is too large. */
  workerHeapMb: 512,
} as const;

/** A read still running after this long is taken for one that died, and can be retried. */
export const STALE_PARSE_MS = 5 * 60 * 1000;

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

/** Extensions the app reads. Everything else is stored as is. */
export function isParsed(extension: FileExtension): boolean {
  return ["docx", "xlsx", "csv", "txt", "md"].includes(extension);
}

/** The result for a file the app keeps without reading it. */
export const STORED_RESULT: ParseResult = {
  status: "skipped",
  meta: { version: 1, kind: "stored", words: 0, characters: 0, tokenEstimate: 0, truncated: false },
};
