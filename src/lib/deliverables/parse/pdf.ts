import { PdfReadError, readPdfText } from "../../pdf/text";
import { finishMarkdown } from "./markdown";
import { PARSE_LIMITS, ParseError, type ParseResult, STORED_RESULT } from "./types";

// PDF deliverables (KRB-214). The shared reader (src/lib/pdf/text.ts) gives
// the text of the first pages, kept as plain text like a .txt file and
// previewed as such. A PDF with no text, such as a scan, or locked by a
// password is kept as is and says why in its meta.

/** Reads a PDF. Past `stopAt` no new page starts, and the pages read are kept. */
export async function parsePdf(
  bytes: Uint8Array,
  { stopAt }: { stopAt?: number } = {},
): Promise<ParseResult> {
  try {
    const pdf = await readPdfText(bytes, {
      maxPages: PARSE_LIMITS.maxPdfPages,
      maxChars: PARSE_LIMITS.maxMarkdownChars,
      stopAt,
    });
    const { markdown, meta } = finishMarkdown(pdf.text, { kind: "pdf" });
    return {
      status: "parsed",
      markdown,
      meta: {
        ...meta,
        truncated: meta.truncated || pdf.truncated,
        pages: pdf.pages,
        pagesRead: pdf.pagesRead,
      },
    };
  } catch (error) {
    if (!(error instanceof PdfReadError)) throw error;
    if (error.key === "noText" || error.key === "locked")
      return { status: "skipped", meta: { ...STORED_RESULT.meta, kind: "pdf", reason: error.key } };
    throw new ParseError(error.key);
  }
}
