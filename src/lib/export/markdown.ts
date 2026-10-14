import type { Nodes, Root, RootContent, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

// Section Markdown (GFM) turned into a short list of blocks that the .docx and
// PDF builders both draw (KRB-18). The rules match the app's Markdown view:
// links stay text followed by their address and are never clickable, images
// become their alt text and are never fetched, raw HTML is kept as plain text
// and never interpreted.
//
// The parser has inputs that cost quadratic time (thousands of emphasis
// markers in one paragraph) or overflow the stack (thousands of nested
// quotes). parseRisk spots them before parsing and the section is then shown
// as plain text, so one section can't stall or crash an export.

export const EXPORT_LIMITS = {
  /** Lists and quotes nested deeper than this are drawn at this depth. */
  depth: 6,
  /** A table keeps this many columns. The cells past it are merged into the last one. */
  tableColumns: 20,
  /** Characters kept in that merged cell. */
  mergedCellChars: 200,
  /** Characters read per section. The database allows 100 000. */
  sectionChars: 200_000,
  /** Leading indentation, quote and list markers allowed on one line. */
  linePrefix: 200,
  /** Sum over paragraphs of the squared count of * _ ~ [ ] characters. About 0.3 s of parsing at worst. */
  emphasisRisk: 5_000_000,
} as const;

export type TextRun = {
  /** "\n" is a hard line break. */
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
};

export type TextMarks = Omit<TextRun, "text">;

export type ColumnAlign = "left" | "center" | "right" | null;

export type ListItem = { checked: boolean | null; blocks: Block[] };

/** Where a block is drawn: inside how many quotes and lists. */
export type Place = { quotes: number; lists: number };

export const TOP_PLACE: Place = { quotes: 0, lists: 0 };

/** One quote or list deeper, unless that passes EXPORT_LIMITS.depth: then the same place. */
export function nest(place: Place, kind: keyof Place): Place {
  if (place.quotes + place.lists >= EXPORT_LIMITS.depth) return place;
  return { ...place, [kind]: place[kind] + 1 };
}

export type Block =
  /** depth is the Markdown level: 1 for #. */
  | { type: "heading"; depth: number; runs: TextRun[] }
  | { type: "paragraph"; runs: TextRun[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "quote"; blocks: Block[] }
  | { type: "code"; text: string }
  | { type: "rule" }
  /** rows[0] is the header row. Every row has align.length cells. */
  | { type: "table"; align: ColumnAlign[]; rows: TextRun[][][] };

// C0 controls except tab and newline, DEL, C1 controls, and the two
// non-characters XML refuses.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ufffe\uffff]/g;

/**
 * Text that is safe in a .docx or a PDF: line endings become "\n", control
 * characters go (tab and newline stay) and a lone half of a surrogate pair
 * becomes U+FFFD.
 */
export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(CONTROL_CHARACTERS, "").toWellFormed();
}

/** The address to show after a link's text, or null when the text already is the address. */
function shownAddress(text: string, url: string): string | null {
  const address = url.trim();
  const shown = text.trim();
  if (!address || shown === address) return null;
  return shown === address.replace(/^(?:https?:\/\/|mailto:)/i, "") ? null : address;
}

/** One line of text for titles and names: cleaned, line breaks and runs of spaces made one space. */
export function cleanLine(text: string): string {
  return cleanText(text)
    .replace(/[ \t\n]+/g, " ")
    .trim();
}

/** A link as plain text: "text (url)", the text alone when it is the address, the address when there is no text. */
export function linkText(text: string, url: string): string {
  if (!text.trim()) return url.trim();
  const address = shownAddress(text, url);
  return address ? `${text} (${address})` : text;
}

// Every pattern below matches in linear time: no two parts can take the same
// characters, so a failed match never backtracks far.
const LINE_PREFIX = /^(?:[ \t>]|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))*/;
const CONTAINER = /^[ \t>]*/;
// After the quote markers: an ATX heading, or a list item that can interrupt
// a paragraph, with at most three spaces of indent.
const BLOCK_START = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|[-*+][ \t]+\S|1[.)][ \t]+\S)/;
const LIST_ITEM = /^[-*+][ \t]|^\d{1,9}[.)][ \t]/;
const NOT_A_HEADER = /^(?:#|```|~~~|<)/;
// Tested on a line with its trailing spaces removed.
const DELIMITER_ROW = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?$/;
const EMPHASIS_CHARACTERS = /[*_~[\]]/g;

/** True when the line always ends the paragraph before it. */
function startsNewContext(line: string): boolean {
  let index = 0;
  // Quote markers, each after at most three spaces and before an optional one.
  for (;;) {
    let spaces = 0;
    while (spaces < 4 && line[index + spaces] === " ") spaces++;
    if (spaces > 3 || line[index + spaces] !== ">") break;
    index += spaces + 1;
    if (line[index] === " ") index++;
  }
  return BLOCK_START.test(line.slice(index));
}

/** Cells of a table row: the unescaped pipes, leading and trailing ones aside. */
function cellCount(row: string): number {
  const trimmed = row.trim();
  let pipes = 0;
  for (let index = 0; index < trimmed.length; index++) {
    if (trimmed[index] === "\\") index++;
    else if (trimmed[index] === "|") pipes++;
  }
  if (trimmed.startsWith("|")) pipes--;
  if (trimmed.length > 1 && trimmed.endsWith("|") && !trimmed.endsWith("\\|")) pipes--;
  return pipes + 1;
}

/**
 * How costly the text is to parse, in one linear pass: the longest line
 * prefix of containers, and the sum over paragraphs of the squared number of
 * emphasis and bracket characters. Paragraphs end at blank lines, headings
 * and list items. Each row of a table counts alone, but only when the header
 * and delimiter rows make it certain the parser sees a table. Where it is not
 * sure, it counts lines together, which can only overestimate.
 */
export function parseRisk(text: string): { prefix: number; emphasis: number } {
  let prefix = 0;
  let emphasis = 0;
  let group = 0;
  let groupLines = 0;
  let afterBlank = true;
  let header: { container: string; cells: number } | null = null;
  let table: string | null = null;
  const close = () => {
    emphasis += group * group;
    group = 0;
    groupLines = 0;
  };
  for (const line of text.split("\n")) {
    prefix = Math.max(prefix, LINE_PREFIX.exec(line)?.[0].length ?? 0);
    const container = CONTAINER.exec(line)?.[0] ?? "";
    const rest = line.slice(container.length);
    const count = line.match(EMPHASIS_CHARACTERS)?.length ?? 0;
    if (!rest.trim()) {
      close();
      afterBlank = true;
      header = null;
      table = null;
      continue;
    }
    if (table !== null) {
      if (container === table && rest.startsWith("|")) {
        close();
        group = count;
        continue;
      }
      table = null;
      close();
    } else if (
      header &&
      groupLines === 1 &&
      container === header.container &&
      rest.includes("|") &&
      DELIMITER_ROW.test(rest.trimEnd()) &&
      cellCount(rest) === header.cells
    ) {
      close();
      table = container;
      header = null;
      continue;
    } else if (startsNewContext(line)) {
      close();
    }
    header =
      afterBlank &&
      groupLines === 0 &&
      rest.includes("|") &&
      !LIST_ITEM.test(rest) &&
      !NOT_A_HEADER.test(rest) &&
      !startsNewContext(line)
        ? { container, cells: cellCount(rest) }
        : null;
    afterBlank = false;
    group += count;
    groupLines++;
  }
  close();
  return { prefix, emphasis };
}

function tooRisky(text: string): boolean {
  const risk = parseRisk(text);
  return risk.prefix > EXPORT_LIMITS.linePrefix || risk.emphasis > EXPORT_LIMITS.emphasisRisk;
}

/** Paragraphs split on blank lines, line breaks kept, no Markdown read. */
function plainBlocks(text: string): Block[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim().replace(/\t/g, " "))
    .filter(Boolean)
    .map((paragraph) => ({ type: "paragraph", runs: [{ text: paragraph }] }));
}

