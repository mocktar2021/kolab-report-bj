import { renumber } from "@/lib/section-outline";
import type { SectionStatus } from "@/lib/sections";
import type { ImageFormat } from "./image-header";

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
};

/**
 * An image of a section's text (KRB-216), read by the route with the user's
 * rights. unavailable: deleted, of another report, or not a PNG or JPEG.
 * tooLarge: past the caps of one image. limit: past the caps of the export.
 */
export type ExportImage =
  | {
      status: "ready";
      format: ImageFormat;
      data: Buffer;
      /** Pixels as stored. orientation (Exif, 1 to 8) says how to turn them. */
      width: number;
      height: number;
      orientation: number;
    }
  | { status: "unavailable" | "tooLarge" | "limit" };

export type ExportDocument = {
  title: string;
  workspaceName: string;
  /** When the export was made, shown on the cover page. */
  generatedAt: Date;
  /** Sections in report order, each followed by its subsections. */
  sections: ExportSection[];
  /** The images the sections show, by deliverable id. A missing one is unavailable. */
  images?: ReadonlyMap<string, ExportImage>;
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
