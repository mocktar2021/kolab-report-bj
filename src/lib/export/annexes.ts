import { ANNEX_TEXT, UNKNOWN_MEMBER_LABEL, formatExportDate } from "./labels";
import { cleanLine, type Block } from "./markdown";
import { numberedSections, type ExportDocument } from "./types";

// The "Annexes" page that ends an export when the box is ticked (KRB-215):
// for each section with files, in report order, its number and title, then a
// table of its files with who added them and when. Both builders draw what
// annexes() returns, so the .docx and the PDF list the same thing.

export type AnnexFile = { name: string; addedBy: string; addedOn: string };

export type Annex = {
  /** "1. Contexte" or "1.1 Objectifs", numbered like the sections of the export. */
  title: string;
  files: AnnexFile[];
};

/** The sections the annexes list, empty when the export leaves them out or no section has a file. */
export function annexes(doc: ExportDocument): Annex[] {
  if (!doc.withAnnexes) return [];
  return numberedSections(doc.sections).flatMap((section) => {
    const files = section.deliverables ?? [];
    if (files.length === 0) return [];
    return [
      {
        title: `${section.label} ${cleanLine(section.title)}`,
        files: files.map((file) => ({
          name: cleanLine(file.fileName),
          addedBy: cleanLine(file.addedBy ?? "") || UNKNOWN_MEMBER_LABEL,
          addedOn: formatExportDate(file.addedAt),
        })),
      },
    ];
  });
}

/** Files as a table block under the column names, for the builders' table drawing. */
export function annexTable(files: readonly AnnexFile[]): Extract<Block, { type: "table" }> {
  return {
    type: "table",
    align: [null, null, null],
    rows: [
      [ANNEX_TEXT.file, ANNEX_TEXT.addedBy, ANNEX_TEXT.addedOn].map((text) => [{ text }]),
      ...files.map((file) => [[{ text: file.name }], [{ text: file.addedBy }], [{ text: file.addedOn }]]),
    ],
  };
}

/** Characters the annexes add to an export, counted against its size limit. */
export function annexChars(doc: ExportDocument): number {
  if (!doc.withAnnexes) return 0;
  return doc.sections.reduce(
    (sum, section) =>
      sum +
      (section.deliverables ?? []).reduce(
        (files, file) => files + file.fileName.length + (file.addedBy?.length ?? 0),
        0,
      ),
    0,
  );
}
