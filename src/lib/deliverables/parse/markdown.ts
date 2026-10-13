import { PARSE_LIMITS, type ParseMeta } from "./types";

/** Escapes the characters that would turn plain text into Markdown syntax. */
export function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
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
      return value.replace(/\|/g, "\\|") || " ";
    }).join(" | ")} |`;
  const [header = [], ...body] = rows;
  return [line(header), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(line)].join("\n");
}

/** Tidies the Markdown, caps its length and measures it. */
export function finishMarkdown(
  markdown: string,
  meta: Pick<ParseMeta, "kind" | "tables" | "sheets">,
): { markdown: string; meta: ParseMeta } {
  let text = markdown
    .replace(/[ \t]+\n/g, (match) => (match.startsWith("  ") ? "  \n" : "\n"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  let truncated = false;
  if (text.length > PARSE_LIMITS.maxMarkdownChars) {
    const cut = text.lastIndexOf("\n", PARSE_LIMITS.maxMarkdownChars);
    text = text.slice(0, cut > 0 ? cut : PARSE_LIMITS.maxMarkdownChars).trimEnd();
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
