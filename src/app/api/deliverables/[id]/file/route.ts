import { NextResponse, type NextRequest } from "next/server";
import { isSectionImageType } from "@/lib/deliverables/section-images";
import { DELIVERABLES_BUCKET, errorResponse, NO_STORE } from "@/lib/deliverables/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { uuidSchema } from "@/lib/workspaces/schemas";

type Params = Promise<{ id: string }>;

/** Signed links only live long enough to follow the redirect. */
const SIGNED_URL_SECONDS = 60;

const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

/**
 * Redirects workspace members to a short-lived signed URL of a deliverable.
 * Files download as attachments. `?apercu` shows an image inline instead,
 * for previews in <img>. `?image` is for the images of a section's text
 * (KRB-216): inline too, and only for a PNG or a JPEG.
 */
export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return errorResponse(404, "notReceived");

  const user = await getCurrentUser();
  if (!user) return errorResponse(401, "unauthenticated");

  // RLS: members of the workspace read its deliverables.
  const supabase = await createClient();
  const { data: file } = await supabase
    .from("deliverables")
    .select("storage_path, file_name, mime_type")
    .eq("id", id)
    .not("uploaded_at", "is", null)
    .maybeSingle();
  if (!file) return errorResponse(404, "notReceived");

  const { searchParams } = request.nextUrl;
  const image = searchParams.has("image");
  if (image && !isSectionImageType(file.mime_type)) return errorResponse(415, "fileType");
  const inline = image || (searchParams.has("apercu") && INLINE_TYPES.has(file.mime_type));
  const { data: signed, error } = await supabase.storage
    .from(DELIVERABLES_BUCKET)
    .createSignedUrl(
      file.storage_path,
      SIGNED_URL_SECONDS,
      inline ? undefined : { download: file.file_name },
    );
  if (error || !signed) return errorResponse(404, "notReceived");

  return NextResponse.redirect(signed.signedUrl, { status: 303, headers: NO_STORE });
}
