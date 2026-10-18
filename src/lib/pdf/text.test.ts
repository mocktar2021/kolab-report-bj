// @vitest-environment node
import { getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { testPdf } from "./test-pdf";
import { PdfReadError, readPdfText } from "./text";

// The shared PDF reader (KRB-214) on PDFs built by ./test-pdf.ts: text, a
// scan, a password, and the page, character and time limits.

const LIMITS = { maxPages: 50, maxChars: 10_000 };

async function errorKey(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof PdfReadError)) throw new Error(`expected a PdfReadError, got ${String(error)}`);
  return error.key;
}

const pages = (count: number) => Array.from({ length: count }, (_, index) => [`Page ${index + 1}`]);

describe("readPdfText", () => {
  it("reads the lines of every page, a blank line between pages", async () => {
    const pdf = testPdf(
      [
        ["Étude thermique du siège", "Le bâtiment consomme 182 kWh/m² par an."],
        ["Annexe : relevés de l’hiver"],
      ],
      { deflate: true },
    );
    expect(await readPdfText(pdf, LIMITS)).toEqual({
      text: "Étude thermique du siège\nLe bâtiment consomme 182 kWh/m² par an.\n\nAnnexe : relevés de l’hiver",
      pages: 2,
      pagesRead: 2,
      truncated: false,
    });
  });

  it("leaves the bytes it was given as they were", async () => {
    const pdf = testPdf([["Texte"]]);
    const copy = pdf.slice();
    await readPdfText(pdf, LIMITS);
    expect(pdf).toEqual(copy);
  });

  it("says a scanned PDF has no text", async () => {
    expect(await errorKey(readPdfText(testPdf([[], []], { image: true }), LIMITS))).toBe("noText");
  });

  it("says a PDF is locked when a password protects it", async () => {
    const locked = testPdf([["Confidentiel"]], { password: "kolab", deflate: true });
    expect(await errorKey(readPdfText(locked, LIMITS))).toBe("locked");
    // The file is a real encrypted PDF: its password opens it.
    const pdf = await getDocumentProxy(locked, { password: "kolab" });
    const content = await (await pdf.getPage(1)).getTextContent();
    expect(content.items.map((item) => ("str" in item ? item.str : ""))).toContain("Confidentiel");
    await pdf.loadingTask.destroy();
  });

  it("says a file pdf.js cannot open is unreadable", async () => {
    expect(await errorKey(readPdfText(new TextEncoder().encode("%PDF-1.4\nrien"), LIMITS))).toBe(
      "unreadable",
    );
  });

  it("reads maxPages pages at most", async () => {
    const result = await readPdfText(testPdf(pages(5)), { ...LIMITS, maxPages: 3 });
    expect(result).toEqual({ text: "Page 1\n\nPage 2\n\nPage 3", pages: 5, pagesRead: 3, truncated: true });
  });

  it("cuts the text on a line at maxChars and reads no page past it", async () => {
    const line = "Mesure de la consommation du bâtiment";
    const result = await readPdfText(testPdf([[line, line, line], [line], [line]]), {
      ...LIMITS,
      maxChars: 100,
    });
    expect(result.text).toBe(`${line}\n${line}`);
    expect(result).toMatchObject({ pages: 3, pagesRead: 1, truncated: true });
  });

  it("starts no page past stopAt and keeps the pages read", async () => {
    const result = await readPdfText(testPdf(pages(4)), { ...LIMITS, stopAt: Date.now() - 1 });
    expect(result).toEqual({ text: "Page 1", pages: 4, pagesRead: 1, truncated: true });
  });

  it("says time ran out, not that there is no text, when the pages read had none", async () => {
    const pdf = testPdf([[], ["Texte plus loin"]], { image: true });
    expect(await errorKey(readPdfText(pdf, { ...LIMITS, stopAt: Date.now() - 1 }))).toBe("timeout");
  });
});
