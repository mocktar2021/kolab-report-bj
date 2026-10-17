import { getDocumentProxy } from "unpdf";
import { cleanText } from "./text";
import { PLAN_LIMITS, PlanReadError } from "./types";

// The text of a PDF plan, for the AI (KRB-196). unpdf ships a build of
// Mozilla's pdf.js that runs in Node without a canvas or a worker thread.
// Only the first pages and characters are read; scanned pages have no text.

export type PdfText = {
  text: string;
  /** Pages in the file. */
  pages: number;
  /** Pages or characters were left out. */
  truncated: boolean;
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

/** Reads the text of a PDF. Throws a PlanReadError when it can't, or when it has no text. */
export async function readPdfText(bytes: Uint8Array): Promise<PdfText> {
  let pdf: PdfDocument;
  try {
    // A copy: pdf.js takes the buffer over.
    pdf = await getDocumentProxy(new Uint8Array(bytes), {
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });
  } catch (error) {
    throw new PlanReadError(
      error instanceof Error && error.name === "PasswordException" ? "pdfLocked" : "unreadable",
    );
  }
  try {
    const pages = pdf.numPages;
    const read = Math.min(pages, PLAN_LIMITS.maxPdfPages);
    const parts: string[] = [];
    let length = 0;
    for (let number = 1; number <= read && length <= PLAN_LIMITS.maxPdfChars; number++) {
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
    let truncated = read < pages || parts.length < read;
    if (text.length > PLAN_LIMITS.maxPdfChars) {
      const cut = text.lastIndexOf("\n", PLAN_LIMITS.maxPdfChars);
      text = text.slice(0, cut > 0 ? cut : PLAN_LIMITS.maxPdfChars).trimEnd();
      truncated = true;
    }
    if (!/[\p{L}\p{N}]/u.test(text)) throw new PlanReadError("pdfNoText");
    return { text, pages, truncated };
  } catch (error) {
    throw error instanceof PlanReadError ? error : new PlanReadError("unreadable");
  } finally {
    // Frees the document; the worker process ends right after anyway.
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}
