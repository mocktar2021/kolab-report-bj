import type { SectionStatus } from "@/lib/sections";

// What an export of a master report holds (Story KRB-18). The route reads
// the report with the user's rights and hands this to the .docx or PDF
// builder, which only formats it: no database access in the builders.

export const EXPORT_FORMATS = ["docx", "pdf"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportSection = {
  title: string;
  status: SectionStatus;
  /** Display name of the assigned expert, null when unassigned. */
  assigneeName: string | null;
  /** The section text as Markdown (GFM), null or blank when empty. */
  markdown: string | null;
};

export type ExportDocument = {
  title: string;
  workspaceName: string;
  /** When the export was made, shown on the cover page. */
  generatedAt: Date;
  /** Sections in report order. */
  sections: ExportSection[];
};

export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};
