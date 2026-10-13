import { publicEnv } from "@/lib/env";
import type { DeliverableErrorBody, DeliverableErrorKey } from "./errors";

/** Answer of POST /api/deliverables/upload-url. */
export type UploadUrlResponse = {
  deliverableId: string;
  uploadUrl: string;
  contentType: string;
};

export type UploadResult = { ok: true } | { ok: false; error: DeliverableErrorKey };

type UploadCallbacks = {
  /** Share of the file sent, from 0 to 1. */
  onProgress: (sent: number) => void;
  /** The file is in storage and the server is checking it. */
  onChecking: () => void;
};

async function errorFrom(response: Response): Promise<DeliverableErrorKey> {
  const body = (await response.json().catch(() => null)) as Partial<DeliverableErrorBody> | null;
  return body?.error ?? "generic";
}

/**
 * Sends the file straight to storage with the signed URL. XMLHttpRequest
 * rather than fetch, for the progress events. Same headers as supabase-js.
 */
function putFile(
  url: string,
  file: File,
  contentType: string,
  onProgress: (sent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("apikey", publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    request.setRequestHeader("authorization", `Bearer ${publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY}`);
    request.setRequestHeader("content-type", contentType);
    request.setRequestHeader("cache-control", "max-age=3600");
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve({ ok: true });
      else resolve({ ok: false, error: request.status === 413 ? "fileTooLarge" : "uploadFailed" });
    };
    request.onerror = () => resolve({ ok: false, error: "uploadFailed" });
    request.onabort = () => resolve({ ok: false, error: "uploadFailed" });
    request.send(file);
  });
}

/**
 * Uploads one deliverable: registers it, sends it to storage, then asks the
 * server to check it. The check also runs after a failed send, so the server
 * removes what was registered.
 */
export async function uploadDeliverable(
  sectionId: string,
  file: File,
  { onProgress, onChecking }: UploadCallbacks,
): Promise<UploadResult> {
  const start = await fetch("/api/deliverables/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sectionId, fileName: file.name, size: file.size }),
  }).catch(() => null);
  if (!start) return { ok: false, error: "uploadFailed" };
  if (!start.ok) return { ok: false, error: await errorFrom(start) };
  const { deliverableId, uploadUrl, contentType } = (await start.json()) as UploadUrlResponse;

  const sent = await putFile(uploadUrl, file, contentType, onProgress);
  onChecking();
  const done = await fetch(`/api/deliverables/${deliverableId}/complete`, { method: "POST" }).catch(
    () => null,
  );
  if (!sent.ok) return sent;
  if (!done) return { ok: false, error: "uploadFailed" };
  if (!done.ok) return { ok: false, error: await errorFrom(done) };
  return { ok: true };
}
