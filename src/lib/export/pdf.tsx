import "server-only";
import {
  Document,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
  type Styles,
} from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { EXPORT_TEXT, generatedOn, pageLabel, sectionMeta } from "./labels";
import {
  TOP_PLACE,
  cleanLine,
  nest,
  runsText,
  sectionBlocks,
  type Block,
  type Place,
  type TextRun,
} from "./markdown";
import type { ExportDocument, ExportSection } from "./types";
import { toWinAnsi } from "./winansi";

// The PDF export (KRB-18), drawn server-side with @react-pdf/renderer: a
// cover page, a "Sommaire" page whose entries link to the sections, then
// each section on a new page. The footer shows the report title and
// "Page X sur Y". Sections are also PDF bookmarks, so readers list them in
// their side panel.
//
// Blocks are laid out flat, each with its own left margin, instead of nested
// views: deep lists and quotes stop at EXPORT_LIMITS.depth like in the .docx,
// and the page breaker only deals with short boxes. All text goes through
// toWinAnsi for the standard fonts (see winansi.ts).

type Style = Styles[string];

// A4 is 595 by 842 points.
const CONTENT_WIDTH = 595 - 2 * 57;
const CONTENT_HEIGHT = 842 - 50 - 56;
// Footer titles longer than this are cut, so the footer stays on one line.
const FOOTER_TITLE_CHARS = 90;

const COLORS = { text: "#1a1a1a", muted: "#595959", light: "#808080", border: "#bfbfbf", shade: "#f2f2f2" };
const LIST_INDENT = 18;
const QUOTE_INDENT = 14;

const styles = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingBottom: 56,
    paddingHorizontal: 57,
    fontFamily: "Helvetica",
    fontSize: 10.5,
    color: COLORS.text,
  },
  cover: { paddingHorizontal: 57, paddingTop: 220, fontFamily: "Helvetica", color: COLORS.text },
  coverTitle: { fontSize: 28, fontWeight: 700, color: "#1f3864", lineHeight: 1.2 },
  coverWorkspace: { fontSize: 16, color: "#404040", marginTop: 16 },
  coverDate: { fontSize: 12, color: COLORS.muted, marginTop: 28 },
  footerTitle: { position: "absolute", bottom: 24, left: 57, right: 170, fontSize: 8, color: COLORS.light },
  footerPage: {
    position: "absolute",
    bottom: 24,
    right: 57,
    width: 110,
    fontSize: 8,
    color: COLORS.light,
    textAlign: "right",
  },
  contentsTitle: { fontSize: 18, fontWeight: 700, color: "#1f3864", marginBottom: 14 },
  contentsEntry: { fontSize: 11, marginBottom: 6, color: COLORS.text, textDecoration: "none" },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: "#1f3864", lineHeight: 1.25, marginBottom: 4 },
  sectionMeta: { fontSize: 9, fontStyle: "italic", color: COLORS.muted, marginBottom: 14 },
  empty: { fontStyle: "italic", color: COLORS.muted },
  // Line heights stay off the page style, where react-pdf drops the page
  // numbers. A unitless one is read against the fontSize of the same style.
  paragraph: { fontSize: 10.5, lineHeight: 1.4, marginBottom: 6 },
  quote: {
    fontStyle: "italic",
    color: "#404040",
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    paddingLeft: 8,
  },
  heading2: { fontSize: 14, fontWeight: 700, color: "#2e74b5", marginTop: 10, marginBottom: 4 },
  heading3: { fontSize: 12, fontWeight: 700, color: "#1f4d78", marginTop: 8, marginBottom: 3 },
  heading4: {
    fontSize: 10.5,
    fontWeight: 700,
    fontStyle: "italic",
    color: "#1f4d78",
    marginTop: 6,
    marginBottom: 2,
  },
  listItem: { flexDirection: "row", fontSize: 10.5, lineHeight: 1.4, marginBottom: 3 },
  listMarker: { width: LIST_INDENT },
  listText: { flex: 1 },
  code: {
    fontFamily: "Courier",
    fontSize: 8.5,
    lineHeight: 1.3,
    backgroundColor: COLORS.shade,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 8,
  },
  rule: { borderBottomWidth: 0.75, borderBottomColor: COLORS.border, marginTop: 4, marginBottom: 10 },
  table: { borderTopWidth: 0.75, borderLeftWidth: 0.75, borderColor: COLORS.border, marginBottom: 10 },
  row: { flexDirection: "row" },
  headerRow: { backgroundColor: COLORS.shade },
  cell: { borderRightWidth: 0.75, borderBottomWidth: 0.75, borderColor: COLORS.border, padding: 3 },
});

