import { type ChildNode, type Element, isTag, isText } from "domhandler";
import { parseDocument } from "htmlparser2";
import mammoth from "mammoth";
import { guardZip } from "../deliverables/parse/zip";
import type { PlanLine } from "./lines";
import { PlanReadError } from "./types";

// The lines of a Word plan. mammoth turns heading styles into <h1>..<h6>: its
// default map covers Word's built-in "Heading 1" whatever the language, since
// a French Word file names it "heading 1" with the id "Titre1". The map below
// adds styles really named "Titre 1" (French templates, LibreOffice) and the
// "Titre1" id. Numbered and bulleted paragraphs come as lists, with their
// level. Images are not read.

const HEADING_STYLES = [1, 2, 3, 4, 5, 6].flatMap((level) => [
  `p[style-name='Titre ${level}'] => h${level}:fresh`,
  `p.Titre${level} => h${level}:fresh`,
]);

const skipImages = mammoth.images.imgElement(async () => ({ src: "" }));

const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

/** Footnote and endnote marks and lists, which mammoth adds at the end. */
function isNote(element: Element): boolean {
  const href = element.attribs.href ?? "";
  const id = element.attribs.id ?? "";
  return /^#(footnote|endnote)/.test(href) || /^(footnote|endnote)-\d/.test(id);
}

/** Text of inline content. `lineBreak` is what <br> becomes. */
function inline(nodes: ChildNode[], lineBreak: string): string {
  return nodes
    .map((node) => {
      if (isText(node)) return node.data.replace(/\s+/g, " ");
      if (!isTag(node) || isNote(node)) return "";
      if (node.name === "br") return lineBreak;
      if (node.name === "img") return "";
      if (node.name === "p") return ` ${inline(node.children, lineBreak)} `;
      // A list or table inside a paragraph or a cell: its text, in a row.
      if (node.name === "ul" || node.name === "ol" || node.name === "table")
        return ` ${inline(node.children, " ")} `;
      return inline(node.children, lineBreak);
    })
    .join("");
}

function textLines(text: string, extra: Partial<Extract<PlanLine, { kind: "text" }>> = {}): PlanLine[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => ({ kind: "text" as const, indent: 0, text: line, ...extra }));
}

function listLines(list: Element, depth: number): PlanLine[] {
  const ordered = list.name === "ol";
  return list.children.flatMap((item) => {
    if (!isTag(item) || item.name !== "li" || isNote(item)) return [];
    const own = item.children.filter((node) => !(isTag(node) && (node.name === "ul" || node.name === "ol")));
    const nested = item.children.filter(
      (node): node is Element => isTag(node) && (node.name === "ul" || node.name === "ol"),
    );
    return [
      ...textLines(inline(own, " "), { list: { ordered, depth } }),
      ...nested.flatMap((sub) => listLines(sub, depth + 1)),
    ];
  });
}

function tableLines(table: Element): PlanLine[] {
  const rows: Element[] = [];
  const visit = (nodes: ChildNode[]) => {
    for (const node of nodes) {
      if (!isTag(node)) continue;
      if (node.name === "tr") rows.push(node);
      else if (node.name !== "table") visit(node.children);
    }
  };
  visit(table.children);
  return rows.flatMap((row) =>
    textLines(
      row.children
        .filter((cell): cell is Element => isTag(cell) && (cell.name === "td" || cell.name === "th"))
        .map((cell) => inline(cell.children, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" | "),
    ),
  );
}

function blockLines(nodes: ChildNode[]): PlanLine[] {
  return nodes.flatMap((node): PlanLine[] => {
    if (isText(node)) return textLines(node.data);
    if (!isTag(node) || isNote(node)) return [];
    const depth = HEADINGS[node.name];
    if (depth) {
      const text = inline(node.children, " ").replace(/\s+/g, " ").trim();
      return text ? [{ kind: "heading", depth, text }] : [];
    }
    switch (node.name) {
      case "p":
        return [...textLines(inline(node.children, "\n")), { kind: "blank" }];
      case "ul":
      case "ol":
        return [...listLines(node, 0), { kind: "blank" }];
      case "table":
        return [...tableLines(node), { kind: "blank" }];
      default:
        return blockLines(node.children);
    }
  });
}

/** The lines of mammoth's HTML. */
export function linesFromDocxHtml(html: string): PlanLine[] {
  return blockLines(parseDocument(html).children);
}

/** The lines of a .docx file. Throws a PlanReadError when the file can't be read. */
export async function linesFromDocx(bytes: Buffer): Promise<PlanLine[]> {
  // An archive that unpacks to too much, or isn't one, stops here.
  guardZip(bytes);
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml(
      { buffer: bytes },
      { styleMap: HEADING_STYLES, convertImage: skipImages },
    ));
  } catch {
    throw new PlanReadError("unreadable");
  }
  return linesFromDocxHtml(html);
}
