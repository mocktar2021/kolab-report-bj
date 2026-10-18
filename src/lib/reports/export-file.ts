import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXPORT_MIME_TYPES, type ExportDocument, type ExportFormat } from "@/lib/export/types";
import { log } from "@/lib/log";
import { outline } from "@/lib/section-outline";
import { sectionStatusSchema } from "@/lib/sections";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspaceMembers } from "@/lib/workspaces/members";
import { loadExportImages } from "./export-images";
import { EXPORTS_BUCKET } from "./exports";

// What the export buttons (KRB-18) and the snapshot of a final report
// (KRB-20) share: reading the report into a document, storing the file.

type Client = SupabaseClient<Database>;

export type ExportedReport = { id: string; title: string; workspace_id: string };

/** Rows PostgREST returns at most per request (max_rows in supabase/config.toml). */
const DELIVERABLES_PAGE = 1000;

type DeliverableRow = {
  section_id: string;
  file_name: string;
  uploaded_by: string | null;
  uploaded_at: string;
};

/**
 * The uploaded files of every section of the report, for the annexes
 * (KRB-215), oldest first, read page by page. `supabase` is the user's
 * client: RLS applies. Null when a read fails.
 */
async function loadReportDeliverables(supabase: Client, reportId: string): Promise<DeliverableRow[] | null> {
  const rows: DeliverableRow[] = [];
  for (let from = 0; ; from += DELIVERABLES_PAGE) {
    const { data, error } = await supabase
      .from("deliverables")
      .select("section_id, file_name, uploaded_by, uploaded_at, report_sections!inner(report_id)")
      .eq("report_sections.report_id", reportId)
      .not("uploaded_at", "is", null)
      .order("uploaded_at")
      .order("id")
      .range(from, from + DELIVERABLES_PAGE - 1);
    if (error || !data) return null;
    for (const { section_id, file_name, uploaded_by, uploaded_at } of data) {
      if (uploaded_at) rows.push({ section_id, file_name, uploaded_by, uploaded_at });
    }
    if (data.length < DELIVERABLES_PAGE) return rows;
  }
}

/**
 * The report as `supabase` reads it (RLS applies), or null when a read fails.
 * With `withAnnexes`, each section also lists its uploaded files (KRB-215).
 * The images its sections show (KRB-216) are read with the same rights.
 */
export async function loadExportDocument(
  supabase: Client,
  report: ExportedReport,
  generatedAt: Date,
  { withAnnexes }: { withAnnexes: boolean },
): Promise<ExportDocument | null> {
  const [{ data: sections }, { data: workspace }, members, deliverables] = await Promise.all([
    supabase
      .from("report_sections")
      .select("id, parent_id, position, created_at, title, status, assigned_to, content")
      .eq("report_id", report.id),
    supabase.from("workspaces").select("name").eq("id", report.workspace_id).maybeSingle(),
    getWorkspaceMembers(report.workspace_id),
    withAnnexes ? loadReportDeliverables(supabase, report.id) : [],
  ]);
  if (!sections || !workspace || !members || !deliverables) return null;
  const names = new Map(members.map((member) => [member.userId, member.name]));
  // Each section followed by its subsections (KRB-195).
  const ordered = outline(
    sections.map((section) => ({ ...section, parentId: section.parent_id, createdAt: section.created_at })),
  );
  const images = await loadExportImages(
    supabase,
    report,
    ordered.map((section) => ({ id: section.id, markdown: section.content })),
  );
  const filesBySection = new Map<string, DeliverableRow[]>();
  for (const file of deliverables) {
    const files = filesBySection.get(file.section_id);
    if (files) files.push(file);
    else filesBySection.set(file.section_id, [file]);
  }

  return {
    title: report.title,
    workspaceName: workspace.name,
    generatedAt,
    sections: ordered.map((section) => ({
      title: section.title,
      level: section.level,
      status: sectionStatusSchema.catch("not_started").parse(section.status),
      assigneeName: section.assigned_to ? (names.get(section.assigned_to) ?? null) : null,
      markdown: section.content,
      deliverables: (filesBySection.get(section.id) ?? []).map((file) => ({
        fileName: file.file_name,
        // Null when the uploader left the workspace or deleted their account, like on the section page.
        addedBy: file.uploaded_by ? (names.get(file.uploaded_by) ?? null) : null,
        addedAt: new Date(file.uploaded_at),
      })),
    })),
    images,
    withAnnexes,
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