const HEADING_STYLES = [styles.heading2, styles.heading3, styles.heading4];
const BULLETS = ["•", "\u2013"];
const sectionAnchor = (index: number) => `section-${index + 1}`;

/**
 * Where a word may break across lines. react-pdf's default hyphenation uses
 * English patterns, wrong for French: words stay whole here, and only words
 * longer than `part` characters (addresses, references) are cut into parts.
 * react-pdf clips a word wider than its box, and draws a hyphen where it
 * breaks one.
 */
function wordBreaker(part: number) {
  return (word: string): string[] => {
    if (word.length <= part) return [word];
    const parts: string[] = [];
    for (let index = 0; index < word.length; index += part) parts.push(word.slice(index, index + part));
    return parts;
  };
}

const breakWords = wordBreaker(20);

const NBSP = "\u00a0";

/**
 * react-pdf drops leading spaces and collapses runs of them. In code, leading
 * spaces and all but the last space of a run become no-break spaces, so
 * indentation survives and long lines can still wrap.
 */
function keepSpaces(code: string): string {
  return code
    .split("\n")
    .map((line) =>
      line
        .replace(/^ +/, (spaces) => NBSP.repeat(spaces.length))
        .replace(/ {2,}/g, (spaces) => `${NBSP.repeat(spaces.length - 1)} `),
    )
    .join("\n");
}

/**
 * About how tall text is once wrapped, in points. Helvetica letters average
 * about 0.55 em; 0.65 leaves room for wide letters and line ends.
 */
function textHeight(text: string, width: number, fontSize: number, lineHeight: number): number {
  const perLine = Math.max(1, Math.floor(width / (fontSize * 0.65)));
  let lines = 0;
  for (const line of text.split("\n")) lines += Math.max(1, Math.ceil(line.length / perLine));
  return lines * fontSize * lineHeight;
}

/**
 * Whether a box can be kept on one page (wrap={false}). react-pdf drops what
 * doesn't fit when such a box is taller than a page, so only boxes well under
 * a third of one are kept together.
 */
function fitsKeptTogether(height: number): boolean {
  return height < CONTENT_HEIGHT / 3;
}

function runStyle(run: TextRun): Style {
  const style: Style = {};
  if (run.bold) style.fontWeight = 700;
  if (run.italic) style.fontStyle = "italic";
  if (run.code) style.fontFamily = "Courier";
  if (run.strike) style.textDecoration = "line-through";
  return style;
}

/** Runs inside a text: plain ones as strings, which saves react-pdf a node each. */
function Runs({ runs }: { runs: readonly TextRun[] }) {
  return runs.map((run, index) =>
    run.bold || run.italic || run.code || run.strike ? (
      <Text key={index} style={runStyle(run)}>
        {toWinAnsi(run.text)}
      </Text>
    ) : (
      toWinAnsi(run.text)
    ),
  );
}

function marginOf(place: Place): Style {
  const left = place.quotes * QUOTE_INDENT + place.lists * LIST_INDENT;
  return left ? { marginLeft: left } : {};
}

/** Draws blocks as a flat list of boxes. */
class PdfBody {
  private keys = 0;

  private key(): number {
    return this.keys++;
  }

  blocks(blocks: readonly Block[], place: Place): ReactNode[] {
    return blocks.flatMap((block) => this.block(block, place));
  }

  private paragraph(runs: readonly TextRun[], place: Place, extra: Style[] = []): ReactNode {
    const quoted = place.quotes > 0 ? [styles.quote] : [];
    return (
      <Text
        key={this.key()}
        style={[styles.paragraph, marginOf(place), ...quoted, ...extra]}
        hyphenationCallback={breakWords}
      >
        <Runs runs={runs} />
      </Text>
    );
  }

