import "server-only";
import { buildReportDocx } from "./docx";
import { buildReportPdf } from "./pdf";
import type { ExportDocument, ExportFormat } from "./types";

// Report exports (KRB-18). The builders only format the document they get:
// no database, network or disk access. They need the Node.js runtime.

/**
 * Characters of section text an export may hold. Measured on a report of 30
 * sections: 1 000 000 characters take about 15 s and 1 GB of memory as a PDF,
 * 3 000 000 about 11 s and 1.1 GB as a .docx. A typical report of 300 000
 * characters takes about 5 s as a PDF and 1 s as a .docx.
 */
export const EXPORT_MAX_CHARS: Record<ExportFormat, number> = {
  docx: 3_000_000,
  pdf: 1_000_000,
};

/** Thrown by buildExport when the report holds more than EXPORT_MAX_CHARS. */
export class ExportTooLargeError extends Error {
  constructor(
    readonly format: ExportFormat,
    readonly chars: number,
  ) {
    super(`report too large to export as ${format}: ${chars} characters`);
    this.name = "ExportTooLargeError";
  }
}

/** Characters of section text in the report, titles included. */
export function exportChars(doc: ExportDocument): number {
  return doc.sections.reduce(
    (sum, section) => sum + section.title.length + (section.markdown?.length ?? 0),
    0,
  );
}

/** The report as a file in the given format. */
export async function buildExport(doc: ExportDocument, format: ExportFormat): Promise<Buffer> {
  const chars = exportChars(doc);
  if (chars > EXPORT_MAX_CHARS[format]) throw new ExportTooLargeError(format, chars);
  return format === "docx" ? buildReportDocx(doc) : buildReportPdf(doc);
}

export { buildReportDocx } from "./docx";
export { exportFileName } from "./filename";
export { STATUS_LABELS, formatExportDate } from "./labels";
export { EXPORT_LIMITS } from "./markdown";
export { buildReportPdf } from "./pdf";
export {
  EXPORT_FORMATS,
  EXPORT_MIME_TYPES,
  type ExportDocument,
  type ExportFormat,
  type ExportSection,
} from "./types";
