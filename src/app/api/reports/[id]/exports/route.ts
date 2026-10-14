import { NextResponse } from "next/server";
import { z } from "zod";
import { buildExport, exportFileName, ExportTooLargeError } from "@/lib/export";
import { EXPORT_FORMATS } from "@/lib/export/types";
import { loadExportDocument, markExportFailed, storeExportFile } from "@/lib/reports/export-file";
import { EXPORTS_PER_HOUR, exportDownloadPath, NO_STORE, type ExportErrorKey } from "@/lib/reports/exports";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

// "Exporter en .docx" and "Exporter en PDF" (Story KRB-18): reserves an export
// (one at a time per person, 20 an hour, failures included), builds the file
// from the report as the user reads it (RLS), stores it in the private
// "exports" bucket, and answers with the download link.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = Promise<{ id: string }>;

const bodySchema = z.object({ format: z.enum(EXPORT_FORMATS) });

function failure(status: number, error: ExportErrorKey) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function POST(request: Request, { params }: { params: Params }) {
  // A JSON content type keeps other sites from posting here with a plain form.
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return failure(415, "invalidInput");
  }
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return failure(404, "notFound");
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return failure(400, "invalidInput");
  const format = body.data.format;
  const reportId = id.toLowerCase();

  // RLS hides reports of other workspaces.
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("reports")
    .select("id, title, workspace_id")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return failure(404, "notFound");
  const access = await requireWorkspaceRole(report.workspace_id, MANAGER_ROLES);
  if (!access) return failure(403, "forbidden");

  // The slot is taken before any work, so parallel requests can't all pass.
  const admin = createAdminClient();
  const generatedAt = new Date();
  const fileName = exportFileName(report.title, generatedAt, format);
  const { data: claim, error: claimError } = await admin
    .rpc("claim_report_export", {
      p_report_id: report.id,
      p_user_id: access.userId,
      p_format: format,
      p_file_name: fileName,
      p_hourly_limit: EXPORTS_PER_HOUR,
    })
    .maybeSingle();
  if (claimError || !claim) {
    console.error("exports: could not reserve an export", claimError?.message);
    return failure(500, "generic");
  }
  if (claim.refusal === "busy") return failure(409, "busy");
  if (claim.refusal === "rateLimited") return failure(429, "rateLimited");
  if (!claim.export_id) return failure(404, "notFound");
  const exportId = claim.export_id;

  // Every way out from here marks the attempt, so it counts and never stays pending.
  const fail = async (status: number, error: ExportErrorKey) => {
    await markExportFailed(admin, exportId, report.workspace_id);
    return failure(status, error);
  };

  const doc = await loadExportDocument(supabase, report, generatedAt);
  if (!doc) return fail(500, "generic");

  let file: Buffer;
  try {
    file = await buildExport(doc, format);
  } catch (error) {
    // A report past the format's size cap: the PDF one is lower, .docx may still work.
    if (error instanceof ExportTooLargeError) return fail(413, "tooLarge");
    console.error("exports: could not build the file", error instanceof Error ? error.message : error);
    return fail(500, "generic");
  }

  const stored = await storeExportFile(admin, {
    exportId,
    report,
    format,
    file,
    sectionCount: doc.sections.length,
  });
  if (!stored) return fail(500, "generic");

  return NextResponse.json(
    { id: exportId, fileName, url: exportDownloadPath(exportId) },
    { status: 201, headers: NO_STORE },
  );
}
