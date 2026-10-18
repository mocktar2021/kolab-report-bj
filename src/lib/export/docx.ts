import "server-only";
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun as DocxTextRun,
  WidthType,
  type FileChild,
  type IBorderOptions,
  type INumberingOptions,
  type IParagraphOptions,
} from "docx";
import { annexTable, annexes, type Annex } from "./annexes";
import { ANNEX_TEXT, EXPORT_TEXT, PAGE_WORDS, generatedOn, sectionMeta } from "./labels";
import {
  EXPORT_LIMITS,
  TOP_PLACE,
  cleanLine,
  nest,
  sectionBlocks,
  type Block,
  type ColumnAlign,
  type Place,
  type TextRun,
} from "./markdown";
import { numberedSections, type ExportDocument, type NumberedSection } from "./types";

// The .docx export (KRB-18): a cover page, a "Sommaire" that is a real Word
// table of contents, then one Heading 1 per section, each on a new page.
// Section headings move one level down (# is Heading 2) so the report keeps
// a single outline.
//
// The table of contents is a TOC field. Word refills it when the file opens
// (updateFields), and its cached entries already list the section titles,
// linked to their headings, for readers that never update fields (LibreOffice,
// Google Docs import, previews). Those entries have no page numbers until Word
// refreshes them.

// A4 with 2 cm margins, in twentieths of a point.
const PAGE = { width: 11906, height: 16838, margin: 1134 } as const;
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;
const LIST_INDENT = 360;
const QUOTE_INDENT = 567;
const CODE_FONT = "Courier New";
const MUTED = "595959";
const BORDER_COLOR = "BFBFBF";
// Bookmarks behind the TOC links. Word wants letters, digits and underscores.
const sectionAnchor = (index: number) => `section_${index + 1}`;

const BULLETS = ["•", "◦", "▪"] as const;
const BULLET_REFERENCE = "bullets";

/** Left indent of content at this place, list markers excluded. */
function indentOf(place: Place): number {
  return place.quotes * QUOTE_INDENT + place.lists * LIST_INDENT;
}

const quoteBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 12, color: BORDER_COLOR, space: 8 };
const cellBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR };

