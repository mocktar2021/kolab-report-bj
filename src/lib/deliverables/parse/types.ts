import { type FileExtension, fileTypeFor } from "../file-types";

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
  // The AI reads a file whole or not at all (KRB-253), so these let real
  // files through whole. A file past one of them is read in part, flagged,
  // and kept out of AI drafts.
  maxSheets: 50,
  maxRowsPerSheet: 5_000,
  maxColumns: 100,
  maxCellChars: 5_000,
  /** About 600 pages of text, some 500,000 tokens. */
  maxMarkdownChars: 2_000_000,
  /** Pages of a PDF read. The text of most files reaches maxMarkdownChars well before. */
  maxPdfPages: 2_000,
  /** Download and read together. */
  timeoutMs: 45_000,
  /** Heap of the process that reads a file. Past it the process ends and the file is too large. */
  workerHeapMb: 512,
  /** All the memory of that process, buffers outside the heap included (src/lib/process-memory.ts). */
  workerMemoryMb: 1024,
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
  /** "stored" files are kept but not read (images, diagrams, presentations). */
  kind: "document" | "spreadsheet" | "text" | "pdf" | "stored";
  words: number;
  characters: number;
  /** Rough count for the AI draft: about four characters per token. */
  tokenEstimate: number;
  /**
   * Something was left out: text past maxMarkdownChars, or a sheet, row,
   * column or cell text past the spreadsheet limits. Files read before
   * KRB-253 only set it for the text; readInPart covers their other cases.
   */
  truncated: boolean;
  tables?: number;
  sheets?: SheetMeta[];
  /** Pages of a PDF, and how many of them were read. */
  pages?: number;
  pagesRead?: number;
  /** Why a PDF is kept without its text: it has none, as a scan, or a password locks it. */
  reason?: "noText" | "locked";
};

/**
 * The file was read only in part: its text, pages, sheets, rows or columns
 * went past the limits. The AI never drafts from such a file (KRB-253).
 */
export function readInPart(meta: ParseMeta | null | undefined): boolean {
  if (!meta) return false;
  if (meta.truncated) return true;
  if (meta.pages !== undefined && meta.pagesRead !== undefined && meta.pagesRead < meta.pages) return true;
  return (meta.sheets ?? []).some(
    (sheet) => sheet.keptRows < sheet.rows || sheet.keptColumns < sheet.columns,
  );
}

export type ParseResult =
  { status: "parsed"; markdown: string; meta: ParseMeta } | { status: "skipped"; meta: ParseMeta };

/** Extensions the app reads. Everything else is stored as is. */
export function isParsed(extension: FileExtension): boolean {
  return ["docx", "xlsx", "csv", "txt", "md", "pdf"].includes(extension);
}

/**
 * A file kept without being read, of a type the app reads now: a PDF
 * uploaded before KRB-214. "Analyser" reads it (retryParse).
 */
export function isKeptUnread(fileName: string, status: string, meta: unknown): boolean {
  const type = fileTypeFor(fileName);
  const kind = meta && typeof meta === "object" && "kind" in meta ? meta.kind : null;
  return status === "skipped" && type !== null && isParsed(type.extension) && kind === "stored";
}

/** The result for a file the app keeps without reading it. */
export const STORED_RESULT: ParseResult = {
  status: "skipped",
  meta: { version: 1, kind: "stored", words: 0, characters: 0, tokenEstimate: 0, truncated: false },
};
