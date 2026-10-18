// A report's plan, read from a file or pasted text (KRB-196). Nothing here
// touches the database: the plan is a proposal until the owner or admin
// confirms it in the preview, and import_report_plan creates the sections.

/** Bounds of an import. Titles and instructions match the report_sections checks. */
export const PLAN_LIMITS = {
  maxItems: 200,
  maxTitleChars: 200,
  maxInstructionsChars: 4000,
  /** A request body on Vercel holds at most 4.5 MB. */
  maxFileBytes: 4 * 1024 * 1024,
  /** Pasted text, and the start of a .txt or .md file that is read. */
  maxTextChars: 200_000,
  /** Pages of a PDF read for the AI. */
  maxPdfPages: 60,
  /** Text of a PDF sent to the AI: about 20,000 tokens. */
  maxPdfChars: 80_000,
  /** Reading a file, in the worker. */
  timeoutMs: 30_000,
  /** Heap of the worker process. Past it the file is too large. */
  workerHeapMb: 512,
  /** All the memory of that process, buffers outside the heap included (src/lib/process-memory.ts). */
  workerMemoryMb: 1024,
  /** AI readings of PDF plans per person and hour. */
  pdfReadingsPerHour: 10,
} as const;

/** 1 for a section, 2 for a subsection. */
export type PlanLevel = 1 | 2;

export type PlanItem = {
  title: string;
  level: PlanLevel;
  /** The text under the title in the document, for the AI drafts. Empty when there is none. */
  instructions: string;
};

/** Where the structure came from: heading styles, numbered lines, or the AI for a PDF. */
export type PlanSource = "headings" | "numbers" | "ai";

export type ExtractedPlan = {
  items: PlanItem[];
  source: PlanSource;
  /** The document had more than maxItems titles: only the first ones are kept. */
  truncated: boolean;
};

/** Files a plan is read from. */
export const PLAN_FORMATS = ["docx", "txt", "md", "pdf"] as const;

export type PlanFormat = (typeof PLAN_FORMATS)[number];

export type PlanReadErrorKey = "unreadable" | "tooLarge" | "timeout" | "pdfNoText" | "pdfLocked";

export class PlanReadError extends Error {
  constructor(readonly key: PlanReadErrorKey) {
    super(`plan read failed: ${key}`);
    this.name = "PlanReadError";
  }
}
