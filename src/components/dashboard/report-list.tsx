import { useFormatter, useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { initialsOf } from "@/components/app-shell/user-avatar";
import { ReportStatusBadge } from "@/components/report-status-badge";
import { STATUS_DOT_STYLES } from "@/components/status-badge";
import { Link } from "@/i18n/navigation";
import type { AssigneeProgress, WorkspaceReport } from "@/lib/dashboard";
import { SECTION_STATUSES } from "@/lib/sections";
import { cn } from "@/lib/utils";

/** Width of a bar fill, kept between 0 and 100 %. */
export function fillWidth(percent: number) {
  return `${Math.min(100, Math.max(0, percent))}%`;
}

/**
 * Reports of the current workspace as cards, with their completion and the
 * breakdown by expert. `action` sits next to the count, such as the
 * "Nouveau rapport" button for owners and admins.
 */
export function ReportList({ reports, action }: { reports: WorkspaceReport[]; action?: React.ReactNode }) {
  const t = useTranslations("Dashboard.reports");

  return (
    <section aria-labelledby="reports-title" className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="reports-title" className="text-h3 text-foreground">
          {t("title")}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-muted-foreground">
            {t("count", { count: reports.length })}
          </span>
          {action}
        </div>
      </div>
      {reports.length === 0 ? (
        <p className="surface-card mt-4 rounded-2xl border px-5 py-8 text-center text-sm text-muted-foreground shadow-sm">
          {t("empty")}
        </p>
      ) : (
        // Cards keep their own height on wide screens: opening one breakdown
        // does not stretch the card next to it.
        <ul className="mt-4 grid gap-3 sm:gap-4 lg:grid-cols-2 lg:items-start">
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportCard({ report }: { report: WorkspaceReport }) {
  const t = useTranslations("Dashboard.reports");
  const format = useFormatter();
  const percent = format.number(report.completionPercent / 100, { style: "percent" });

  return (
    <li className="surface-card overflow-hidden rounded-2xl border shadow-sm">
      {/* The title link covers this whole block, so a tap anywhere on it opens the report. */}
      <div className="group relative p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="break-words font-medium leading-snug text-foreground">
              <Link
                href={`/rapports/${report.id}`}
                className="underline-offset-4 outline-none after:absolute after:inset-0 after:rounded-2xl group-hover:underline focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
              >
                {report.title}
              </Link>
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <ReportStatusBadge status={report.status} />
              <p className="text-xs tabular-nums text-muted-foreground">
                {t("sections", { count: report.totalSections })}
              </p>
            </div>
          </div>
          <span className="shrink-0 font-display text-[1.75rem] font-normal leading-none tracking-[-0.03em] tabular-nums text-foreground">
            {percent}
          </span>
        </div>

        <div
          role="progressbar"
          aria-label={t("progressLabel", { title: report.title })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={report.completionPercent}
          aria-valuetext={percent}
          className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-highlight transition-[width] duration-700 ease-out-expo motion-reduce:transition-none"
            style={{ width: fillWidth(report.completionPercent) }}
          />
        </div>

        {report.totalSections > 0 ? (
          <ul
            aria-label={t("statusLabel")}
            className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground"
          >
            {SECTION_STATUSES.map((status) => (
              <li key={status} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={cn("size-1.5 rounded-full", STATUS_DOT_STYLES[status])} />
                {t(`status.${status}`, { count: report.counts[status] })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">{t("noSections")}</p>
        )}
      </div>

      {report.assignees.length > 0 ? (
        <AssigneeBreakdown reportTitle={report.title} assignees={report.assignees} />
      ) : null}
    </li>
  );
}

function AssigneeBreakdown({
  reportTitle,
  assignees,
}: {
  reportTitle: string;
  assignees: AssigneeProgress[];
}) {
  const t = useTranslations("Dashboard.reports");

  return (
    <details className="group/details border-t">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-3">
          <span>
            {t.rich("byExpert", {
              title: reportTitle,
              hidden: (chunks) => <span className="sr-only">{chunks}</span>,
            })}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 transition-transform duration-200 group-open/details:rotate-180"
          />
        </span>
      </summary>
      <ul className="divide-y border-t px-4 sm:px-5">
        {assignees.map((assignee) => (
          <AssigneeRow key={assignee.userId ?? "unassigned"} assignee={assignee} />
        ))}
      </ul>
    </details>
  );
}

function AssigneeRow({ assignee }: { assignee: AssigneeProgress }) {
  const t = useTranslations("Dashboard");
  const format = useFormatter();
  const unassigned = assignee.userId === null;
  const name = unassigned ? t("table.unassigned") : (assignee.name ?? t("reports.unknownMember"));

  return (
    <li className="flex items-center gap-3 py-3">
      {unassigned ? (
        <span
          aria-hidden="true"
          className="size-7 shrink-0 rounded-full border border-dashed border-foreground/25"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground ring-1 ring-inset ring-border"
        >
          {assignee.name ? initialsOf(assignee.name) : null}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className={cn("truncate text-sm", unassigned ? "text-muted-foreground" : "text-foreground")}>
            {name}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {format.number(assignee.completionPercent / 100, { style: "percent" })}
          </span>
        </div>
        {/* The percent next to the name says the same thing in text. */}
        <span aria-hidden="true" className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-highlight"
            style={{ width: fillWidth(assignee.completionPercent) }}
          />
        </span>
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          {t("reports.completedOf", { completed: assignee.counts.completed, total: assignee.total })}
        </p>
      </div>
    </li>
  );
}