const parser = unified().use(remarkParse).use(remarkGfm);

function sameMarks(a: TextMarks, b: TextMarks): boolean {
  return !a.bold === !b.bold && !a.italic === !b.italic && !a.code === !b.code && !a.strike === !b.strike;
}

/** Appends text to runs, merged into the last run when the marks match. */
function pushRun(runs: TextRun[], text: string, marks: TextMarks) {
  if (!text) return;
  const last = runs.at(-1);
  if (last && sameMarks(last, marks)) {
    last.text += text;
    return;
  }
  const run: TextRun = { text };
  if (marks.bold) run.bold = true;
  if (marks.italic) run.italic = true;
  if (marks.code) run.code = true;
  if (marks.strike) run.strike = true;
  runs.push(run);
}

/** Link and image definitions, by normalized identifier. */
type Definitions = Map<string, string>;

type InlineWork = { node: Nodes; marks: TextMarks } | { text: string; marks: TextMarks };

/** Inline text on one line: line endings and tabs become spaces. */
function oneLine(text: string): string {
  return text.replace(/[\n\t]/g, " ");
}

/**
 * Text runs of inline content, walked with an explicit stack because
 * emphasis can nest deeper than the call stack allows.
 */
function inlineRuns(nodes: readonly Nodes[], definitions: Definitions): TextRun[] {
  const runs: TextRun[] = [];
  const work: InlineWork[] = [];
  const pushChildren = (children: readonly Nodes[], marks: TextMarks) => {
    for (let index = children.length - 1; index >= 0; index--) {
      work.push({ node: children[index]!, marks });
    }
  };
  pushChildren(nodes, {});
  while (work.length > 0) {
    const item = work.pop()!;
    if ("text" in item) {
      pushRun(runs, item.text, item.marks);
      continue;
    }
    const { node, marks } = item;
    switch (node.type) {
      case "text":
        // A line ending inside a paragraph is a soft break, drawn as a space.
        pushRun(runs, oneLine(node.value), marks);
        break;
      case "inlineCode":
        pushRun(runs, oneLine(node.value), { ...marks, code: true });
        break;
      case "break":
        pushRun(runs, "\n", marks);
        break;
      case "emphasis":
        pushChildren(node.children, { ...marks, italic: true });
        break;
      case "strong":
        pushChildren(node.children, { ...marks, bold: true });
        break;
      case "delete":
        pushChildren(node.children, { ...marks, strike: true });
        break;
      case "link":
      case "linkReference": {
        const url = node.type === "link" ? node.url : (definitions.get(node.identifier) ?? "");
        const text = plainText(node.children);
        if (!text.trim()) {
          pushRun(runs, url.trim(), { ...marks, code: false });
          break;
        }
        const address = shownAddress(text, url);
        // The stack runs last in, first out: the address comes after the text.
        if (address) work.push({ text: ` (${address})`, marks: { ...marks, code: false } });
        pushChildren(node.children, marks);
        break;
      }
      case "image":
      case "imageReference":
        pushRun(runs, oneLine(node.alt ?? ""), marks);
        break;
      case "html":
        pushRun(runs, oneLine(node.value), marks);
        break;
      case "footnoteReference":
        pushRun(runs, `[${node.label ?? node.identifier}]`, marks);
        break;
      default:
        if ("children" in node) pushChildren(node.children as Nodes[], marks);
        else if ("value" in node && typeof node.value === "string") pushRun(runs, oneLine(node.value), marks);
    }
  }
  return runs;
}

