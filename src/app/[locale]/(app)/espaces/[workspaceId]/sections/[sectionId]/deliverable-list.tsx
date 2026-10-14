"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  Download,
  Eye,
  EyeOff,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  type LucideIcon,
  Presentation,
  RotateCw,
  Trash2,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FILE_TYPES, type FileKind } from "@/lib/deliverables/file-types";
import { formatFileSize } from "@/lib/deliverables/format";
import type { ParseErrorKey } from "@/lib/deliverables/parse/types";
import { deleteDeliverable, retryParse, type DeliverableActionResult } from "./actions";
import { ParseBadge, type ParseState } from "./parse-badge";

// react-markdown only loads when someone opens a preview.
const DeliverablePreview = dynamic(
  () => import("./deliverable-preview").then((module) => module.DeliverablePreview),
  {
    ssr: false,
  },
);

export type DeliverableRow = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  uploaderName: string | null;
  parseState: ParseState;
  parseError: string | null;
  /** Still pending long after upload: no read ever started. */
  notStarted: boolean;
  canDelete: boolean;
  canRetry: boolean;
};

const KIND_ICONS: Record<FileKind, LucideIcon> = {
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  pdf: FileType2,
  text: FileText,
  image: FileImage,
  diagram: Workflow,
};

function kindOf(mimeType: string): FileKind | null {
  return Object.values(FILE_TYPES).find((spec) => spec.mime === mimeType)?.kind ?? null;
}

const PARSE_ERRORS: readonly ParseErrorKey[] = ["corrupt", "tooLarge", "timeout", "unreadable"];

/** States a file leaves once its read ends. */
const READING: readonly ParseState[] = ["pending", "processing"];

function parseErrorKey(value: string | null): ParseErrorKey {
  return PARSE_ERRORS.find((key) => key === value) ?? "unreadable";
}

