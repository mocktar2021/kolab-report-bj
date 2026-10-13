import { NextResponse } from "next/server";
import {
  checkStoredFile,
  discardUpload,
  errorResponse,
  markUploaded,
  NO_STORE,
} from "@/lib/deliverables/server";
import { canEditSection } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

type Params = Promise<{ id: string }>;

/**
 * Called by the browser once the upload is done. Checks the stored file and
 * keeps it, or deletes it with its row and says why.
 */
export async function POST(_request: Request, { params }: { params: Params }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return errorResponse(404, "notReceived");

  const user = await getCurrentUser();
  if (!user) return errorResponse(401, "unauthenticated");

  const supabase = await createClient();
  const { data: upload } = await supabase
    .from("deliverables")
    .select(
      "id, workspace_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, uploaded_at, section:report_sections(assigned_to)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!upload) return errorResponse(404, "notReceived");
  if (upload.uploaded_by !== user.id) return errorResponse(403, "forbidden");
  if (upload.uploaded_at) return NextResponse.json({ ok: true }, { headers: NO_STORE });

  // The signed URL stays valid for 2 hours. Someone taken off the section
  // in the meantime does not get to keep the file.
  const access = await requireWorkspaceRole(upload.workspace_id);
  if (!access || !canEditSection(access, upload.section?.assigned_to ?? null)) {
    await discardUpload(upload);
    return errorResponse(403, "forbidden");
  }

  const check = await checkStoredFile(upload);
  if (!check.ok) {
    await discardUpload(upload);
    return errorResponse(422, check.error);
  }

  if (!(await markUploaded(upload))) return errorResponse(409, "notReceived");
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