/** The text of nodes without formatting or link addresses, on one line. */
function plainText(nodes: readonly Nodes[]): string {
  const work: Nodes[] = [...nodes].reverse();
  let text = "";
  while (work.length > 0) {
    const node = work.pop()!;
    if (node.type === "image" || node.type === "imageReference") text += node.alt ?? "";
    else if (node.type === "break") text += " ";
    else if ("value" in node && typeof node.value === "string") text += node.value;
    else if ("children" in node) {
      const children = node.children as Nodes[];
      for (let index = children.length - 1; index >= 0; index--) work.push(children[index]!);
    }
  }
  return oneLine(text);
}

/** The first `max` characters of runs, then "…" when some were left out. */
function truncateRuns(runs: readonly TextRun[], max: number): TextRun[] {
  const result: TextRun[] = [];
  let left = max;
  for (const run of runs) {
    if (left <= 0) {
      pushRun(result, "…", {});
      break;
    }
    let end = Math.min(left, run.text.length);
    // Never keep half of a surrogate pair.
    if (end < run.text.length && /[\ud800-\udbff]/.test(run.text[end - 1] ?? "")) end--;
    pushRun(result, run.text.slice(0, end), run);
    left -= run.text.length;
    if (end < run.text.length) {
      pushRun(result, "…", {});
      break;
    }
  }
  return result;
}

