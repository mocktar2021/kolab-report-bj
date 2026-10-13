import { PARSE_LIMITS, type ParseMeta } from "./types";

/**
 * Text Postgres can store: no NUL byte, and no lone half of a surrogate pair
 * (a cut can split an emoji), which becomes U+FFFD.
 */
export function storableText(text: string): string {
  return text.replaceAll("\u0000", "").toWellFormed();
}

/**
 * Escapes what would turn plain text into inline Markdown: emphasis, code,
 * links, strikethrough and pipes, plus the "<" and "&" that open an HTML tag
 * or an entity.
 */
export function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]~|]|<(?=[a-z/!?])|&(?=#?[a-z0-9]{1,32};)/gi, "\\$&");
}

/**
 * Escapes what would open a block at the start of a line of plain text: a
 * heading, quote, list item, rule or setext underline. Text that went through
 * escapeInline already has its emphasis, code and HTML starts escaped.
 */
export function escapeLineStarts(text: string): string {
  return text.replace(
    /^( {0,3})(?:([#>+=-])|(\d{1,9})([.)]))/gm,
    (_match, indent: string, marker: string | undefined, digits: string, delimiter: string) =>
      marker ? `${indent}\\${marker}` : `${indent}${digits}\\${delimiter}`,
  );
}

/** An ATX heading. A run of "#" ending the text would be read as its closing sequence, so it is escaped. */
export function heading(level: number, text: string): string {
  let start = text.length;
  while (start > 0 && text[start - 1] === "#") start--;
  const closes = start < text.length && (start === 0 || text[start - 1] === " ");
  return `${"#".repeat(level)} ${closes ? `${text.slice(0, start)}\\${text.slice(start)}` : text}`;
}

/**
 * Escapes every pipe so it can't end a table cell. A pipe after an even run
 * of backslashes (none, or escaped ones) gets one more; after an odd run it
 * is already escaped.
 */
function escapePipes(cell: string): string {
  let escaped = "";
  let slashes = 0;
  for (const char of cell) {
    if (char === "|" && slashes % 2 === 0) escaped += "\\";
    escaped += char;
    slashes = char === "\\" ? slashes + 1 : 0;
  }
  return escaped;
}

/**
 * GitHub-style table, first row as header. Cells must already be escaped;
 * pipes and line breaks are handled here.
 */
export function tableToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return "";
  const width = rows.reduce((max, row) => Math.max(max, row.length), 1);
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => {
      const value = (row[index] ?? "").replace(/\s+/g, " ").trim();
      return escapePipes(value) || " ";
    }).join(" | ")} |`;
  const [header = [], ...body] = rows;
  return [line(header), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(line)].join("\n");
}

/** Drops the spaces and tabs ending a line, but keeps two spaces for a hard break. */
function trimLineEnd(line: string): string {
  let end = line.length;
  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end--;
  if (end === line.length || end === 0) return line.slice(0, end);
  return `${line.slice(0, end)}${line.startsWith("  ", end) ? "  " : ""}`;
}

/** Tidies the Markdown, caps its length and measures it. */
export function finishMarkdown(
  markdown: string,
  meta: Pick<ParseMeta, "kind" | "tables" | "sheets">,
): { markdown: string; meta: ParseMeta } {
  let text = storableText(markdown)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(trimLineEnd)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  let truncated = false;
  if (text.length > PARSE_LIMITS.maxMarkdownChars) {
    const cut = text.lastIndexOf("\n", PARSE_LIMITS.maxMarkdownChars);
    text = text
      .slice(0, cut > 0 ? cut : PARSE_LIMITS.maxMarkdownChars)
      .trimEnd()
      .toWellFormed();
    truncated = true;
  }
  return {
    markdown: text,
    meta: {
      version: 1,
      ...meta,
      words: text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0,
      characters: text.length,
      tokenEstimate: Math.ceil(text.length / 4),
      truncated,
    },
  };
}