/** Files of a section that passed the upload checks, newest first. */
export function DeliverableList({ files, canEdit }: { files: DeliverableRow[]; canEdit: boolean }) {
  const t = useTranslations("Deliverables");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [notice, setNotice] = useState("");
  const parseStates = useRef(new Map(files.map((file) => [file.id, file.parseState])));

  // The badges move on when ParseWatcher refreshes the page. Screen readers
  // hear when a file's read ends, since it decides whether a draft can start.
  useEffect(() => {
    const ended = files.filter((file) => {
      const before = parseStates.current.get(file.id);
      return before !== undefined && READING.includes(before) && !READING.includes(file.parseState);
    });
    parseStates.current = new Map(files.map((file) => [file.id, file.parseState]));
    if (ended.length > 0)
      setNotice(
        ended.map((file) => t("parseAnnounce", { name: file.name, status: file.parseState })).join(" "),
      );
  }, [files, t]);

  // The deleted file's row and its buttons go away: the focus lands on the
  // list title and screen readers hear which file went.
  function onDeleted(name: string) {
    setNotice(t("deleted", { name }));
    titleRef.current?.focus();
  }

  return (
    <section
      aria-labelledby="deliverables-title"
      className="surface-card mt-4 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2
          id="deliverables-title"
          ref={titleRef}
          tabIndex={-1}
          className="rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("listTitle")}
        </h2>
        <span className="text-sm text-muted-foreground">{t("count", { count: files.length })}</span>
      </div>
      <p role="status" className="sr-only">
        {notice}
      </p>
      {files.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          {canEdit ? t("emptyEditor") : t("empty")}
        </p>
      ) : (
        <ul className="divide-y">
          {files.map((file) => (
            <DeliverableItem key={file.id} file={file} onDeleted={onDeleted} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DeliverableItem({ file, onDeleted }: { file: DeliverableRow; onDeleted: (name: string) => void }) {
  const t = useTranslations("Deliverables");
  const format = useFormatter();
  const router = useRouter();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<DeliverableActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  // Set once the file is gone. The dialog then sends the focus to the list
  // instead of its delete button, which goes away with the row.
  const deleted = useRef(false);

  const kind = kindOf(file.mimeType);
  const Icon = kind ? KIND_ICONS[kind] : FileText;
  const canPreview = file.parseState === "parsed" || kind === "image";
  const previewId = `preview-${file.id}`;

  function run(action: () => Promise<DeliverableActionResult>, onSuccess?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          onSuccess?.();
          router.refresh();
        } else setError(result);
      } catch {
        // The action did not answer, for example after a network error.
        setError({ ok: false, error: "generic" });
      } finally {
        setConfirming(false);
      }
    });
  }

  const parseMessage =
    file.parseState === "failed"
      ? t(`parseErrors.${parseErrorKey(file.parseError)}`)
      : file.parseState === "stale"
        ? t("parseErrors.stale")
        : file.parseState === "skipped"
          ? t("skippedHint")
          : file.notStarted
            ? t("pendingHint")
            : null;
  // Red when a read went wrong, muted when the file was not read.
  const parseMessageMuted = file.parseState === "skipped" || file.notStarted;

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium" title={file.name}>
                {file.name}
              </span>
              <ParseBadge state={file.parseState} />
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {t("meta", {
                size: formatFileSize(file.size, format),
                uploader: file.uploaderName ?? t("unknownMember"),
                date: format.dateTime(new Date(file.uploadedAt), {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1 pl-12 sm:pl-0">
          {canPreview ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={previewOpen}
              aria-controls={previewId}
              aria-label={
                previewOpen
                  ? t("hidePreviewLabel", { name: file.name })
                  : t("previewLabel", { name: file.name })
              }
              onClick={() => setPreviewOpen((open) => !open)}
            >
              {previewOpen ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              <span className="hidden sm:inline">{previewOpen ? t("hidePreview") : t("preview")}</span>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="ghost">
            {/* A plain link: the route answers with a redirect to a signed URL. */}
            <a
              href={`/api/deliverables/${file.id}/file`}
              aria-label={t("downloadLabel", { name: file.name })}
            >
              <Download aria-hidden="true" />
              <span className="hidden sm:inline">{t("download")}</span>
            </a>
          </Button>
          {file.canDelete ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={t("deleteLabel", { name: file.name })}
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
              <Dialog
                open={confirming}
                onOpenChange={(open) => {
                  // The dialog stays open while the deletion runs.
                  if (!pending) setConfirming(open);
                }}
              >
                <DialogContent
                  className="p-6"
                  onCloseAutoFocus={(event) => {
                    // Focusing the list while the dialog is open would be pulled back into it.
                    if (!deleted.current) return;
                    event.preventDefault();
                    onDeleted(file.name);
                  }}
                >
                  <DialogTitle className="break-words">{t("deleteTitle", { name: file.name })}</DialogTitle>
                  <DialogDescription className="mt-2">{t("deleteDescription")}</DialogDescription>
                  <div className="mt-6 flex justify-end gap-2">
                    <DialogClose asChild>
                      <Button type="button" variant="ghost" disabled={pending}>
                        {t("cancel")}
                      </Button>
                    </DialogClose>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => deleteDeliverable(file.id),
                          () => {
                            deleted.current = true;
                          },
                        )
                      }
                    >
                      {t("delete")}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          ) : null}
        </div>
      </div>

      {parseMessage || file.canRetry || error ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-12 text-xs">
          {parseMessage ? (
            <p className={parseMessageMuted ? "text-muted-foreground" : "text-destructive"}>{parseMessage}</p>
          ) : null}
          {file.canRetry ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              disabled={pending}
              aria-label={t("retryLabel", { name: file.name })}
              onClick={() => run(() => retryParse(file.id))}
            >
              <RotateCw aria-hidden="true" />
              {t("retry")}
            </Button>
          ) : null}
          {error && !error.ok ? (
            <p role="alert" className="text-destructive">
              {t(`actionErrors.${error.error}`)}
            </p>
          ) : null}
        </div>
      ) : null}

      {previewOpen ? (
        <div id={previewId} className="mt-3 sm:pl-12">
          <DeliverablePreview id={file.id} name={file.name} isImage={kind === "image"} />
        </div>
      ) : null}
    </li>
  );
}