/** Runs of text as docx runs, "\n" as line breaks. extra applies to every run. */
function docxRuns(runs: readonly TextRun[], extra: { italics?: boolean; size?: number } = {}): DocxTextRun[] {
  const result: DocxTextRun[] = [];
  for (const run of runs) {
    run.text.split("\n").forEach((line, index) => {
      result.push(
        new DocxTextRun({
          text: line,
          break: index > 0 ? 1 : undefined,
          bold: run.bold,
          italics: run.italic || extra.italics,
          strike: run.strike,
          font: run.code ? CODE_FONT : undefined,
          size: extra.size,
          shading: run.code ? { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" } : undefined,
        }),
      );
    });
  }
  return result;
}

const ALIGNMENTS = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const;

function alignment(align: ColumnAlign) {
  return align ? ALIGNMENTS[align] : undefined;
}

const HEADINGS = [HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4] as const;

/**
 * Builds the body of one document. Each ordered list gets its own numbering
 * instance so it restarts at its first number; references are made per start
 * value, since docx sets the start on the reference.
 */
class DocxBody {
  private readonly orderedReferences = new Map<number, string>();
  private instances = 0;
  /** 1 in a subsection (KRB-195): its text's headings start one level lower. */
  headingShift = 0;
  readonly numbering: INumberingOptions["config"][number][] = [
    {
      reference: BULLET_REFERENCE,
      levels: Array.from({ length: EXPORT_LIMITS.depth }, (_, level) => ({
        level,
        format: LevelFormat.BULLET,
        text: BULLETS[level % BULLETS.length],
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: LIST_INDENT * (level + 1), hanging: LIST_INDENT } } },
      })),
    },
  ];

  private orderedReference(start: number): string {
    let reference = this.orderedReferences.get(start);
    if (!reference) {
      reference = `ordered_${start}`;
      this.orderedReferences.set(start, reference);
      this.numbering.push({
        reference,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            start,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: LIST_INDENT, hanging: LIST_INDENT } } },
          },
        ],
      });
    }
    return reference;
  }

  blocks(blocks: readonly Block[], place: Place): FileChild[] {
    return blocks.flatMap((block) => this.block(block, place));
  }

  private paragraph(runs: readonly TextRun[], place: Place, options: IParagraphOptions = {}): Paragraph {
    const quoted = place.quotes > 0;
    return new Paragraph({
      children: docxRuns(runs, { italics: quoted }),
      indent: indentOf(place) ? { left: indentOf(place) } : undefined,
      border: quoted ? { left: quoteBorder } : undefined,
      ...options,
    });
  }

  private block(block: Block, place: Place): FileChild[] {
    switch (block.type) {
      case "paragraph":
        return [this.paragraph(block.runs, place)];
      case "heading": {
        if (place.quotes > 0 || place.lists > 0) {
          // Inside a list or a quote: bold text, kept out of the outline.
          const bold = block.runs.map((run) => ({ ...run, bold: true }));
          return [this.paragraph(bold, place)];
        }
        return [
          new Paragraph({
            heading: HEADINGS[Math.min(block.depth + this.headingShift, HEADINGS.length) - 1],
            children: docxRuns(block.runs),
          }),
        ];
      }
      case "rule":
        return [
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER_COLOR, space: 1 } },
            indent: indentOf(place) ? { left: indentOf(place) } : undefined,
          }),
        ];
      case "code": {
        const lines = block.text.split("\n");
        return lines.map(
          (line, index) =>
            new Paragraph({
              children: [new DocxTextRun({ text: line, font: CODE_FONT, size: 18 })],
              indent: { left: indentOf(place) + 113, right: 113 },
              shading: { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" },
              spacing: {
                before: index === 0 ? 60 : 0,
                after: index === lines.length - 1 ? 180 : 0,
                line: 240,
                lineRule: LineRuleType.AUTO,
              },
            }),
        );
      }
      case "quote":
        return this.blocks(block.blocks, nest(place, "quotes"));
      case "list":
        return this.list(block, place);
      case "table":
        return [this.table(block, place)];
    }
  }

  private list(block: Extract<Block, { type: "list" }>, place: Place): FileChild[] {
    const inner = nest(place, "lists");
    const numbering = block.ordered
      ? { reference: this.orderedReference(block.start), level: 0, instance: this.instances++ }
      : { reference: BULLET_REFERENCE, level: Math.max(inner.lists - 1, 0), instance: 0 };
    const result: FileChild[] = [];
    for (const item of block.items) {
      const [first, ...rest] = item.blocks;
      const checkbox: TextRun[] = item.checked === null ? [] : [{ text: item.checked ? "[x] " : "[ ] " }];
      const lead = first?.type === "paragraph" ? first.runs : [];
      result.push(
        this.paragraph([...checkbox, ...lead], place, {
          numbering,
          indent: { left: indentOf(inner), hanging: LIST_INDENT },
          spacing: { after: 60 },
        }),
      );
      result.push(...this.blocks(first?.type === "paragraph" ? rest : item.blocks, inner));
    }
    return result;
  }

  private table(block: Extract<Block, { type: "table" }>, place: Place): Table {
    const indent = indentOf(place);
    const width = CONTENT_WIDTH - indent;
    const columns = block.align.length;
    const columnWidth = Math.floor(width / columns);
    const rows = block.rows.map(
      (row, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          children: row.map(
            (cell, column) =>
              new TableCell({
                width: { size: columnWidth, type: WidthType.DXA },
                shading:
                  rowIndex === 0 ? { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" } : undefined,
                margins: { top: 40, bottom: 40, left: 80, right: 80 },
                children: [
                  new Paragraph({
                    alignment: alignment(block.align[column] ?? null),
                    spacing: { after: 0 },
                    children: docxRuns(rowIndex === 0 ? cell.map((run) => ({ ...run, bold: true })) : cell, {
                      size: columns > 6 ? 18 : 20,
                    }),
                  }),
                ],
              }),
          ),
        }),
    );
    return new Table({
      rows,
      width: { size: width, type: WidthType.DXA },
      columnWidths: Array.from({ length: columns }, () => columnWidth),
      indent: indent ? { size: indent, type: WidthType.DXA } : undefined,
      borders: {
        top: cellBorder,
        bottom: cellBorder,
        left: cellBorder,
        right: cellBorder,
        insideHorizontal: cellBorder,
        insideVertical: cellBorder,
      },
    });
  }
}

