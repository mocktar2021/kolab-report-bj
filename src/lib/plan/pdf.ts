import { PdfReadError, readPdfText as readText } from "../pdf/text";
import { PLAN_LIMITS, PlanReadError, type PlanReadErrorKey } from "./types";

// The text of a PDF plan, for the AI (KRB-196). The reader is shared with
// the deliverables (src/lib/pdf/text.ts); a plan keeps its own limits.

export type PdfText = {
  text: string;
  /** Pages in the file. */
  pages: number;
  /** Pages or characters were left out. */
  truncated: boolean;
};

const ERROR_KEYS: Record<PdfReadError["key"], PlanReadErrorKey> = {
  locked: "pdfLocked",
  noText: "pdfNoText",
  timeout: "timeout",
  unreadable: "unreadable",
};

/** Reads the text of a PDF. Throws a PlanReadError when it can't, or when it has no text. */
export async function readPdfText(bytes: Uint8Array): Promise<PdfText> {
  try {
    const { text, pages, truncated } = await readText(bytes, {
      maxPages: PLAN_LIMITS.maxPdfPages,
      maxChars: PLAN_LIMITS.maxPdfChars,
    });
    return { text, pages, truncated };
  } catch (error) {
    throw new PlanReadError(error instanceof PdfReadError ? ERROR_KEYS[error.key] : "unreadable");
  }
}
