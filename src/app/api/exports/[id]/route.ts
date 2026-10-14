import { NextResponse } from "next/server";
import { EXPORTS_BUCKET, NO_STORE } from "@/lib/reports/exports";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { uuidSchema } from "@/lib/workspaces/schemas";

type Params = Promise<{ id: string }>;

/** Signed links only live long enough to follow the redirect. */
const SIGNED_URL_SECONDS = 60;

function notFound() {
  return NextResponse.json({ error: "notFound" }, { status: 404, headers: NO_STORE });
}

/** Redirects owners and admins to a short-lived signed link of an export. */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return notFound();
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  }

  // RLS: only managers of the workspace read its exports.
  const supabase = await createClient();
  const { data: file } = await supabase
    .from("report_exports")
    .select("workspace_id, storage_path, file_name")
    .eq("id", id.toLowerCase())
    .eq("status", "ready")
    .maybeSingle();
  if (!file?.storage_path || !file.storage_path.startsWith(`${file.workspace_id}/`)) return notFound();

  // The bucket has no policies: the service role signs the link, for this
  // row's path only, which RLS just let the user read.
  const { data: signed, error } = await createAdminClient()
    .storage.from(EXPORTS_BUCKET)
    .createSignedUrl(file.storage_path, SIGNED_URL_SECONDS, { download: file.file_name });
  if (error || !signed) return notFound();

  return NextResponse.redirect(signed.signedUrl, { status: 303, headers: NO_STORE });
}
