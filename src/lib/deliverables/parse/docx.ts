import mammoth from "mammoth";
import { htmlToMarkdown } from "./html-to-markdown";
import { finishMarkdown } from "./markdown";
import { ParseError, type ParseResult } from "./types";
import { guardZip } from "./zip";

// Images are not read at all: the converter gets an empty source instead of
// mammoth's default base64 copy of every picture.
const skipImages = mammoth.images.imgElement(async () => ({ src: "" }));

export async function parseDocx(bytes: Buffer): Promise<ParseResult> {
  guardZip(bytes);
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer: bytes }, { convertImage: skipImages }));
  } catch {
    throw new ParseError("unreadable");
  }
  const { markdown, tables } = htmlToMarkdown(html);
  return { status: "parsed", ...finishMarkdown(markdown, { kind: "document", tables }) };
}
