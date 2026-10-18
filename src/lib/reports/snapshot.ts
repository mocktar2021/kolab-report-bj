import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildExport, exportFileName, ExportTooLargeError } from "@/lib/export";
import type { ExportFormat } from "@/lib/export/types";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { loadExportDocument, markExportFailed, storeExportFile, type ExportedReport } from "./export-file";

// The snapshot of a final report (KRB-20): the PDF of the report as it was
// when it became final, kept in the "exports" bucket with kind "final" and
// the status change it belongs to. A report too large for a PDF gets a .docx.
// It lists the files in annex (KRB-215), like the export buttons by default.

/** A snapshot still pending after this long died with its request (the export route's limit). */
const STALE_SNAPSHOT_MS = 2 * 60 * 1000;

/** ready: stored, now or before. busy: another request is storing it. failed: try again. */
export type SnapshotResult = "ready" | "busy" | "failed";

async function buildSnapshot(
  doc: Parameters<typeof buildExport>[0],
): Promise<{ format: ExportFormat; file: Buffer } | null> {
  for (const format of ["pdf", "docx"] as const) {
    try {
      return { format, file: await buildExport(doc, format) };
    } catch (error) {
      if (error instanceof ExportTooLargeError) continue;
      log.error("snapshot: could not build the file", { format, error });
      return null;
    }
  }
  log.error("snapshot: the report is too large for every format");
  return null;
}

/**
 * Stores the snapshot of `report` for the status change `eventId`, which
 * made it final, unless it is already there. `supabase` is the client of the
 * person who finalized the report: the snapshot holds what they read. Call it
 * only after checking that person manages the workspace and the report is
 * final with that change.
 */
export async function createFinalSnapshot(input: {
  supabase: SupabaseClient<Database>;
  report: ExportedReport;
  eventId: string;
  userId: string;
}): Promise<SnapshotResult> {
  const { supabase, report, eventId, userId } = input;
  const admin = createAdminClient();

  await admin
    .from("report_exports")
    .update({ status: "failed", finished_at: new Date().toISOString() })
    .eq("workspace_id", report.workspace_id)
    .eq("status_event_id", eventId)
    .eq("kind", "final")
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - STALE_SNAPSHOT_MS).toISOString());

  const { data: existing } = await admin
    .from("report_exports")
    .select("status")
    .eq("workspace_id", report.workspace_id)
    .eq("status_event_id", eventId)
    .eq("kind", "final")
    .neq("status", "failed")
    .maybeSingle();
  if (existing) return existing.status === "ready" ? "ready" : "busy";

  const generatedAt = new Date();
  const doc = await loadExportDocument(supabase, report, generatedAt, { withAnnexes: true });
  if (!doc) return "failed";
  const built = await buildSnapshot(doc);
  if (!built) return "failed";

  // The unique index lets one snapshot per change in: a parallel request that
  // got there first wins.
  const { data: row, error } = await admin
    .from("report_exports")
    .insert({
      workspace_id: report.workspace_id,
      report_id: report.id,
      format: built.format,
      file_name: exportFileName(report.title, generatedAt, built.format),
      created_by: userId,
      kind: "final",
      status_event_id: eventId,
      with_annexes: true,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return "busy";
  if (error || !row) {
    log.error("snapshot: could not record the snapshot", { error: error?.message });
    return "failed";
  }

  const stored = await storeExportFile(admin, {
    exportId: row.id,
    report,
    format: built.format,
    file: built.file,
    sectionCount: doc.sections.length,
  });
  if (!stored) {
    await markExportFailed(admin, row.id, report.workspace_id);
    return "failed";
  }
  return "ready";
}
