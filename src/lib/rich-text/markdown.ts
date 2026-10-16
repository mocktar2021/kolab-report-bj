import type { JSONContent } from "@tiptap/core";
import type { Mark as PmMark, Node as PmNode } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import type {
  BlockContent,
  DefinitionContent,
  List,
  ListItem,
  Nodes,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from "mdast";
import { gfmFootnoteToMarkdown } from "mdast-util-gfm-footnote";
import { gfmStrikethroughToMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableToMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemToMarkdown } from "mdast-util-gfm-task-list-item";
import { toMarkdown, type Options } from "mdast-util-to-markdown";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { isRiskyMarkdown } from "@/lib/markdown-risk";

// Markdown in and out of the "Texte" mode of the section editor (KRB-197).
// The section is stored as Markdown; the editor only holds it while it is
// open. Reading uses the parser of the app's Markdown view and of the exports
// (remark with GitHub tables), so the editor shows what the report will show.
//
// Writing keeps the stored text where the editor didn't change it: every top
// level block (paragraph, heading, list, table...) still equal to the one it
// was read from is written back from the original source, byte for byte,
// along with the blank lines between two such blocks. Only the blocks the
// person changed or added are written by mdast-util-to-markdown, with this
// app's style: "-" bullets, "*" emphasis, "**" bold, ``` fences, ATX
// headings and tables without padding. A text opened without any change
// comes out exactly as it went in.

const parser = unified().use(remarkParse).use(remarkGfm);

const TO_MARKDOWN: Options = {
  bullet: "-",
  bulletOther: "*",
  bulletOrdered: ".",
  emphasis: "*",
  strong: "*",
  fence: "`",
  fences: true,
  rule: "-",
  ruleRepetition: 3,
  ruleSpaces: false,
  listItemIndent: "one",
  incrementListMarker: true,
  setext: false,
  closeAtx: false,
  resourceLink: false,
  // GitHub Markdown without the autolink literal rules: those escape the
  // colon of https:// in plain text. A bare address in text becomes a link
  // when the text is read again, as GitHub does.
  extensions: [
    gfmFootnoteToMarkdown(),
    gfmStrikethroughToMarkdown(),
    gfmTableToMarkdown({ tablePipeAlign: false }),
    gfmTaskListItemToMarkdown(),
  ],
};

export type ListKind = "bullet" | "ordered";

/** A top level block of the stored text. */
export type SourceBlock = {
  /** From the start of its first line, indentation included. */
  start: number;
  end: number;
  list: ListKind | null;
  /** Starts with spaces: right after a list, the list would take it in. */
  indented: boolean;
  /** A code fence never closed: it runs to the end of the text. */
  openFence: boolean;
};

export type ParsedMarkdown = {
  /** The editor's document, as Tiptap JSON. */
  doc: JSONContent;
  source: string;
  /** One per top level node of `doc`, in order. Empty for an empty text. */
  blocks: SourceBlock[];
};

/** The stored text and the editor's first document, to write unchanged blocks back as they were. */
export type MarkdownOrigin = {
  source: string;
  blocks: Array<SourceBlock & { node: PmNode }>;
};

type MarkJson = { type: string; attrs?: Record<string, unknown> };

// Reading: Markdown to Tiptap JSON.

/** The node as JSON, without its position, for a raw node. */
function rawJson(node: Nodes): string {
  return JSON.stringify(node, (key, value: unknown) => (key === "position" ? undefined : value));
}

function sourceOf(node: Nodes, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? "" : source.slice(start, end);
}

function withMark(marks: readonly MarkJson[], mark: MarkJson): MarkJson[] {
  return [...marks.filter((item) => item.type !== mark.type), mark];
}

function textJson(text: string, marks: readonly MarkJson[]): JSONContent[] {
  if (!text) return [];
  return [marks.length ? { type: "text", text, marks: [...marks] } : { type: "text", text }];
}

/** Inline Markdown the editor can't show, kept as written. */
function rawInlineJson(node: PhrasingContent, marks: readonly MarkJson[], source: string): JSONContent {
  const raw: JSONContent = {
    type: "rawInline",
    attrs: { mdast: rawJson(node), text: sourceOf(node, source) },
  };
  if (marks.length) raw.marks = [...marks];
  return raw;
}

function inlineJson(
  nodes: readonly PhrasingContent[],
  marks: readonly MarkJson[],
  source: string,
): JSONContent[] {
  return nodes.flatMap((node): JSONContent[] => {
    switch (node.type) {
      case "text":
        // A soft line break shows as a space, in the editor as on the page.
        return textJson(node.value.replace(/[ \t]*\r?\n[ \t]*/g, " "), marks);
      case "emphasis":
        return inlineJson(node.children, withMark(marks, { type: "italic" }), source);
      case "strong":
        return inlineJson(node.children, withMark(marks, { type: "bold" }), source);
      case "delete":
        return inlineJson(node.children, withMark(marks, { type: "strike" }), source);
      case "inlineCode":
        return textJson(node.value, withMark(marks, { type: "code" }));
      case "link": {
        const content = inlineJson(
          node.children,
          withMark(marks, { type: "link", attrs: { href: node.url, title: node.title ?? null } }),
          source,
        );
        // [](address) has no text to hold the link: kept as written.
        return content.length ? content : [rawInlineJson(node, marks, source)];
      }
      case "break":
        return [marks.length ? { type: "hardBreak", marks: [...marks] } : { type: "hardBreak" }];
      default:
        // Images, raw HTML, footnote and reference links: kept as written.
        return [rawInlineJson(node, marks, source)];
    }
  });
}

function paragraphJson(children: readonly PhrasingContent[], source: string): JSONContent {
  const content = inlineJson(children, [], source);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function flowJson(nodes: readonly RootContent[], source: string): JSONContent[] {
  const content = nodes.map((node) => blockJson(node, source));
  return content.length ? content : [{ type: "paragraph" }];
}

function listItemJson(item: ListItem, source: string): JSONContent {
  const content = item.children.map((node) => blockJson(node, source));
  // An item starts with a paragraph in the editor. An empty one is dropped on the way out.
  if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph" });
  return {
    type: "listItem",
    attrs: { spread: Boolean(item.spread), checked: typeof item.checked === "boolean" ? item.checked : null },
    content,
  };
}

function tableJson(table: Table, source: string): JSONContent {
  // Short rows are padded, as the page draws them. Long ones keep their cells.
  const columns = Math.max(1, ...table.children.map((row) => row.children.length));
  return {
    type: "table",
    content: table.children.map((row, rowIndex) => ({
      type: "tableRow",
      content: Array.from({ length: columns }, (_, column) => ({
        type: rowIndex === 0 ? "tableHeader" : "tableCell",
        attrs: { align: table.align?.[column] ?? null },
        content: [paragraphJson(row.children[column]?.children ?? [], source)],
      })),
    })),
  };
}

function blockJson(node: RootContent, source: string): JSONContent {
  switch (node.type) {
    case "paragraph":
      return paragraphJson(node.children, source);
    case "heading": {
      const content = inlineJson(node.children, [], source);
      return { type: "heading", attrs: { level: node.depth }, ...(content.length ? { content } : {}) };
    }
    case "thematicBreak":
      return { type: "horizontalRule" };
    case "blockquote":
      return { type: "blockquote", content: flowJson(node.children, source) };
    case "list":
      return {
        type: node.ordered ? "orderedList" : "bulletList",
        attrs: node.ordered
          ? { start: node.start ?? 1, spread: Boolean(node.spread) }
          : { spread: Boolean(node.spread) },
        content: node.children.map((item) => listItemJson(item, source)),
      };
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? null, meta: node.meta ?? null },
        ...(node.value ? { content: [{ type: "text", text: node.value }] } : {}),
      };
    case "table":
      return tableJson(node, source);
    default:
      // Raw HTML, definitions, footnotes: kept as written.
      return { type: "rawBlock", attrs: { mdast: rawJson(node), text: sourceOf(node, source) } };
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function isOpenFence(text: string): boolean {
  const open = FENCE.exec(text)?.[1];
  if (!open) return false;
  const lines = text.split(/\r?\n/);
  const last = (lines[lines.length - 1] ?? "").trim();
  return !(lines.length > 1 && last.length >= open.length && new RegExp(`^\\${open[0]}+$`).test(last));
}

/**
 * The editor's document for a stored text, or null when the text can't be
 * shown in "Texte" mode: too costly to parse (see markdown-risk.ts) or not
 * readable. Such a text stays editable in the Markdown tab.
 */
export function parseMarkdown(source: string): ParsedMarkdown | null {
  if (isRiskyMarkdown(source)) return null;
  let tree: Root;
  try {
    tree = parser.parse(source);
  } catch {
    return null;
  }
  const content: JSONContent[] = [];
  const blocks: SourceBlock[] = [];
  for (const node of tree.children) {
    const nodeStart = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (nodeStart === undefined || end === undefined) return null;
    // Back to the start of the line: a fence's indentation is part of its code.
    const lineStart = Math.max(source.lastIndexOf("\n", nodeStart - 1) + 1, 0);
    const start = /^[ \t]*$/.test(source.slice(lineStart, nodeStart)) ? lineStart : nodeStart;
    const text = source.slice(start, end);
    content.push(blockJson(node, source));
    blocks.push({
      start,
      end,
      list: node.type === "list" ? (node.ordered ? "ordered" : "bullet") : null,
      indented: /^[ \t]/.test(text),
      openFence: node.type === "code" && isOpenFence(text),
    });
  }
  return {
    doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
    source,
    blocks,
  };
}

/**
 * Pairs the parsed blocks with the nodes of the editor's first document.
 * Null when they don't match one to one: then every block is written anew.
 */
export function bindOrigin(parsed: ParsedMarkdown, doc: PmNode): MarkdownOrigin | null {
  if (parsed.blocks.length === 0) return { source: parsed.source, blocks: [] };
  if (doc.childCount !== parsed.blocks.length) return null;
  return {
    source: parsed.source,
    blocks: parsed.blocks.map((block, index) => ({ ...block, node: doc.child(index) })),
  };
}

// Writing: ProseMirror nodes to mdast.

/** Marks written around others: a link holds bold text, bold holds italic. */
const MARK_ORDER = ["link", "bold", "italic", "strike"] as const;

type MarkName = (typeof MARK_ORDER)[number];

const WHITESPACE_START = /^\s+/;
const WHITESPACE_END = /\s+$/;
// Markdown drops spaces, tabs and line endings at the edges of a paragraph,
// not "&nbsp;": a leading one stays, as indentation.
const EDGE_START = /^[ \t\r\n]+/;
const EDGE_END = /[ \t\r\n]+$/;

function isCode(node: PmNode): boolean {
  return node.marks.some((mark) => mark.type.name === "code");
}

/** The paragraph's text with a placeholder for breaks and raw nodes, to look at a link's neighbors. */
function flatText(nodes: readonly PmNode[]): string {
  return nodes.map((node) => (node.isText ? (node.text ?? "") : "￼")).join("");
}

/**
 * A link GitHub Markdown finds on its own in plain text: an address that is
 * its own text (or www. and e-mail addresses), between spaces or punctuation
 * that can't run into it. Written as plain text, it reads back as the same
 * link; any other link is written [text](address) or <address>.
 */
function isLiteralLink(mark: PmMark, text: string, before: string, after: string): boolean {
  if (mark.attrs.title) return false;
  const href = String(mark.attrs.href ?? "");
  const literal =
    (href === text && /^https?:\/\/[^\s<>*_~`[\]\\&]+$/i.test(text)) ||
    (href === `http://${text}` && /^www\.[^\s<>*_~`[\]\\&]+$/i.test(text)) ||
    (href === `mailto:${text}` && /^[a-z0-9.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(text));
  return (
    literal &&
    !/[.,:;!?'")]$/.test(text) &&
    (before === "" || /[\s(]/.test(before)) &&
    (after === "" || /[\s.,:;!?)]/.test(after))
  );
}

/**
 * Links GitHub Markdown finds on its own become plain text, inside the bold,
 * italic or strikethrough of the whole address: **https://x.fr** reads back as
 * a bold link. Bold or italic on part of the address is lost; GitHub would not
 * read it anyway.
 */
function literalLinksAsText(nodes: readonly PmNode[]): PmNode[] {
  const flat = flatText(nodes);
  const result: PmNode[] = [];
  let from = 0;
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index]!;
    const link = node.isText ? node.marks.find((mark) => mark.type.name === "link") : undefined;
    let end = index + 1;
    while (link && end < nodes.length && link.isInSet(nodes[end]!.marks)) end++;
    const group = nodes.slice(index, end);
    const to = from + flatText(group).length;
    const text = flat.slice(from, to);
    if (
      link &&
      group.every((part) => part.isText && !isCode(part)) &&
      isLiteralLink(link, text, flat.slice(from - 1, from), flat.slice(to, to + 1))
    ) {
      const marks = node.marks.filter(
        (mark) => mark.type.name !== "link" && group.every((part) => mark.isInSet(part.marks)),
      );
      result.push(node.type.schema.text(text, marks));
    } else {
      result.push(...group);
    }
    from = to;
    index = end;
  }
  return result;
}

function wrap(name: MarkName, mark: PmMark, children: PhrasingContent[]): PhrasingContent {
  switch (name) {
    case "link":
      return { type: "link", url: String(mark.attrs.href ?? ""), title: mark.attrs.title ?? null, children };
    case "bold":
      return { type: "strong", children };
    case "italic":
      return { type: "emphasis", children };
    case "strike":
      return { type: "delete", children };
  }
}

/**
 * Spaces at the edges of bold, italic, struck or linked text move outside:
 * Markdown can't close "**gras **" and would show the asterisks.
 */
function hoistSpaces(node: PhrasingContent & { children: PhrasingContent[] }): PhrasingContent[] {
  const children = [...node.children];
  let before = "";
  let after = "";
  const first = children[0];
  if (first?.type === "text") {
    before = WHITESPACE_START.exec(first.value)?.[0] ?? "";
    if (before) children[0] = { ...first, value: first.value.slice(before.length) };
  }
  const lastIndex = children.length - 1;
  const last = children[lastIndex];
  if (last?.type === "text") {
    after = WHITESPACE_END.exec(last.value)?.[0] ?? "";
    if (after)
      children[lastIndex] = { ...last, value: last.value.slice(0, last.value.length - after.length) };
  }
  const kept = children.filter((child) => child.type !== "text" || child.value !== "");
  const result: PhrasingContent[] = [];
  if (before) result.push({ type: "text", value: before });
  if (kept.length) result.push({ ...node, children: kept } as PhrasingContent);
  if (after) result.push({ type: "text", value: after });
  return result;
}

function leaf(node: PmNode): PhrasingContent[] {
  if (node.isText) {
    const value = node.text ?? "";
    return [isCode(node) ? { type: "inlineCode", value } : { type: "text", value }];
  }
  if (node.type.name === "hardBreak") return [{ type: "break" }];
  if (node.type.name === "rawInline") {
    try {
      return [JSON.parse(String(node.attrs.mdast)) as PhrasingContent];
    } catch {
      return [{ type: "text", value: String(node.attrs.text ?? "") }];
    }
  }
  return node.textContent ? [{ type: "text", value: node.textContent }] : [];
}

function phrasingOf(nodes: readonly PmNode[], open: ReadonlySet<MarkName>): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index]!;
    const name = MARK_ORDER.find(
      (candidate) => !open.has(candidate) && node.marks.some((mark) => mark.type.name === candidate),
    );
    if (!name) {
      result.push(...leaf(node));
      index++;
      continue;
    }
    const mark = node.marks.find((candidate) => candidate.type.name === name)!;
    let end = index + 1;
    while (end < nodes.length && mark.isInSet(nodes[end]!.marks)) end++;
    const wrapped = wrap(name, mark, phrasingOf(nodes.slice(index, end), new Set([...open, name])));
    result.push(...hoistSpaces(wrapped as PhrasingContent & { children: PhrasingContent[] }));
    index = end;
  }
  return result;
}

/**
 * The inline content of a paragraph, heading or cell. Spaces and line breaks
 * at its edges go: Markdown can't hold them.
 */
function inlineMdast(node: PmNode, breaks: "keep" | "spaces" = "keep"): PhrasingContent[] {
  const nodes: PmNode[] = [];
  node.forEach((child) => {
    nodes.push(breaks === "spaces" && child.type.name === "hardBreak" ? child.type.schema.text(" ") : child);
  });
  // Trim the text at the edges and around line breaks, outside of code.
  const texts = nodes.map((child) => (child.isText && !isCode(child) ? (child.text ?? "") : null));
  const isBreak = (index: number) => nodes[index]?.type.name === "hardBreak";
  for (let index = 0; index < nodes.length; index++) {
    if (index > 0 && !isBreak(index - 1)) continue;
    // From the start, or after a break, up to the first visible character.
    for (let at = index; at < nodes.length && texts[at] !== null && !isBreak(at); at++) {
      texts[at] = texts[at]!.replace(EDGE_START, "");
      if (texts[at]) break;
    }
  }
  for (let index = nodes.length - 1; index >= 0; index--) {
    if (index < nodes.length - 1 && !isBreak(index + 1)) continue;
    for (let at = index; at >= 0 && texts[at] !== null && !isBreak(at); at--) {
      texts[at] = texts[at]!.replace(EDGE_END, "");
      if (texts[at]) break;
    }
  }
  const kept: PmNode[] = [];
  nodes.forEach((child, index) => {
    const text = texts[index];
    if (text === null || text === undefined) kept.push(child);
    else if (text) kept.push(text === child.text ? child : child.type.schema.text(text, child.marks));
  });
  // Line breaks at the edges write a stray backslash.
  let first = 0;
  let end = kept.length;
  while (first < end && kept[first]!.type.name === "hardBreak") first++;
  while (end > first && kept[end - 1]!.type.name === "hardBreak") end--;
  const trimmed = kept.slice(first, end);
  // "&nbsp;" alone makes an empty paragraph too: nothing to write.
  if (trimmed.every((child) => child.isText && !isCode(child) && !/\S/.test(child.text ?? ""))) return [];
  return phrasingOf(literalLinksAsText(trimmed), new Set());
}

type FlowNode = BlockContent | DefinitionContent;

function flowChildren(node: PmNode): FlowNode[] {
  const children: FlowNode[] = [];
  node.forEach((child) => {
    const converted = flowMdast(child);
    if (converted) children.push(converted);
  });
  return children;
}

function listMdast(node: PmNode, ordered: boolean): List {
  const items: ListItem[] = [];
  node.forEach((child) => {
    const checked = child.attrs.checked;
    items.push({
      type: "listItem",
      spread: Boolean(child.attrs.spread),
      checked: typeof checked === "boolean" ? checked : null,
      children: flowChildren(child),
    });
  });
  return {
    type: "list",
    ordered,
    start: ordered ? Number(node.attrs.start) || 1 : null,
    spread: Boolean(node.attrs.spread),
    children: items,
  };
}

function tableMdast(node: PmNode): Table {
  const map = TableMap.get(node);
  const rows: TableRow[] = [];
  const align: Table["align"] = [];
  for (let row = 0; row < map.height; row++) {
    const cells: TableCell[] = [];
    for (let column = 0; column < map.width; column++) {
      const position = map.map[row * map.width + column]!;
      const cell = node.nodeAt(position);
      const rect = map.findCell(position);
      // A merged cell is written once, in its top left corner.
      const origin = rect.left === column && rect.top === row;
      // Markdown aligns whole columns: the first aligned cell sets its column.
      const value = origin ? cell?.attrs.align : null;
      if (row === 0) align.push(null);
      if (align[column] === null && (value === "left" || value === "center" || value === "right")) {
        align[column] = value;
      }
      const children: PhrasingContent[] = [];
      if (cell && origin) {
        cell.forEach((block) => {
          const inline = block.isTextblock
            ? inlineMdast(block, "spaces")
            : [{ type: "text" as const, value: block.textContent }];
          if (inline.length === 0) return;
          if (children.length) children.push({ type: "text", value: " " });
          children.push(...inline);
        });
      }
      cells.push({ type: "tableCell", children });
    }
    rows.push({ type: "tableRow", children: cells });
  }
  return { type: "table", align, children: rows };
}

function flowMdast(node: PmNode): FlowNode | null {
  switch (node.type.name) {
    case "paragraph": {
      const children = inlineMdast(node);
      return children.length ? { type: "paragraph", children } : null;
    }
    case "heading": {
      const children = inlineMdast(node);
      const depth = Math.min(Math.max(Number(node.attrs.level) || 1, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6;
      return children.length ? { type: "heading", depth, children } : null;
    }
    case "horizontalRule":
      return { type: "thematicBreak" };
    case "blockquote": {
      const children = flowChildren(node);
      return children.length ? { type: "blockquote", children } : null;
    }
    case "bulletList":
      return listMdast(node, false);
    case "orderedList":
      return listMdast(node, true);
    case "codeBlock":
      return {
        type: "code",
        lang: node.attrs.language ? String(node.attrs.language) : null,
        meta: node.attrs.meta ? String(node.attrs.meta) : null,
        value: node.textContent,
      };
    case "table":
      return tableMdast(node);
    case "rawBlock":
      try {
        return JSON.parse(String(node.attrs.mdast)) as FlowNode;
      } catch {
        return { type: "paragraph", children: [{ type: "text", value: String(node.attrs.text ?? "") }] };
      }
    default: {
      const text = node.textContent;
      return text ? { type: "paragraph", children: [{ type: "text", value: text }] } : null;
    }
  }
}

function listKind(node: PmNode): ListKind | null {
  if (node.type.name === "bulletList") return "bullet";
  if (node.type.name === "orderedList") return "ordered";
  return null;
}

/** Markdown of top level nodes written together, without the final line ending. */
function serialize(nodes: readonly PmNode[]): string {
  const children = nodes.map(flowMdast).filter((node): node is FlowNode => node !== null);
  if (children.length === 0) return "";
  return toMarkdown({ type: "root", children } as Root, TO_MARKDOWN).replace(/\n$/, "");
}

// Nodes never change: a block written once keeps its Markdown.
const written = new WeakMap<PmNode, string>();

function serializeOne(node: PmNode): string {
  let markdown = written.get(node);
  if (markdown === undefined) {
    markdown = serialize([node]);
    written.set(node, markdown);
  }
  return markdown;
}

type Unit = { node: PmNode; markdown: string | null; origin: number };

/**
 * The document as Markdown. With an origin, the blocks still equal to the
 * ones the text was read from are written as they were stored.
 */
export function docToMarkdown(doc: PmNode, origin: MarkdownOrigin | null = null): string {
  const blocks = origin?.blocks ?? [];
  const byNode = new Map(blocks.map((block, index) => [block.node, index]));
  const units: Unit[] = [];
  let next = 0;
  doc.forEach((child) => {
    let index = -1;
    const known = byNode.get(child);
    if (known !== undefined && known >= next) index = known;
    else if (next < blocks.length && child.eq(blocks[next]!.node)) index = next;
    if (index >= 0) next = index + 1;
    else if (serializeOne(child) === "") return; // Empty: nothing to write.
    units.push({ node: child, markdown: null, origin: index });
  });

  // A kept block is written anew when its new neighbor would change how it reads.
  for (let changed = true; changed; ) {
    changed = false;
    for (let index = 1; index < units.length; index++) {
      const left = units[index - 1]!;
      const right = units[index]!;
      if (left.origin >= 0 && right.origin === left.origin + 1) continue;
      const leftList = listKind(left.node);
      const sameLists = leftList !== null && leftList === listKind(right.node);
      const drop = (unit: Unit) => {
        if (unit.origin >= 0) {
          unit.origin = -1;
          changed = true;
        }
      };
      // Two lists of the same kind would merge into one: the writer alternates their markers.
      if (sameLists) {
        drop(left);
        drop(right);
      }
      if (leftList && right.origin >= 0 && blocks[right.origin]!.indented) drop(right);
      if (left.origin >= 0 && blocks[left.origin]!.openFence) drop(left);
    }
  }

  const parts: string[] = [];
  let index = 0;
  while (index < units.length) {
    const first = units[index]!;
    let last = index;
    if (first.origin >= 0) {
      while (last + 1 < units.length && units[last + 1]!.origin === units[last]!.origin + 1) last++;
      const end = blocks[units[last]!.origin]!.end;
      parts.push(origin!.source.slice(blocks[first.origin]!.start, end));
    } else if (listKind(first.node)) {
      // Lists of the same kind side by side are written together.
      while (
        last + 1 < units.length &&
        units[last + 1]!.origin < 0 &&
        listKind(units[last + 1]!.node) === listKind(first.node)
      ) {
        last++;
      }
      parts.push(
        last === index
          ? serializeOne(first.node)
          : serialize(units.slice(index, last + 1).map((unit) => unit.node)),
      );
    } else {
      parts.push(serializeOne(first.node));
    }
    index = last + 1;
  }

  const body = parts.filter(Boolean).join("\n\n");
  if (!origin || !body) return body;
  const head = units[0];
  const tail = units[units.length - 1];
  const prefix = head?.origin === 0 ? origin.source.slice(0, blocks[0]!.start) : "";
  const lastBlock = blocks.length - 1;
  const suffix =
    tail?.origin === lastBlock && lastBlock >= 0
      ? origin.source.slice(blocks[lastBlock]!.end)
      : /\n$/.test(origin.source)
        ? "\n"
        : "";
  return prefix + body + suffix;
}
