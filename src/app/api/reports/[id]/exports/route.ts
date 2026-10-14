import { NextResponse } from "next/server";
import { z } from "zod";
import { buildExport, exportFileName } from "@/lib/export";
import { EXPORT_FORMATS, EXPORT_MIME_TYPES, type ExportDocument } from "@/lib/export/types";
import {
  EXPORTS_BUCKET,
  EXPORTS_PER_HOUR,
  exportDownloadPath,
  NO_STORE,
  type ExportErrorKey,
} from "@/lib/reports/exports";
import { sectionStatusSchema } from "@/lib/sections";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspaces/members";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

// "Exporter en .docx" and "Exporter en PDF" (Story KRB-18): builds the file
// from the report as the user reads it (RLS), stores it in the private
// "exports" bucket, records it, and answers with the download link.

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

  const admin = createAdminClient();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("report_exports")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", report.workspace_id)
    .eq("created_by", access.userId)
    .gte("created_at", since);
  if ((count ?? 0) >= EXPORTS_PER_HOUR) return failure(429, "rateLimited");

  const [{ data: sections }, { data: workspace }, members] = await Promise.all([
    supabase
      .from("report_sections")
      .select("title, status, assigned_to, content")
      .eq("report_id", report.id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.from("workspaces").select("name").eq("id", report.workspace_id).maybeSingle(),
    getWorkspaceMembers(report.workspace_id),
  ]);
  if (!sections || !workspace || !members) return failure(500, "generic");
  const names = new Map(members.map((member) => [member.userId, member.name]));

  const generatedAt = new Date();
  const doc: ExportDocument = {
    title: report.title,
    workspaceName: workspace.name,
    generatedAt,
    sections: sections.map((section) => ({
      title: section.title,
      status: sectionStatusSchema.catch("not_started").parse(section.status),
      assigneeName: section.assigned_to ? (names.get(section.assigned_to) ?? null) : null,
      markdown: section.content,
    })),
  };

  let file: Buffer;
  try {
    file = await buildExport(doc, format);
  } catch (error) {
    console.error("exports: could not build the file", error instanceof Error ? error.message : error);
    return failure(500, "generic");
  }

  const exportId = crypto.randomUUID();
  const fileName = exportFileName(report.title, generatedAt, format);
  const storagePath = `${report.workspace_id}/${report.id}/${exportId}.${format}`;
  const { error: uploadError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .upload(storagePath, file, { contentType: EXPORT_MIME_TYPES[format], upsert: false });
  if (uploadError) {
    console.error("exports: could not store the file", uploadError.message);
    return failure(500, "generic");
  }

  const { error: insertError } = await admin.from("report_exports").insert({
    id: exportId,
    workspace_id: report.workspace_id,
    report_id: report.id,
    format,
    file_name: fileName,
    storage_path: storagePath,
    size_bytes: file.length,
    section_count: doc.sections.length,
    created_by: access.userId,
  });
  if (insertError) {
    console.error("exports: could not record the export", insertError.message);
    await admin.storage.from(EXPORTS_BUCKET).remove([storagePath]);
    return failure(500, "generic");
  }

  return NextResponse.json(
    { id: exportId, fileName, url: exportDownloadPath(exportId) },
    { status: 201, headers: NO_STORE },
  );
}
