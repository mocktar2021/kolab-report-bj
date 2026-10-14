import { useFormatter, useTranslations } from "next-intl";
import { Download, Lock } from "lucide-react";
import { formatFileSize } from "@/lib/deliverables/format";
import type { ReportExportRow } from "@/lib/reports/exports";

export type RecentExport = ReportExportRow & {
  /** Display name of who made the export, null when unknown. */
  authorName: string | null;
};

const DATE_FORMAT = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} as const;

/** The latest .docx and PDF files of the report, for owners and admins. */
export function RecentExports({ exports }: { exports: readonly RecentExport[] }) {
  const t = useTranslations("ReportExport");
  const format = useFormatter();

  return (
    <section
      aria-labelledby="exports-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id="exports-title" className="font-medium">
          {t("recentTitle")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("recentDescription")}</p>
      </div>
      {exports.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("recentEmpty")}</p>
      ) : (
        <ul className="divide-y">
          {exports.map((file) => (
            <li
              key={file.id}
              className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              {/* A plain link: the route redirects to a signed download link. */}
              <a
                href={file.url}
                className="inline-flex min-w-0 items-center gap-2 self-start rounded-sm text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
              >
                <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="break-all">
                  {t.rich("download", {
                    fileName: file.fileName,
                    hidden: (chunks) => <span className="sr-only">{chunks}</span>,
                  })}
                </span>
              </a>
              <p className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                {file.kind === "final" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                    <Lock className="size-3" aria-hidden="true" />
                    {t("finalLabel")}
                  </span>
                ) : null}
                <span>{t(`formats.${file.format}`)}</span>
                <span>{formatFileSize(file.sizeBytes, format)}</span>
                <time dateTime={file.createdAt}>
                  {format.dateTime(new Date(file.createdAt), DATE_FORMAT)}
                </time>
                {file.authorName ? <span>{t("by", { name: file.authorName })}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
