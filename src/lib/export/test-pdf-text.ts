// Test helper: the text drawn in a PDF made by react-pdf, for the report
// export (KRB-18) and the receipts (KRB-177). Node only.
import { constants, inflateSync } from "node:zlib";

// Bytes 0x80 to 0x9f of WinAnsi. The others are Latin-1.
const WIN_ANSI_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•\u2013\u2014˜™š›œ\u009džŸ";

function decodeWinAnsi(hex: string): string {
  let text = "";
  for (let index = 0; index + 1 < hex.length; index += 2) {
    const byte = parseInt(hex.slice(index, index + 2), 16);
    text += byte >= 0x80 && byte <= 0x9f ? WIN_ANSI_HIGH[byte - 0x80] : String.fromCharCode(byte);
  }
  return text;
}

/**
 * Text drawn in a PDF made by react-pdf, one line per TJ operator. A line of
 * the page can span several of them, so tests compare text without its
 * spaces (see squash). The content streams are deflated and draw hex
 * strings in the WinAnsi encoding of the standard fonts.
 */
export function pdfText(pdf: Buffer): string {
  const source = pdf.toString("latin1");
  const lines: string[] = [];
  for (const match of source.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = source.indexOf("endstream", start);
    let content: string;
    try {
      content = inflateSync(pdf.subarray(start, end), { finishFlush: constants.Z_SYNC_FLUSH }).toString(
        "latin1",
      );
    } catch {
      continue;
    }
    for (const array of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      lines.push(
        [...(array[1] ?? "").matchAll(/<([0-9a-f]*)>/gi)].map((hex) => decodeWinAnsi(hex[1] ?? "")).join(""),
      );
    }
  }
  return lines.join("\n");
}

/** Text without spaces or line breaks, to compare what pdfText finds. */
export function squash(text: string): string {
  return text.replace(/[\s ]+/g, "");
}

/** Number of pages of a PDF made by react-pdf. */
export function pdfPageCount(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}
