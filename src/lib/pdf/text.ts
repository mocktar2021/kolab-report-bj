import { getDocumentProxy } from "unpdf";
import { cleanText } from "../plan/text";

// The text of a PDF, for the plan import (KRB-196) and the deliverables
// (KRB-214). unpdf ships a build of Mozilla's pdf.js that runs in Node
// without a canvas or a worker thread. Only the first pages and characters
// are read; scanned pages have no text. Callers run it in a child process
// with a memory limit and a deadline.

export type PdfTextLimits = {
  maxPages: number;
  maxChars: number;
  /** Date.now() past which no new page is started. The pages read so far are kept. */
  stopAt?: number;
};

export type PdfText = {
  text: string;
  /** Pages in the file. */
  pages: number;
  /** Pages whose text was read. */
  pagesRead: number;
  /** Pages or characters were left out. */
  truncated: boolean;
};

/** locked: a password protects the file. noText: no letter or digit in the pages read. */
export type PdfReadErrorKey = "locked" | "noText" | "timeout" | "unreadable";

export class PdfReadError extends Error {
  constructor(readonly key: PdfReadErrorKey) {
    super(`pdf read failed: ${key}`);
    this.name = "PdfReadError";
  }
}

/**
 * Only the text is wanted: no @font-face, no system font. pdf.js 6 no longer
 * compiles fonts with eval and ignores isEvalSupported. It is still set, in
 * case an older pdf.js comes back (CVE-2024-4367).
 */
const OPTIONS = {
  disableFontFace: true,
  useSystemFonts: false,
  isEvalSupported: false,
  verbosity: 0,
};

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

async function pageText(pdf: PdfDocument, number: number): Promise<string> {
  const page = await pdf.getPage(number);
  try {
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str;
      if (item.hasEOL) text += "\n";
    }
    return text;
  } finally {
    page.cleanup();
  }
}

/** Reads the text of a PDF. Throws a PdfReadError when it can't, or when it has no text. */
export async function readPdfText(bytes: Uint8Array, limits: PdfTextLimits): Promise<PdfText> {
  let pdf: PdfDocument;
  try {
    // A copy: pdf.js takes the buffer over.
    pdf = await getDocumentProxy(new Uint8Array(bytes), OPTIONS);
  } catch (error) {
    throw new PdfReadError(
      error instanceof Error && error.name === "PasswordException" ? "locked" : "unreadable",
    );
  }
  try {
    const pages = pdf.numPages;
    const read = Math.min(pages, limits.maxPages);
    const parts: string[] = [];
    let length = 0;
    let outOfTime = false;
    for (let number = 1; number <= read && length <= limits.maxChars; number++) {
      if (number > 1 && limits.stopAt !== undefined && Date.now() >= limits.stopAt) {
        outOfTime = true;
        break;
      }
      const text = cleanText(await pageText(pdf, number))
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      parts.push(text);
      length += text.length + 2;
    }
    let text = parts.filter(Boolean).join("\n\n");
    let truncated = parts.length < pages;
    if (text.length > limits.maxChars) {
      const cut = text.lastIndexOf("\n", limits.maxChars);
      text = text.slice(0, cut > 0 ? cut : limits.maxChars).trimEnd();
      truncated = true;
    }
    // Pages left unread for lack of time may hold the text.
    if (!/[\p{L}\p{N}]/u.test(text)) throw new PdfReadError(outOfTime ? "timeout" : "noText");
    return { text, pages, pagesRead: parts.length, truncated };
  } catch (error) {
    throw error instanceof PdfReadError ? error : new PdfReadError("unreadable");
  } finally {
    // Frees the document; the worker process ends right after anyway.
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}
