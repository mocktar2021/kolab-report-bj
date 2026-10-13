import { type ChildNode, type Element, isTag, isText } from "domhandler";
import { parseDocument } from "htmlparser2";
import { escapeInline, escapeLineStarts, heading, tableToMarkdown } from "./markdown";

// Turns the HTML mammoth makes from a Word file into Markdown: headings,
// paragraphs, emphasis, links, nested lists and tables. Merged table cells
// are spread over the grid so every row keeps the same columns. Images are
// left out.

const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const MAX_SPAN = 50;

function attribute(element: Element, name: string): string | undefined {
  return element.attribs[name];
}

function span(element: Element, name: "colspan" | "rowspan"): number {
  const value = Number.parseInt(attribute(element, name) ?? "1", 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), MAX_SPAN) : 1;
}

function safeHref(href: string | undefined): string | null {
  if (!href || !/^(?:https?:|mailto:)/i.test(href)) return null;
  // A backslash would escape the next character of the link target.
  return href.replace(/[\s<>\\]/g, encodeURIComponent);
}

/** Wraps text in Markdown markers, keeping the surrounding spaces outside. */
function wrap(text: string, open: string, close = open): string {
  const inner = text.trim();
  if (!inner) return text;
  const lead = text.startsWith(" ") ? " " : "";
  const trail = text.endsWith(" ") ? " " : "";
  return `${lead}${open}${inner}${close}${trail}`;
}

/** Text of inline content. `lineBreak` is what <br> becomes. */
function inline(nodes: ChildNode[], lineBreak: string): string {
  return nodes
    .map((node) => {
      if (isText(node)) return escapeInline(node.data.replace(/\s+/g, " "));
      if (!isTag(node)) return "";
      const content = () => inline(node.children, lineBreak);
      switch (node.name) {
        case "br":
          return lineBreak;
        case "img":
          return "";
        case "strong":
        case "b":
          return wrap(content(), "**");
        case "em":
        case "i":
          return wrap(content(), "*");
        case "s":
        case "del":
        case "strike":
          return wrap(content(), "~~");
        case "a": {
          const href = safeHref(attribute(node, "href"));
          return href ? wrap(content(), "[", `](<${href}>)`) : content();
        }
        case "p":
          return ` ${content()} `;
        case "ul":
        case "ol":
          return ` ${node.children
            .filter(isTag)
            .map((item) => inline(item.children, lineBreak).trim())
            .join("; ")} `;
        case "table":
          // A table inside a cell: its cells one after the other.
          return ` ${ownRows(node)
            .flatMap((row) => row.children.filter(isTag))
            .map((cell) => inline(cell.children, lineBreak).trim())
            .join(" ")} `;
        default:
          return content();
      }
    })
    .join("");
}

function renderList(list: Element, indent: string): string {
  const ordered = list.name === "ol";
  return list.children
    .filter((node): node is Element => isTag(node) && node.name === "li")
    .map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : "- ";
      const childIndent = indent + " ".repeat(marker.length);
      const text = item.children
        .filter((node) => !(isTag(node) && (node.name === "ul" || node.name === "ol")))
        .map((node) => (isTag(node) && node.name === "p" ? inline(node.children, " ") : inline([node], " ")))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const nested = item.children
        .filter((node): node is Element => isTag(node) && (node.name === "ul" || node.name === "ol"))
        .map((sub) => renderList(sub, childIndent))
        .join("\n");
      return `${indent}${marker}${escapeLineStarts(text)}${nested ? `\n${nested}` : ""}`;
    })
    .join("\n");
}

/** Rows of this table only, not of tables nested in its cells. */
function ownRows(table: Element): Element[] {
  const rows: Element[] = [];
  const visit = (nodes: ChildNode[]) => {
    for (const node of nodes) {
      if (!isTag(node)) continue;
      if (node.name === "tr") rows.push(node);
      else if (node.name !== "table") visit(node.children);
    }
  };
  visit(table.children);
  return rows;
}

function renderTable(table: Element): string {
  const grid: string[][] = [];
  ownRows(table).forEach((row, rowIndex) => {
    grid[rowIndex] ??= [];
    let column = 0;
    for (const cell of row.children) {
      if (!isTag(cell) || (cell.name !== "td" && cell.name !== "th")) continue;
      while (grid[rowIndex]?.[column] !== undefined) column++;
      const text = cell.children
        .map((node) => (isTag(node) && node.name === "p" ? inline(node.children, " ") : inline([node], " ")))
        .join(" ");
      const colspan = span(cell, "colspan");
      const rowspan = span(cell, "rowspan");
      for (let down = 0; down < rowspan; down++) {
        const target = (grid[rowIndex + down] ??= []);
        for (let across = 0; across < colspan; across++) {
          target[column + across] = down === 0 && across === 0 ? text : "";
        }
      }
      column += colspan;
    }
  });
  // Rows a rowspan reached beyond the last <tr> are dropped.
  const rows = grid.slice(0, ownRows(table).length).map((row) => Array.from(row, (value) => value ?? ""));
  return tableToMarkdown(rows);
}

function blocks(nodes: ChildNode[], counter: { tables: number }): string {
  return nodes
    .map((node) => {
      if (isText(node)) {
        const text = inline([node], "  \n").trim();
        return text ? `${escapeLineStarts(text)}\n\n` : "";
      }
      if (!isTag(node)) return "";
      const level = HEADINGS[node.name];
      if (level) {
        const text = inline(node.children, " ").trim();
        return text ? `${heading(level, text)}\n\n` : "";
      }
      switch (node.name) {
        case "p": {
          const text = inline(node.children, "  \n").trim();
          return text ? `${escapeLineStarts(text)}\n\n` : "";
        }
        case "ul":
        case "ol":
          return `${renderList(node, "")}\n\n`;
        case "table":
          counter.tables++;
          return `${renderTable(node)}\n\n`;
        default:
          return blocks(node.children, counter);
      }
    })
    .join("");
}

export function htmlToMarkdown(html: string): { markdown: string; tables: number } {
  const counter = { tables: 0 };
  const markdown = blocks(parseDocument(html).children, counter);
  return { markdown, tables: counter.tables };
}
