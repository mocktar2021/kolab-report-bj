import { renumber } from "@/lib/section-outline";
import type { SectionStatus } from "@/lib/sections";

// What an export of a master report holds (Story KRB-18). The route reads
// the report with the user's rights and hands this to the .docx or PDF
// builder, which only formats it: no database access in the builders.

export const EXPORT_FORMATS = ["docx", "pdf"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportSection = {
  title: string;
  /** 2 for a subsection, which follows its section (KRB-195). Default 1. */
  level?: 1 | 2;
  status: SectionStatus;
  /** Display name of the assigned expert, null when unassigned. */
  assigneeName: string | null;
  /** The section text as Markdown (GFM), null or blank when empty. */
  markdown: string | null;
  /** Its files, in the order they were added, for the annexes (KRB-215). */
  deliverables?: ExportDeliverable[];
};

/** A file added to a section, listed on the "Annexes" page (KRB-215). */
export type ExportDeliverable = {
  fileName: string;
  /** Display name of who added it, null when unknown. */
  addedBy: string | null;
  addedAt: Date;
};

export type ExportDocument = {
  title: string;
  workspaceName: string;
  /** When the export was made, shown on the cover page. */
  generatedAt: Date;
  /** Sections in report order, each followed by its subsections. */
  sections: ExportSection[];
  /**
   * Ends the export with an "Annexes" page that lists the files of each
   * section (KRB-215). Sections without files are left out, and so is the
   * page when no section has any.
   */
  withAnnexes?: boolean;
};

/** The sections with their level and number ("1." or "1.1"), in the order given. */
export function numberedSections(sections: readonly ExportSection[]) {
  return renumber(sections.map((section) => ({ ...section, level: section.level ?? 1 })));
}

export type NumberedSection = ReturnType<typeof numberedSections>[number];

export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};
