import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkFileBeforeUpload, fileTypeFor, storageFileName } from "@/lib/deliverables/file-types";
import { DELIVERABLES_BUCKET, errorResponse, NO_STORE, removeStaleUploads } from "@/lib/deliverables/server";
import type { UploadUrlResponse } from "@/lib/deliverables/upload";
import { log, withRequestId } from "@/lib/log";
import { canEditSection } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

const bodySchema = z.object({
  sectionId: uuidSchema,
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative(),
});

/**
 * Registers a file for a section and returns a signed URL to upload it
 * straight to storage. The file itself never goes through this server.
 */
export const POST = withRequestId(async (request: Request) => {
  // A JSON content type keeps other sites from posting here with a plain form.
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return errorResponse(415, "invalidInput");
  }
  const user = await getCurrentUser();
  if (!user) return errorResponse(401, "unauthenticated");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "invalidInput");
  const { sectionId, fileName, size } = parsed.data;

  const rejection = checkFileBeforeUpload(fileName, size);
  const type = fileTypeFor(fileName);
  if (rejection || !type) {
    const status = rejection === "fileType" ? 415 : rejection === "fileEmpty" ? 400 : 413;
    return errorResponse(status, rejection ?? "fileType");
  }

  // RLS hides sections of other workspaces, so they look like missing ones.
  const supabase = await createClient();
  const { data: section } = await supabase
    .from("report_sections")
    .select("id, workspace_id, assigned_to, report:reports(status)")
    .eq("id", sectionId)
    .maybeSingle();
  if (!section) return errorResponse(404, "sectionNotFound");

  const access = await requireWorkspaceRole(section.workspace_id);
  if (!access || !canEditSection(access, section.assigned_to)) return errorResponse(403, "forbidden");
  // A final report takes no new file (KRB-20). RLS refuses the row anyway.
  if (section.report?.status === "final") return errorResponse(403, "reportFinal");

  await removeStaleUploads(supabase, user.id, section.id);

  const storagePath = `${section.workspace_id}/${section.id}/${randomUUID()}-${storageFileName(fileName)}`;
  const { data: row, error: insertError } = await supabase
    .from("deliverables")
    .insert({
      workspace_id: section.workspace_id,
      section_id: section.id,
      uploaded_by: user.id,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: type.mime,
      size_bytes: size,
    })
    .select("id")
    .single();
  if (insertError || !row) {
    if (insertError?.code === "42501") return errorResponse(403, "forbidden");
    log.error("deliverables: could not register an upload", { error: insertError?.message });
    return errorResponse(500, "generic");
  }

  // Storage only accepts this path because the row above is pending and ours.
  const { data: signed, error: signError } = await supabase.storage
    .from(DELIVERABLES_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signError || !signed) {
    log.error("deliverables: could not sign an upload URL", { error: signError?.message });
    await supabase.from("deliverables").delete().eq("id", row.id);
    return errorResponse(500, "generic");
  }

  const body: UploadUrlResponse = {
    deliverableId: row.id,
    uploadUrl: signed.signedUrl,
    contentType: type.mime,
  };
  return NextResponse.json(body, { status: 201, headers: NO_STORE });
});