  private block(block: Block, place: Place): ReactNode[] {
    switch (block.type) {
      case "paragraph":
        return [this.paragraph(block.runs, place)];
      case "heading": {
        const style = HEADING_STYLES[Math.min(block.depth, HEADING_STYLES.length) - 1] ?? styles.heading4;
        return [
          <Text
            key={this.key()}
            style={[style, marginOf(place)]}
            minPresenceAhead={40}
            hyphenationCallback={breakWords}
          >
            <Runs runs={block.runs} />
          </Text>,
        ];
      }
      case "rule":
        return [<View key={this.key()} style={[styles.rule, marginOf(place)]} />];
      case "code":
        return [
          <Text key={this.key()} style={[styles.code, marginOf(place)]} hyphenationCallback={breakWords}>
            {keepSpaces(toWinAnsi(block.text))}
          </Text>,
        ];
      case "quote":
        return this.blocks(block.blocks, nest(place, "quotes"));
      case "list":
        return this.list(block, place);
      case "table":
        return [this.table(block, place)];
    }
  }

  private list(block: Extract<Block, { type: "list" }>, place: Place): ReactNode[] {
    const inner = nest(place, "lists");
    const quoted = place.quotes > 0 ? [styles.quote] : [];
    return block.items.flatMap((item, index) => {
      const [first, ...rest] = item.blocks;
      const marker = block.ordered
        ? `${block.start + index}.`
        : (BULLETS[Math.max(inner.lists - 1, 0) % BULLETS.length] ?? "•");
      const checkbox: TextRun[] = item.checked === null ? [] : [{ text: item.checked ? "[x] " : "[ ] " }];
      const lead = [...checkbox, ...(first?.type === "paragraph" ? first.runs : [])];
      const width = CONTENT_WIDTH - Number(marginOf(place).marginLeft ?? 0) - LIST_INDENT;
      const height = textHeight(runsText(lead), width, 10.5, 1.4);
      return [
        // A short item stays with its marker on one page.
        <View
          key={this.key()}
          style={[styles.listItem, marginOf(place), ...quoted]}
          wrap={!fitsKeptTogether(height)}
        >
          <Text style={styles.listMarker}>{marker}</Text>
          <Text style={styles.listText} hyphenationCallback={breakWords}>
            <Runs runs={lead} />
          </Text>
        </View>,
        ...this.blocks(first?.type === "paragraph" ? rest : item.blocks, inner),
      ];
    });
  }

