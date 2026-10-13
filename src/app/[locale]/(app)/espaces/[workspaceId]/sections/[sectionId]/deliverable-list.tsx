import { getFormatter, getTranslations } from "next-intl/server";
import {
  Download,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  type LucideIcon,
  Presentation,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FILE_TYPES, type FileKind } from "@/lib/deliverables/file-types";
import { formatFileSize } from "@/lib/deliverables/format";

export type DeliverableRow = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  uploaderName: string | null;
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

function iconFor(mimeType: string): LucideIcon {
  const type = Object.values(FILE_TYPES).find((spec) => spec.mime === mimeType);
  return type ? KIND_ICONS[type.kind] : FileText;
}

/** Files of a section that passed the upload checks, newest first. */
export async function DeliverableList({ files, canEdit }: { files: DeliverableRow[]; canEdit: boolean }) {
  const t = await getTranslations("Deliverables");
  const format = await getFormatter();

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
          {files.map((file) => {
            const Icon = iconFor(file.mimeType);
            return (
              <li key={file.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={file.name}>
                    {file.name}
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
                <Button asChild size="sm" variant="ghost" className="shrink-0">
                  {/* A plain link: the route answers with a redirect to a signed URL. */}
                  <a
                    href={`/api/deliverables/${file.id}/file`}
                    aria-label={t("downloadLabel", { name: file.name })}
                  >
                    <Download aria-hidden="true" />
                    <span className="hidden sm:inline">{t("download")}</span>
                  </a>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
