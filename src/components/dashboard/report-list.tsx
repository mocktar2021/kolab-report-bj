import { useFormatter, useTranslations } from "next-intl";
import { ChevronRight, FileText } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { WorkspaceReport } from "@/lib/dashboard";

/** Reports of the current workspace with their completion. */
export function ReportList({ reports }: { reports: WorkspaceReport[] }) {
  const t = useTranslations("Dashboard.reports");
  const format = useFormatter();

  return (
    <section
      aria-labelledby="reports-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 id="reports-title" className="font-medium">
          {t("title")}
        </h2>
        <span className="text-sm text-muted-foreground">{t("count", { count: reports.length })}</span>
      </div>
      {reports.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {reports.map((report) => (
            <li key={report.id}>
              <Link
                href={`/rapports/${report.id}`}
                className="group flex items-center gap-4 px-5 py-4 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{report.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("sections", { count: report.totalSections })}
                  </span>
                </span>
                <span className="hidden w-32 sm:block" aria-hidden="true">
                  <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-highlight"
                      style={{ width: `${Math.min(100, Math.max(0, report.completionPercent))}%` }}
                    />
                  </span>
                </span>
                <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">
                  {format.number(report.completionPercent / 100, { style: "percent" })}
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
