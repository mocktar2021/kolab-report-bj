"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeliverableErrorKey } from "@/lib/deliverables/errors";
import { checkFileBeforeUpload } from "@/lib/deliverables/file-types";
import { captionFromFileName, sectionImageFile } from "@/lib/deliverables/section-images";
import { uploadDeliverable } from "@/lib/deliverables/upload";
import type { SectionImageRef } from "./image-insert";
import type { ImagePlace } from "./rich-text-editor";

// Images pasted or dropped in the section editor (KRB-216). Each one is first
// uploaded as a deliverable of the section, through the same checks as the
// upload form, then goes in the text. Files go one after the other.

export type ImageUpload = {
  key: number;
  name: string;
  phase: "uploading" | "checking" | "failed";
  /** Share sent, from 0 to 1. */
  progress: number;
  /** wrongType: not a PNG or a JPEG, so not sent. */
  error?: DeliverableErrorKey | "wrongType";
};

/** A file to put in the text, and where: null for the cursor of the Markdown tab once it is sent. */
export type PlacedFile = { file: File; place: ImagePlace | null };

export function useImageUploads(
  sectionId: string,
  onUploaded: (image: SectionImageRef, place: ImagePlace | null) => void,
) {
  const router = useRouter();
  const [uploads, setUploads] = useState<ImageUpload[]>([]);
  const nextKey = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(onUploaded);
  useEffect(() => {
    latest.current = onUploaded;
  });

  function update(key: number, patch: Partial<ImageUpload>) {
    setUploads((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function dismiss(key: number) {
    setUploads((list) => list.filter((item) => item.key !== key));
  }

  async function send(key: number, file: File, place: ImagePlace | null) {
    // Never throws, so one failure does not stop the files queued after it.
    const result = await uploadDeliverable(sectionId, file, {
      onProgress: (progress) => update(key, { progress }),
      onChecking: () => update(key, { phase: "checking", progress: 1 }),
    }).catch(() => ({ ok: false as const, error: "generic" as const }));
    if (!result.ok) {
      update(key, { phase: "failed", error: result.error });
      return;
    }
    dismiss(key);
    latest.current({ id: result.deliverableId, caption: captionFromFileName(file.name) }, place);
    // The deliverable list shows the new file.
    router.refresh();
  }

  function add(files: PlacedFile[]) {
    const added: ImageUpload[] = [];
    for (const { file, place } of files) {
      const key = nextKey.current++;
      const image = sectionImageFile(file);
      // Same checks as the server, so a wrong type or a big file never starts.
      const error = image ? checkFileBeforeUpload(image.name, image.size) : "wrongType";
      added.push({
        key,
        name: image?.name ?? file.name,
        phase: error ? "failed" : "uploading",
        progress: 0,
        error: error ?? undefined,
      });
      if (image && !error) queue.current = queue.current.then(() => send(key, image, place));
    }
    setUploads((list) => [...list, ...added]);
  }

  const busy = uploads.some((item) => item.phase !== "failed");
  return { uploads, add, dismiss, busy };
}

/** The images on their way into the text, and the ones refused with why. */
export function ImageUploadList({
  uploads,
  onDismiss,
}: {
  uploads: ImageUpload[];
  onDismiss: (key: number) => void;
}) {
  const t = useTranslations("SectionImages");
  const tErrors = useTranslations("Deliverables.errors");
  const format = useFormatter();
  if (uploads.length === 0) return null;

  return (
    <ul className="space-y-2">
      {uploads.map((item) => {
        const percent = format.number(item.progress, { style: "percent", maximumFractionDigits: 0 });
        if (item.phase === "failed") {
          const reason = item.error === "wrongType" ? t("wrongType") : tErrors(item.error ?? "generic");
          return (
            <li
              key={item.key}
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p role="alert" className="min-w-0 flex-1 break-words">
                {t("failed", { name: item.name, reason })}
              </p>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                aria-label={t("dismiss")}
                onClick={() => onDismiss(item.key)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          );
        }
        return (
          <li key={item.key} className="rounded-lg border px-3 py-2 text-sm">
            <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
              <span className="truncate">
                {item.phase === "checking"
                  ? t("checking", { name: item.name })
                  : t("sending", { name: item.name, percent })}
              </span>
            </p>
            {item.phase === "uploading" ? (
              <div
                role="progressbar"
                aria-label={t("progressLabel", { name: item.name })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(item.progress * 100)}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-highlight transition-[width] duration-200"
                  style={{ width: `${item.progress * 100}%` }}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
