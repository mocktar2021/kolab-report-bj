import { cleanText } from "./text";

// A document as the plan reader sees it: one entry per line or paragraph,
// headings apart. Word files (./docx.ts) and text (below) both come down to
// this, so the rules of ./extract.ts are the same for every format.

export type PlanLine =
  | { kind: "heading"; depth: number; text: string }
  | {
      kind: "text";
      /** Spaces before the text, a tab counting four. */
      indent: number;
      text: string;
      /** A paragraph of a Word list: its level and whether it is numbered. */
      list?: { ordered: boolean; depth: number };
      /** Inside a Markdown code block: never a title. */
      code?: boolean;
    }
  | { kind: "blank" };

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(={3,}|-{3,})[ \t]*$/;
const FENCE = /^ {0,3}(```|~~~)/;

function indentOf(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

/**
 * Lines of plain text or Markdown: "#" headings and "Titre" over "===" or
 * "---" are headings, everything else is text. Code blocks stay text.
 */
export function linesFromText(source: string): PlanLine[] {
  const lines: PlanLine[] = [];
  let fence: string | null = null;
  for (const raw of cleanText(source).split("\n")) {
    const fenceMark = FENCE.exec(raw)?.[1];
    if (fenceMark && (fence === null || fence === fenceMark)) {
      fence = fence === null ? fenceMark : null;
      lines.push({ kind: "blank" });
      continue;
    }
    if (raw.trim() === "") {
      lines.push({ kind: "blank" });
      continue;
    }
    const text = raw.trim();
    if (fence !== null) {
      lines.push({ kind: "text", indent: indentOf(raw), text, code: true });
      continue;
    }
    const heading = ATX_HEADING.exec(raw);
    if (heading?.[1]) {
      const title = heading[2]?.trim() ?? "";
      lines.push(title ? { kind: "heading", depth: heading[1].length, text: title } : { kind: "blank" });
      continue;
    }
    const underline = SETEXT_UNDERLINE.exec(raw)?.[1];
    const previous = lines.at(-1);
    if (underline && previous?.kind === "text" && !previous.code) {
      lines[lines.length - 1] = {
        kind: "heading",
        depth: underline.startsWith("=") ? 1 : 2,
        text: previous.text,
      };
      continue;
    }
    lines.push({ kind: "text", indent: indentOf(raw), text });
  }
  return lines;
}
