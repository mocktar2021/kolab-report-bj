// The Markdown parser (micromark, behind react-markdown and remark-parse) has
// inputs that cost quadratic time or overflow the stack. markdownParseRisk
// measures them in one linear pass, so a caller can show such a text as plain
// text instead of parsing it. The slowest texts we found that pass take 0.1
// to 0.7 s to parse and draw (KRB-18). Normal reports stay well below the
// limits. The module has no dependencies: it runs in the browser too.

/** Texts up to this length share the same limits. */
const LIMITS_LENGTH = 50_000;

/**
 * Limits for a text of up to LIMITS_LENGTH characters. For a longer text,
 * every limit but prefix and emphasis grows with its length: a long text costs
 * more to parse anyway, and its slow parts may then cost about as much again.
 */
export const MARKDOWN_RISK_LIMITS = {
  /** Leading indentation, quote and list markers on one line. Deeper nesting overflows the stack. */
  prefix: 200,
  /** Sum over paragraphs of the squared count of * _ ~ [ ] characters. */
  emphasis: 5_000_000,
  /**
   * Sum over paragraphs of their inline tokens times their size. A token is
   * a line or one of * _ ~ [ ] \ & ` < @ : and "www.", with < counted twice.
   * The size counts three per token and each place the parser splits the
   * text: a letter or digit after another character. The parser joins the
   * text around each token with a copy of the rest of the paragraph.
   */
  inline: 20_000_000,
  /**
   * Sum over setext heading underlines (a line of equals signs or hyphens
   * under text) of the lines and | characters before them. Each one copies
   * everything the parser has read so far.
   */
  setext: 1_000_000,
  /**
   * Sum over the lines that leave a quote or a list of what comes before
   * them: one per line and four per prefix character. Plus four per line of
   * the paragraph before each lazy line (a line that goes on with a paragraph
   * of a quote or a list without its prefix).
   */
  containers: 5_000_000,
  /** Empty cells drawn to fill table rows that have fewer cells than the header. */
  tablePadding: 20_000,
  /**
   * Sum over lists of their squared count of items. Drawing a tight list
   * reads every item of the list again for each item.
   */
  listItems: 10_000_000,
} as const;

export type MarkdownParseRisk = { -readonly [Key in keyof typeof MARKDOWN_RISK_LIMITS]: number };