function tableBlock(node: Table, definitions: Definitions): Block {
  const width = Math.max(node.align?.length ?? 0, node.children[0]?.children.length ?? 0, 1);
  const kept = Math.min(width, EXPORT_LIMITS.tableColumns);
  const align: ColumnAlign[] = Array.from({ length: kept }, (_, index) => node.align?.[index] ?? null);
  const rows = node.children.map((row) => {
    // As in GFM, cells past the header's width are left out.
    const cells = row.children.slice(0, width).map((cell) => inlineRuns(cell.children, definitions));
    while (cells.length < width) cells.push([]);
    if (width > kept) {
      const merged: TextRun[] = [];
      cells.slice(kept - 1).forEach((cell, index) => {
        if (index > 0) pushRun(merged, " | ", {});
        for (const run of cell) pushRun(merged, run.text, run);
      });
      cells.splice(kept - 1, cells.length, truncateRuns(merged, EXPORT_LIMITS.mergedCellChars));
    }
    return cells;
  });
  return { type: "table", align, rows };
}

/**
 * Blocks of mdast nodes. The recursion follows the tree, whose depth
 * parseRisk keeps under EXPORT_LIMITS.linePrefix. The builders cap how deep
 * they draw it with nest().
 */
function toBlocks(nodes: readonly RootContent[], definitions: Definitions): Block[] {
  const result: Block[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "paragraph": {
        const runs = inlineRuns(node.children, definitions);
        if (runs.some((run) => run.text.trim())) result.push({ type: "paragraph", runs });
        break;
      }
      case "heading": {
        const runs = inlineRuns(node.children, definitions);
        if (runs.some((run) => run.text.trim())) result.push({ type: "heading", depth: node.depth, runs });
        break;
      }
      case "thematicBreak":
        result.push({ type: "rule" });
        break;
      case "blockquote":
        result.push({ type: "quote", blocks: toBlocks(node.children, definitions) });
        break;
      case "list":
        result.push({
          type: "list",
          ordered: node.ordered ?? false,
          start: node.start ?? 1,
          items: node.children.map((item) => ({
            checked: item.checked ?? null,
            blocks: toBlocks(item.children, definitions),
          })),
        });
        break;
      case "code":
        result.push({ type: "code", text: node.value.replace(/\t/g, "    ") });
        break;
      case "html":
        if (node.value.trim())
          result.push({ type: "paragraph", runs: [{ text: node.value.replace(/\t/g, " ") }] });
        break;
      case "table":
        result.push(tableBlock(node, definitions));
        break;
      case "footnoteDefinition": {
        const content = toBlocks(node.children, definitions);
        const label = `[${node.label ?? node.identifier}] `;
        const first = content[0];
        if (first?.type === "paragraph") first.runs.unshift({ text: label });
        else content.unshift({ type: "paragraph", runs: [{ text: label }] });
        result.push(...content);
        break;
      }
      case "definition":
        break;
      default: {
        const text = plainText([node]).trim();
        if (text) result.push({ type: "paragraph", runs: [{ text }] });
      }
    }
  }
  return result;
}

function collectDefinitions(tree: Root): Definitions {
  const found: Definitions = new Map();
  const work: Nodes[] = [tree];
  while (work.length > 0) {
    const node = work.pop()!;
    if (node.type === "definition") {
      // The first definition of an identifier wins, as in CommonMark.
      if (!found.has(node.identifier)) found.set(node.identifier, node.url);
    } else if ("children" in node && node.type !== "paragraph" && node.type !== "heading") {
      const children = node.children as Nodes[];
      for (let index = children.length - 1; index >= 0; index--) work.push(children[index]!);
    }
  }
  return found;
}

/**
 * The blocks of a section's Markdown, empty when there is no text. Falls back
 * to plain paragraphs when the text is too costly to parse or the parser
 * fails.
 */
export function sectionBlocks(markdown: string | null): Block[] {
  if (!markdown) return [];
  const text = cleanText(markdown.slice(0, EXPORT_LIMITS.sectionChars));
  if (!text.trim()) return [];
  if (tooRisky(text)) return plainBlocks(text);
  try {
    const tree = parser.parse(text);
    return toBlocks(tree.children, collectDefinitions(tree));
  } catch {
    return plainBlocks(text);
  }
}

/** The text of runs, without their marks. */
export function runsText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join("");
}
