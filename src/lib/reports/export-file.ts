import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXPORT_MIME_TYPES, type ExportDocument, type ExportFormat } from "@/lib/export/types";
import { log } from "@/lib/log";
import { outline } from "@/lib/section-outline";
import { sectionStatusSchema } from "@/lib/sections";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspaceMembers } from "@/lib/workspaces/members";
import { EXPORTS_BUCKET } from "./exports";

// What the export buttons (KRB-18) and the snapshot of a final report
// (KRB-20) share: reading the report into a document, storing the file.

type Client = SupabaseClient<Database>;

export type ExportedReport = { id: string; title: string; workspace_id: string };

/** The report as `supabase` reads it (RLS applies), or null when a read fails. */
export async function loadExportDocument(
  supabase: Client,
  report: ExportedReport,
  generatedAt: Date,
): Promise<ExportDocument | null> {
  const [{ data: sections }, { data: workspace }, members] = await Promise.all([
    supabase
      .from("report_sections")
      .select("id, parent_id, position, created_at, title, status, assigned_to, content")
      .eq("report_id", report.id),
    supabase.from("workspaces").select("name").eq("id", report.workspace_id).maybeSingle(),
    getWorkspaceMembers(report.workspace_id),
  ]);
  if (!sections || !workspace || !members) return null;
  const names = new Map(members.map((member) => [member.userId, member.name]));

  return {
    title: report.title,
    workspaceName: workspace.name,
    generatedAt,
    // Each section followed by its subsections (KRB-195).
    sections: outline(
      sections.map((section) => ({ ...section, parentId: section.parent_id, createdAt: section.created_at })),
    ).map((section) => ({
      title: section.title,
      level: section.level,
      status: sectionStatusSchema.catch("not_started").parse(section.status),
      assigneeName: section.assigned_to ? (names.get(section.assigned_to) ?? null) : null,
      markdown: section.content,
    })),
  };
}

/**
 * Stores the file of export `exportId` in the "exports" bucket and marks the
 * export ready. Returns false, with nothing left in the bucket, when either
 * step fails. `admin` is the service-role client: every write names the
 * workspace.
 */
export async function storeExportFile(
  admin: Client,
  input: {
    exportId: string;
    report: ExportedReport;
    format: ExportFormat;
    file: Buffer;
    sectionCount: number;
  },
): Promise<boolean> {
  const { exportId, report, format, file } = input;
  const storagePath = `${report.workspace_id}/${report.id}/${exportId}.${format}`;
  const { error: uploadError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .upload(storagePath, file, { contentType: EXPORT_MIME_TYPES[format], upsert: false });
  if (uploadError) {
    log.error("exports: could not store the file", { error: uploadError.message });
    return false;
  }

  const { data: recorded, error: readyError } = await admin
    .from("report_exports")
    .update({
      status: "ready",
      storage_path: storagePath,
      size_bytes: file.length,
      section_count: input.sectionCount,
      finished_at: new Date().toISOString(),
    })
    .eq("id", exportId)
    .eq("workspace_id", report.workspace_id)
    .select("id");
  // No row: the report was deleted meanwhile. Its row had no path yet, so
  // nothing queued the file for removal (KRB-166).
  if (readyError || recorded.length === 0) {
    log.error("exports: could not record the export", {
      error: readyError?.message ?? "the export is gone",
    });
    await admin.storage.from(EXPORTS_BUCKET).remove([storagePath]);
    return false;
  }
  return true;
}

/** Marks an export as failed, so it counts and never stays pending. */
export async function markExportFailed(admin: Client, exportId: string, workspaceId: string) {
  await admin
    .from("report_exports")
    .update({ status: "failed", finished_at: new Date().toISOString() })
    .eq("id", exportId)
    .eq("workspace_id", workspaceId);
}
