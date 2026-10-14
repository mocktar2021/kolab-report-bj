import "server-only";
import type { ExportFormat } from "@/lib/export/types";
import { createClient } from "@/lib/supabase/server";

// Exports of a master report (Story KRB-18). The files live in the private
// "exports" bucket under {workspace_id}/{report_id}/{export_id}.{format};
// report_exports keeps who exported what and when.

export const EXPORTS_BUCKET = "exports";

/** Exports one person can make per workspace and hour. */
export const EXPORTS_PER_HOUR = 20;

export const NO_STORE = { "Cache-Control": "private, no-store" };

export type ExportErrorKey =
  | "notFound"
  | "forbidden"
  | "invalidInput"
  | "rateLimited"
  | "busy"
  | "tooLarge"
  | "generic";

export type ReportExportRow = {
  id: string;
  format: ExportFormat;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  createdBy: string | null;
  /** Downloads through /api/exports/{id}, which checks access again. */
  url: string;
};

export function exportDownloadPath(exportId: string): string {
  return `/api/exports/${exportId}`;
}

/** The latest finished exports of a report, for owners and admins (RLS). */
export async function listReportExports(reportId: string, limit = 10): Promise<ReportExportRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("report_exports")
    .select("id, format, file_name, size_bytes, created_at, created_by")
    .eq("report_id", reportId.toLowerCase())
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  return (data ?? []).map((row) => ({
    id: row.id,
    format: row.format === "pdf" ? "pdf" : "docx",
    fileName: row.file_name,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    createdBy: row.created_by,
    url: exportDownloadPath(row.id),
  }));
}