  private table(block: Extract<Block, { type: "table" }>, place: Place): ReactNode {
    const columns = block.align.length;
    const width = `${100 / columns}%`;
    const fontSize = columns > 10 ? 6.5 : columns > 5 ? 8 : 9;
    const cellWidth = (CONTENT_WIDTH - Number(marginOf(place).marginLeft ?? 0)) / columns - 6;
    // Characters that fit across a cell, Helvetica letters being about 0.55 em wide.
    const breaker = wordBreaker(Math.max(3, Math.min(20, Math.floor(cellWidth / (fontSize * 0.55)))));
    return (
      <View key={this.key()} style={[styles.table, marginOf(place)]}>
        {block.rows.map((row, rowIndex) => {
          const height = Math.max(...row.map((cell) => textHeight(runsText(cell), cellWidth, fontSize, 1.3)));
          return (
            <View
              key={rowIndex}
              style={rowIndex === 0 ? [styles.row, styles.headerRow] : styles.row}
              // A short row moves whole to the next page instead of splitting.
              wrap={!fitsKeptTogether(height)}
            >
              {row.map((cell, column) => (
                <View key={column} style={[styles.cell, { width }]}>
                  <Text
                    style={{
                      fontSize,
                      lineHeight: 1.3,
                      textAlign: block.align[column] ?? "left",
                      fontWeight: rowIndex === 0 ? 700 : 400,
                    }}
                    hyphenationCallback={breaker}
                  >
                    <Runs runs={cell} />
                  </Text>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    );
  }
}

// Two fixed texts rather than one row: react-pdf drops a fixed row that
// holds a text drawn with render().
function Footer({ title }: { title: string }) {
  const shown =
    title.length > FOOTER_TITLE_CHARS ? `${title.slice(0, FOOTER_TITLE_CHARS - 1).trimEnd()}…` : title;
  return (
    <>
      <Text fixed style={styles.footerTitle}>
        {shown}
      </Text>
      <Text
        fixed
        style={styles.footerPage}
        render={({ pageNumber, totalPages }) => pageLabel(pageNumber, totalPages)}
      />
    </>
  );
}

/** Roughly what a block costs to lay out: its characters, plus a little per box. */
function blockSize(block: Block): number {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return 20 + runsText(block.runs).length;
    case "code":
      return 20 + block.text.length;
    case "rule":
      return 20;
    case "quote":
      return block.blocks.reduce((sum, inner) => sum + blockSize(inner), 0);
    case "list":
      return block.items.reduce(
        (sum, item) => sum + 20 + item.blocks.reduce((itemSum, inner) => itemSum + blockSize(inner), 0),
        0,
      );
    case "table":
      return block.rows.reduce(
        (sum, row) => sum + row.reduce((rowSum, cell) => rowSum + 20 + runsText(cell).length, 0),
        0,
      );
  }
}

/**
 * Splits a long section into groups of blocks, each drawn as its own Page.
 * react-pdf lays out what is left of a Page again at each page break, so its
 * time grows with the square of a Page's length: about 7 s for a section of
 * 100 000 characters in one Page. A group ends before a heading once it holds
 * PAGE_GROUP.soft, or before any block once it holds PAGE_GROUP.hard. Each
 * group starts a new sheet.
 */
const PAGE_GROUP = { soft: 12_000, hard: 40_000 } as const;

export function pageGroups(blocks: readonly Block[]): Block[][] {
  const groups: Block[][] = [[]];
  let size = 0;
  for (const block of blocks) {
    const atHeading = block.type === "heading" && block.depth <= 2;
    if (size >= PAGE_GROUP.hard || (size >= PAGE_GROUP.soft && atHeading)) {
      groups.push([]);
      size = 0;
    }
    groups.at(-1)!.push(block);
    size += blockSize(block);
  }
  return groups;
}

function sectionPages(section: ExportSection, index: number, title: string) {
  const blocks = sectionBlocks(section.markdown);
  const assignee = section.assigneeName && cleanLine(section.assigneeName);
  const body = new PdfBody();
  return pageGroups(blocks).map((group, groupIndex) => (
    <Page
      key={`${index}-${groupIndex}`}
      size="A4"
      style={styles.page}
      bookmark={groupIndex === 0 ? { title: cleanLine(section.title), fit: true } : undefined}
    >
      <Footer title={title} />
      {groupIndex === 0 ? (
        <>
          <Text id={sectionAnchor(index)} style={styles.sectionTitle} hyphenationCallback={breakWords}>
            {toWinAnsi(cleanLine(section.title))}
          </Text>
          <Text style={styles.sectionMeta}>{toWinAnsi(sectionMeta(assignee, section.status))}</Text>
        </>
      ) : null}
      {blocks.length > 0 ? (
        body.blocks(group, TOP_PLACE)
      ) : (
        <Text style={styles.empty}>{EXPORT_TEXT.emptySection}</Text>
      )}
    </Page>
  ));
}

function ReportPdf({ doc }: { doc: ExportDocument }) {
  const plainTitle = cleanLine(doc.title);
  const title = toWinAnsi(plainTitle);
  return (
    <Document title={plainTitle} creator="KolabReport" producer="KolabReport" language="fr-FR">
      <Page size="A4" style={styles.cover}>
        <Text style={styles.coverTitle} hyphenationCallback={breakWords}>
          {title}
        </Text>
        <Text style={styles.coverWorkspace}>{toWinAnsi(cleanLine(doc.workspaceName))}</Text>
        <Text style={styles.coverDate}>{generatedOn(doc.generatedAt)}</Text>
      </Page>
      <Page size="A4" style={styles.page} bookmark={{ title: EXPORT_TEXT.contents, fit: true }}>
        <Footer title={title} />
        <Text style={styles.contentsTitle}>{EXPORT_TEXT.contents}</Text>
        {doc.sections.length === 0 ? <Text style={styles.empty}>{EXPORT_TEXT.noSections}</Text> : null}
        {doc.sections.map((section, index) => (
          <Link key={index} src={`#${sectionAnchor(index)}`} style={styles.contentsEntry}>
            {toWinAnsi(`${index + 1}. ${cleanLine(section.title)}`)}
          </Link>
        ))}
      </Page>
      {doc.sections.flatMap((section, index) => sectionPages(section, index, title))}
    </Document>
  );
}

/** The report as a PDF file. */
export async function buildReportPdf(doc: ExportDocument): Promise<Buffer> {
  return renderToBuffer(<ReportPdf doc={doc} />);
}