function coverPage(doc: ExportDocument, title: string): Paragraph[] {
  return [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { before: 3600, after: 240 },
      children: [new DocxTextRun({ text: title })],
    }),
    new Paragraph({
      spacing: { after: 480 },
      children: [new DocxTextRun({ text: cleanLine(doc.workspaceName), size: 32, color: "404040" })],
    }),
    new Paragraph({
      children: [new DocxTextRun({ text: generatedOn(doc.generatedAt), size: 24, color: MUTED })],
    }),
  ];
}

/** "1. Contexte" or "1.1 Objectifs". */
function numberedTitle(section: NumberedSection): string {
  return `${section.label} ${cleanLine(section.title)}`;
}

/**
 * A section starts a new page as Heading 1; a subsection follows the text
 * before it, as Heading 2, and its own headings start at Heading 3.
 */
function sectionChildren(section: NumberedSection, index: number, body: DocxBody): FileChild[] {
  const blocks = sectionBlocks(section.markdown);
  const sub = section.level === 2;
  body.headingShift = sub ? 1 : 0;
  return [
    new Paragraph({
      heading: sub ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
      pageBreakBefore: !sub,
      children: [
        new Bookmark({ id: sectionAnchor(index), children: [new DocxTextRun(numberedTitle(section))] }),
      ],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new DocxTextRun({
          text: sectionMeta(section.assigneeName && cleanLine(section.assigneeName), section.status),
          italics: true,
          size: 18,
          color: MUTED,
        }),
      ],
    }),
    ...(blocks.length > 0
      ? body.blocks(blocks, TOP_PLACE)
      : [new Paragraph({ children: [new DocxTextRun({ text: EXPORT_TEXT.emptySection, italics: true })] })]),
  ];
}

const ANNEXES_ANCHOR = "annexes";

/**
 * The "Annexes" page (KRB-215) on a new page after the sections: a Heading 1
 * listed in the contents, then each section's title and the table of its
 * files. The titles are bold text rather than headings, so a refreshed table
 * of contents does not list the sections twice.
 */
function annexesChildren(list: readonly Annex[], body: DocxBody): FileChild[] {
  if (list.length === 0) return [];
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [new Bookmark({ id: ANNEXES_ANCHOR, children: [new DocxTextRun(ANNEX_TEXT.title)] })],
    }),
    ...list.flatMap((annex) => [
      new Paragraph({
        keepNext: true,
        spacing: { before: 240, after: 120 },
        children: [new DocxTextRun({ text: annex.title, bold: true, size: 24, color: "1F4D78" })],
      }),
      ...body.blocks([annexTable(annex.files)], TOP_PLACE),
    ]),
  ];
}

