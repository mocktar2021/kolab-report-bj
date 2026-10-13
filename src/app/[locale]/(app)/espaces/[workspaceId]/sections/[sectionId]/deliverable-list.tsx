"use client";

import { useState, useTransition } from "react";
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

function parseErrorKey(value: string | null): ParseErrorKey {
  return PARSE_ERRORS.find((key) => key === value) ?? "unreadable";
}

/** Files of a section that passed the upload checks, newest first. */
export function DeliverableList({ files, canEdit }: { files: DeliverableRow[]; canEdit: boolean }) {
  const t = useTranslations("Deliverables");

  return (
    <section
      aria-labelledby="deliverables-title"
      className="surface-card mt-4 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 id="deliverables-title" className="font-medium">
          {t("listTitle")}
        </h2>
        <span className="text-sm text-muted-foreground">{t("count", { count: files.length })}</span>
      </div>
      {files.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          {canEdit ? t("emptyEditor") : t("empty")}
        </p>
      ) : (
        <ul className="divide-y">
          {files.map((file) => (
            <DeliverableItem key={file.id} file={file} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DeliverableItem({ file }: { file: DeliverableRow }) {
  const t = useTranslations("Deliverables");
  const format = useFormatter();
  const router = useRouter();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<DeliverableActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const kind = kindOf(file.mimeType);
  const Icon = kind ? KIND_ICONS[kind] : FileText;
  const canPreview = file.parseState === "parsed" || kind === "image";
  const previewId = `preview-${file.id}`;

  function run(action: () => Promise<DeliverableActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result);
      setConfirming(false);
    });
  }

  const parseMessage =
    file.parseState === "failed"
      ? t(`parseErrors.${parseErrorKey(file.parseError)}`)
      : file.parseState === "stale"
        ? t("parseErrors.stale")
        : file.parseState === "skipped"
          ? t("skippedHint")
          : null;

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
              aria-label={previewOpen ? t("hidePreview") : t("previewLabel", { name: file.name })}
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
            confirming ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={pending}
                  aria-label={t("confirmDeleteLabel", { name: file.name })}
                  onClick={() => run(() => deleteDeliverable(file.id))}
                >
                  {t("confirmDelete")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  {t("cancel")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={t("deleteLabel", { name: file.name })}
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            )
          ) : null}
        </div>
      </div>

      {parseMessage || error ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-12 text-xs">
          {parseMessage ? (
            <p className={file.parseState === "skipped" ? "text-muted-foreground" : "text-destructive"}>
              {parseMessage}
            </p>
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
