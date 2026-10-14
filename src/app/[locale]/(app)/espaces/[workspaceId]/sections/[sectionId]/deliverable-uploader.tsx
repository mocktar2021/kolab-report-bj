"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Check, CircleAlert, LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeliverableErrorKey } from "@/lib/deliverables/errors";
import { ACCEPTED_EXTENSIONS, checkFileBeforeUpload } from "@/lib/deliverables/file-types";
import { formatFileSize } from "@/lib/deliverables/format";
import { uploadDeliverable } from "@/lib/deliverables/upload";
import { cn } from "@/lib/utils";

type Phase = "waiting" | "uploading" | "checking" | "done" | "error";

type UploadItem = {
  key: number;
  name: string;
  size: number;
  phase: Phase;
  /** Share sent, from 0 to 1. */
  progress: number;
  error?: DeliverableErrorKey;
};

/** One sentence for screen readers, keyed so the same text can come twice. */
type Announcement = { key: number; text: string };

/** The log keeps the last few sentences: older ones were read already. */
const ANNOUNCEMENTS_KEPT = 5;

/** Drop zone and file picker. Files go one after the other, straight to storage. */
export function DeliverableUploader({ sectionId }: { sectionId: string }) {
  const t = useTranslations("Deliverables");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [items, setItems] = useState<UploadItem[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dragging, setDragging] = useState(false);

  const busy = items.some(
    (item) => item.phase === "waiting" || item.phase === "uploading" || item.phase === "checking",
  );

  // Leaving the page would cut the upload short.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  function update(key: number, patch: Partial<UploadItem>) {
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  // Screen readers hear when a file starts, ends or fails, not every percent of
  // the progress bar. New sentences are added to a log, so two that come
  // together are both read.
  function announce(text: string) {
    const key = nextKey.current++;
    setAnnouncements((list) => [...list, { key, text }].slice(-ANNOUNCEMENTS_KEPT));
  }

  function announceFailure(name: string, error: DeliverableErrorKey) {
    announce(t("announce.failed", { name, reason: t(`errors.${error}`) }));
  }

  async function send(key: number, file: File) {
    update(key, { phase: "uploading" });
    announce(t("announce.sending", { name: file.name }));
    // Never throws, so one failure does not stop the files queued after it.
    const result = await uploadDeliverable(sectionId, file, {
      onProgress: (progress) => update(key, { progress }),
      onChecking: () => update(key, { phase: "checking", progress: 1 }),
    }).catch(() => ({ ok: false as const, error: "generic" as const }));
    if (result.ok) {
      update(key, { phase: "done" });
      announce(t("announce.done", { name: file.name }));
      router.refresh();
    } else {
      update(key, { phase: "error", error: result.error });
      announceFailure(file.name, result.error);
    }
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    const added: UploadItem[] = [];
    for (const file of Array.from(files)) {
      const key = nextKey.current++;
      // Same checks as the server, so a wrong type or a big file never starts.
      const rejection = checkFileBeforeUpload(file.name, file.size);
      added.push({
        key,
        name: file.name,
        size: file.size,
        phase: rejection ? "error" : "waiting",
        progress: 0,
        error: rejection ?? undefined,
      });
      if (rejection) announceFailure(file.name, rejection);
      else queue.current = queue.current.then(() => send(key, file));
    }
    setItems((list) => [...added.reverse(), ...list]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  return (
    <section
      aria-labelledby="upload-title"
      className="surface-card mt-8 rounded-2xl border p-5 shadow-sm sm:p-6"
    >
      <h2 id="upload-title" className="font-medium">
        {t("uploadTitle")}
      </h2>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "mt-4 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
          dragging ? "border-highlight bg-highlight/5" : "border-border",
        )}
      >
        <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{t("dropHint")}</p>
        <Button type="button" variant="outline" shape="pill" onClick={() => inputRef.current?.click()}>
          {t("choose")}
        </Button>
        {/* Hidden from everyone: the button above opens it, so screen readers list one control. */}
        <input
          ref={inputRef}
          id="deliverable-files"
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          className="hidden"
          aria-label={t("choose")}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <p className="max-w-md text-xs text-muted-foreground">{t("formats")}</p>
      </div>

      {items.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <UploadRow key={item.key} item={item} />
          ))}
        </ul>
      ) : null}
      {/* Always in the page, so the first sentence is read too. */}
      <div role="log" className="sr-only">
        {announcements.map((announcement) => (
          <p key={announcement.key}>{announcement.text}</p>
        ))}
      </div>
    </section>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const t = useTranslations("Deliverables");
  const format = useFormatter();
  const percent = format.number(item.progress, { style: "percent", maximumFractionDigits: 0 });

  return (
    <li className="rounded-xl border px-4 py-3">
      <div className="flex items-center gap-3">
        <StatusIcon phase={item.phase} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={item.name}>
            {item.name}
          </p>
          <p className={cn("text-xs", item.phase === "error" ? "text-destructive" : "text-muted-foreground")}>
            {item.phase === "error"
              ? t(`errors.${item.error ?? "generic"}`)
              : `${formatFileSize(item.size, format)} · ${t(`phase.${item.phase}`, { percent })}`}
          </p>
        </div>
      </div>
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
}

function StatusIcon({ phase }: { phase: Phase }) {
  if (phase === "done") return <Check className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />;
  if (phase === "error")
    return <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />;
  return (
    <LoaderCircle
      className={cn(
        "size-4 shrink-0 text-muted-foreground",
        phase !== "waiting" && "motion-safe:animate-spin",
      )}
      aria-hidden="true"
    />
  );
}