/** The report as a .docx file. */
export async function buildReportDocx(doc: ExportDocument): Promise<Buffer> {
  const title = cleanLine(doc.title);
  const body = new DocxBody();
  const numbered = numberedSections(doc.sections);
  const sections = numbered.flatMap((section, index) => sectionChildren(section, index, body));
  const annexList = annexes(doc);
  const contents: FileChild[] = [
    new Paragraph({
      style: "TOCHeading",
      pageBreakBefore: true,
      children: [new DocxTextRun(EXPORT_TEXT.contents)],
    }),
    new TableOfContents(EXPORT_TEXT.contents, {
      headingStyleRange: "1-3",
      hyperlink: true,
      cachedEntries: [
        ...numbered.map((section, index) => ({
          title: numberedTitle(section),
          level: section.level,
          href: sectionAnchor(index),
        })),
        ...(annexList.length > 0 ? [{ title: ANNEX_TEXT.title, level: 1, href: ANNEXES_ANCHOR }] : []),
      ],
    }),
    ...(doc.sections.length === 0
      ? [new Paragraph({ children: [new DocxTextRun({ text: EXPORT_TEXT.noSections, italics: true })] })]
      : []),
  ];

  const document = new Document({
    title,
    creator: "KolabReport",
    lastModifiedBy: "KolabReport",
    features: { updateFields: true },
    numbering: { config: body.numbering },
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22, language: { value: "fr-FR" } },
          // LibreOffice reads a line spacing without its rule as exact.
          paragraph: { spacing: { after: 120, line: 276, lineRule: LineRuleType.AUTO } },
        },
        title: { run: { size: 56, bold: true, color: "1F3864" } },
        heading1: {
          run: { size: 32, bold: true, color: "1F3864" },
          paragraph: { outlineLevel: 0, keepNext: true, spacing: { before: 240, after: 60 } },
        },
        heading2: {
          run: { size: 26, bold: true, color: "2E74B5" },
          paragraph: { outlineLevel: 1, keepNext: true, spacing: { before: 240, after: 80 } },
        },
        heading3: {
          run: { size: 24, bold: true, color: "1F4D78" },
          paragraph: { outlineLevel: 2, keepNext: true, spacing: { before: 200, after: 60 } },
        },
        heading4: {
          run: { size: 22, bold: true, italics: true, color: "1F4D78" },
          paragraph: { outlineLevel: 3, keepNext: true, spacing: { before: 160, after: 40 } },
        },
      },
      paragraphStyles: [
        // On the paragraph rather than the run, so the page fields get it too.
        ...["Header", "Footer"].map((id) => ({
          id,
          name: id.toLowerCase(),
          basedOn: "Normal",
          run: { size: 16, color: "808080" },
          paragraph: { spacing: { after: 0 } },
        })),
        {
          id: "TOCHeading",
          name: "TOC Heading",
          basedOn: "Normal",
          next: "Normal",
          run: { size: 32, bold: true, color: "1F3864" },
          paragraph: { spacing: { after: 240 } },
        },
        ...[1, 2, 3].map((level) => ({
          id: `TOC${level}`,
          name: `toc ${level}`,
          basedOn: "Normal",
          next: "Normal",
          paragraph: { indent: { left: (level - 1) * 240 }, spacing: { after: 60 } },
        })),
      ],
    },
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: {
              top: PAGE.margin,
              bottom: PAGE.margin,
              left: PAGE.margin,
              right: PAGE.margin,
              header: 567,
              footer: 567,
            },
          },
        },
        headers: {
          first: new Header({ children: [] }),
          default: new Header({
            children: [
              new Paragraph({
                style: "Header",
                alignment: AlignmentType.RIGHT,
                children: [new DocxTextRun(title)],
              }),
            ],
          }),
        },
        footers: {
          first: new Footer({ children: [] }),
          default: new Footer({
            children: [
              new Paragraph({
                style: "Footer",
                alignment: AlignmentType.CENTER,
                children: [
                  new DocxTextRun({
                    children: [PAGE_WORDS.page, PageNumber.CURRENT, PAGE_WORDS.of, PageNumber.TOTAL_PAGES],
                  }),
                ],
              }),
            ],
          }),
        },
        children: [...coverPage(doc, title), ...contents, ...sections, ...annexesChildren(annexList, body)],
      },
    ],
  });
  return Packer.toBuffer(document);
}