// Every pattern below matches in linear time: no two parts can take the same
// characters, so a failed match never backtracks far.
const LINE_BREAK = /\r\n?|\n/;
const LINE_PREFIX = /^(?:[ \t>]|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))*/;
const CONTAINER = /^[ \t>]*/;
// After the quote markers: an ATX heading, or a list item that can interrupt
// a paragraph, with at most three spaces of indent.
const BLOCK_START = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|[-*+][ \t]+\S|1[.)][ \t]+\S)/;
const LIST_ITEM = /^[-*+][ \t]|^\d{1,9}[.)][ \t]/;
const NOT_A_HEADER = /^(?:#|```|~~~|<)/;
// Tested on a line with its trailing spaces removed.
const DELIMITER_ROW = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?$/;
// Tested after the container prefix.
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const EMPHASIS_CHARACTERS = /[*_~[\]]/g;
const INLINE_TOKENS = /[*_~[\]\\&`<@:]|www\./gi;
const LESS_THAN = /</g;
// A letter or digit that may start an email address, after a character that
// can't be part of one.
const SPLITS = /[^\w+\-./][\w+\-.]/g;
const PIPES = /\|/g;

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
 * How costly the text is to parse and draw, in one linear pass. Paragraphs
 * end at blank lines, headings and list items. Each row of a table counts
 * alone, but only when the header and delimiter rows make it certain the
 * parser sees a table. Where it is not sure, it counts lines together, which
 * can only overestimate.
 */
export function markdownParseRisk(text: string): MarkdownParseRisk {
  const risk: MarkdownParseRisk = {
    prefix: 0,
    emphasis: 0,
    inline: 0,
    setext: 0,
    containers: 0,
    tablePadding: 0,
    listItems: 0,
  };
  // The paragraph being read.
  let group = 0;
  let groupTokens = 0;
  let groupSize = 0;
  let groupLines = 0;
  let groupDepth = 0;
  let afterBlank = true;
  let header: { container: string; cells: number } | null = null;
  let table: string | null = null;
  // What the parser has stored so far, roughly: lines and their prefixes
  // for the document, lines and | characters for the blocks in it.
  let documentSize = 0;
  let flowSize = 0;
  // The prefix of the last line with text, and whether it was in a quote.
  let depth = 0;
  let quoted = false;
  // Columns of the table being read, 0 outside a table.
  let columns = 0;
  // Items of the list being read.
  let items = 0;
  const close = () => {
    risk.emphasis += group * group;
    risk.inline += groupTokens * groupSize;
    group = 0;
    groupTokens = 0;
    groupSize = 0;
    groupLines = 0;
    groupDepth = 0;
  };
  for (const line of text.split(LINE_BREAK)) {
    const prefix = LINE_PREFIX.exec(line)?.[0].length ?? 0;
    risk.prefix = Math.max(risk.prefix, prefix);
    const container = CONTAINER.exec(line)?.[0] ?? "";
    const rest = line.slice(container.length);
    const count = line.match(EMPHASIS_CHARACTERS)?.length ?? 0;
    const inline = (line.match(INLINE_TOKENS)?.length ?? 0) + (line.match(LESS_THAN)?.length ?? 0);
    const tokens = 1 + inline;
    const size = 1 + (line.match(SPLITS)?.length ?? 0) + 3 * inline;
    const pipes = line.match(PIPES)?.length ?? 0;
    const before = documentSize;
    documentSize += 1 + 4 * prefix;
    flowSize += 1 + pipes;

    if (!line.trim()) {
      // A blank line ends every quote, not a list.
      if (quoted) {
        risk.containers += before;
        depth = 0;
        quoted = false;
      }
    } else {
      // Leaving a quote or a list.
      if (prefix < depth) risk.containers += before;
      depth = prefix;
      quoted = line.slice(0, prefix).includes(">");
    }

    // After a blank line, a line without a prefix ends the list, unless it
    // starts an item.
    if (LIST_ITEM.test(rest)) items++;
    else if (afterBlank && prefix === 0 && rest.trim()) {
      risk.listItems += items * items;
      items = 0;
    }

    if (!rest.trim()) {
      close();
      afterBlank = true;
      header = null;
      table = null;
      columns = 0;
      continue;
    }
    if (columns > 0) risk.tablePadding += Math.max(0, columns - cellCount(rest));
    if (rest.includes("|") && DELIMITER_ROW.test(rest.trimEnd())) columns = cellCount(rest);
    if (groupLines > 0 && SETEXT_UNDERLINE.test(rest)) risk.setext += flowSize;

    if (table !== null) {
      if (container === table && rest.startsWith("|")) {
        close();
        group = count;
        groupTokens = tokens;
        groupSize = size;
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
    // A lazy line: the paragraph goes on with less of a prefix.
    if (prefix < groupDepth) risk.containers += 4 * groupLines;
    groupDepth = Math.max(groupDepth, prefix);
    afterBlank = false;
    group += count;
    groupTokens += tokens;
    groupSize += size;
    groupLines++;
  }
  close();
  risk.listItems += items * items;
  return risk;
}

/** The limits for a text of this length. */
export function markdownRiskLimits(length: number): MarkdownParseRisk {
  const scale = Math.max(1, length / LIMITS_LENGTH);
  const { prefix, emphasis, inline, setext, containers, tablePadding, listItems } = MARKDOWN_RISK_LIMITS;
  return {
    prefix,
    emphasis,
    inline: inline * scale,
    setext: setext * scale,
    containers: containers * scale,
    tablePadding: tablePadding * scale,
    listItems: listItems * scale,
  };
}

/** True when the text would cost the parser more than its limits allow. */
export function isRiskyMarkdown(text: string): boolean {
  const risk = markdownParseRisk(text);
  const limits = markdownRiskLimits(text.length);
  return (Object.keys(limits) as (keyof MarkdownParseRisk)[]).some((key) => risk[key] > limits[key]);
}
