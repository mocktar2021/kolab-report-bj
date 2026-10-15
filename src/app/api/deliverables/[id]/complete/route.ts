import { after, NextResponse } from "next/server";
import { workspaceIsWritable } from "@/lib/billing/state";
import { claimParse, runParse } from "@/lib/deliverables/parse-job";
import {
  checkStoredFile,
  discardUpload,
  errorResponse,
  markUploaded,
  NO_STORE,
} from "@/lib/deliverables/server";
import { withRequestId } from "@/lib/log";
import { canEditSection } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

type Params = Promise<{ id: string }>;

// Reading the file runs after the answer, within this budget (Vercel).
export const maxDuration = 60;

/**
 * Called by the browser once the upload is done. Checks the stored file and
 * keeps it, or deletes it with its row and says why.
 */
export const POST = withRequestId(async (_request: Request, { params }: { params: Params }) => {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return errorResponse(404, "notReceived");

  const user = await getCurrentUser();
  if (!user) return errorResponse(401, "unauthenticated");

  const supabase = await createClient();
  const { data: upload } = await supabase
    .from("deliverables")
    .select(
      "id, workspace_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, uploaded_at, section:report_sections(assigned_to, report:reports(status))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!upload) return errorResponse(404, "notReceived");
  if (upload.uploaded_by !== user.id) return errorResponse(403, "forbidden");
  if (upload.uploaded_at) return NextResponse.json({ ok: true }, { headers: NO_STORE });

  // The signed URL stays valid for 2 hours. Someone taken off the section
  // in the meantime does not get to keep the file, and neither does anyone
  // once the report is final (KRB-20).
  const access = await requireWorkspaceRole(upload.workspace_id);
  if (!access || !canEditSection(access, upload.section?.assigned_to ?? null)) {
    await discardUpload(upload);
    return errorResponse(403, "forbidden");
  }
  if (upload.section?.report?.status === "final") {
    await discardUpload(upload);
    return errorResponse(403, "reportFinal");
  }
  // Nor once the workspace is read-only (KRB-178): the file is kept with the
  // service role below, which the database guards do not check.
  if (!(await workspaceIsWritable(upload.workspace_id))) {
    await discardUpload(upload);
    return errorResponse(403, "readOnly");
  }

  const check = await checkStoredFile(upload);
  if (!check.ok) {
    await discardUpload(upload);
    return errorResponse(422, check.error);
  }

  if (!(await markUploaded(upload))) return errorResponse(409, "notReceived");

  // Claimed now so the list shows the file as being read straight away.
  const claim = await claimParse(upload.id, upload.workspace_id);
  if (claim) after(() => runParse(claim));
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
});
