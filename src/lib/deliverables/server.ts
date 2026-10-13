import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import type { DeliverableErrorKey } from "./errors";
import { fileTypeFor } from "./file-types";
import { matchesSignature, SNIFF_BYTES, svgHasActiveContent } from "./sniff";

export const DELIVERABLES_BUCKET = "deliverables";

/** Signed upload URLs last 2 hours, so a day-old unfinished upload is abandoned. */
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

type UserClient = Awaited<ReturnType<typeof createClient>>;

export const NO_STORE = { "Cache-Control": "private, no-store" };

export function errorResponse(status: number, error: DeliverableErrorKey) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/** The deliverables columns the upload checks need. */
export type PendingUpload = {
  id: string;
  workspace_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
};

/**
 * Deletes the caller's unfinished uploads in a section that are more than a
 * day old. RLS lets uploaders delete their rows. Users never delete stored
 * objects, so the service role removes the ones those rows pointed at.
 */
export async function removeStaleUploads(supabase: UserClient, userId: string, sectionId: string) {
  const cutoff = new Date(Date.now() - STALE_UPLOAD_MS).toISOString();
  const { data, error } = await supabase
    .from("deliverables")
    .delete()
    .eq("uploaded_by", userId)
    .eq("section_id", sectionId)
    .is("uploaded_at", null)
    .lt("created_at", cutoff)
    .select("storage_path");
  if (error) {
    console.error("deliverables: stale upload cleanup failed", error.message);
    return;
  }
  if (data.length > 0) {
    await removeObjects(data.map((row) => row.storage_path));
  }
}

/** Service role: only for paths of rows the caller was allowed to delete. */
async function removeObjects(paths: string[]) {
  const { error } = await createAdminClient().storage.from(DELIVERABLES_BUCKET).remove(paths);
  if (error) console.error("deliverables: could not remove stored files", error.message);
}

/** Reads up to `limit` bytes of the body, then stops the download. */
async function readUpTo(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(length, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.length;
    if (offset >= bytes.length) break;
  }
  return bytes;
}

/** Total size of the object from a ranged answer, or from a full one. */
function objectSize(response: Response): number | null {
  const range = response.headers.get("content-range")?.match(/\/(\d+)$/);
  if (range?.[1]) return Number(range[1]);
  if (response.status === 200) {
    const length = response.headers.get("content-length");
    return length ? Number(length) : null;
  }
  return null;
}

export type UploadCheck = { ok: true } | { ok: false; error: DeliverableErrorKey };

/**
 * Checks the stored object against what was registered: same size, same
 * type, and first bytes that match the extension. SVG files are read whole
 * and refused when they contain scripts. Nobody can read an unchecked file,
 * so the service role signs the URL, for the path of a row the caller owns.
 */
export async function checkStoredFile(upload: PendingUpload): Promise<UploadCheck> {
  const type = fileTypeFor(upload.file_name);
  if (!type || type.mime !== upload.mime_type) return { ok: false, error: "typeMismatch" };

  const { data: signed, error } = await createAdminClient()
    .storage.from(DELIVERABLES_BUCKET)
    .createSignedUrl(upload.storage_path, 60);
  if (error || !signed) return { ok: false, error: "notReceived" };

  const limit = type.signature === "svg" ? type.maxBytes : SNIFF_BYTES;
  const response = await fetch(signed.signedUrl, {
    headers: { Range: `bytes=0-${limit - 1}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response || (response.status !== 200 && response.status !== 206)) {
    await response?.body?.cancel().catch(() => undefined);
    return { ok: false, error: "notReceived" };
  }

  // The row's size is whatever the caller registered, so the limit is checked
  // on the stored object: an SVG over 5 MB would not be read whole.
  const size = objectSize(response);
  if (size === null || size !== upload.size_bytes || size > type.maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    if (size !== null && size > type.maxBytes) {
      return { ok: false, error: type.signature === "svg" ? "svgTooLarge" : "fileTooLarge" };
    }
    return { ok: false, error: "sizeMismatch" };
  }
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== upload.mime_type) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, error: "typeMismatch" };
  }

  const head = await readUpTo(response, limit);
  if (!matchesSignature(type.signature, head)) return { ok: false, error: "contentMismatch" };
  if (type.signature === "svg" && svgHasActiveContent(head)) return { ok: false, error: "activeContent" };
  return { ok: true };
}

/**
 * Removes a file that failed the checks: the row first, so the path is no
 * longer registered, then the object. Service role, scoped by workspace.
 */
export async function discardUpload(upload: PendingUpload) {
  await createAdminClient()
    .from("deliverables")
    .delete()
    .eq("id", upload.id)
    .eq("workspace_id", upload.workspace_id)
    .is("uploaded_at", null);
  await removeObjects([upload.storage_path]);
}

/** Marks a checked file as uploaded. Only the service role may set uploaded_at. */
export async function markUploaded(upload: PendingUpload): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("deliverables")
    .update({ uploaded_at: new Date().toISOString() })
    .eq("id", upload.id)
    .eq("workspace_id", upload.workspace_id)
    .eq("storage_path", upload.storage_path)
    .is("uploaded_at", null)
    .select("id")
    .maybeSingle();
  if (error) console.error("deliverables: could not mark a file as uploaded", error.message);
  return Boolean(data);
}
