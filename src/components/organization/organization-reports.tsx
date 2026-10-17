import { useFormatter, useTranslations } from "next-intl";
import { WorkspaceMark } from "@/components/app-shell/workspace-mark";
import { fillWidth } from "@/components/dashboard/report-list";
import { ReportStatusBadge } from "@/components/report-status-badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type {
  OrganizationReport,
  OrganizationReports,
  OrganizationWorkspaceReports,
} from "@/lib/reports/organization";
import { selectWorkspace } from "@/lib/workspaces/actions";

/**
 * The reports of an organization (KRB-208): one card per workspace of the
 * user in it, each report with its status and completion.
 */
export function OrganizationReportList({ data }: { data: OrganizationReports }) {
  return (
    <div className="mt-8 space-y-6">
      {data.workspaces.map((block) => (
        <WorkspaceReports key={block.workspace.id} block={block} />
      ))}
    </div>
  );
}

function WorkspaceReports({ block }: { block: OrganizationWorkspaceReports }) {
  const t = useTranslations("OrganizationReports");
  const tRoles = useTranslations("Workspaces.roles");
  const { workspace, reports } = block;
  const titleId = `organization-workspace-${workspace.id}`;

  return (
    <section aria-labelledby={titleId} className="surface-card overflow-hidden rounded-2xl border shadow-sm">
      <div className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
        <WorkspaceMark name={workspace.name} />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="break-words font-medium leading-snug text-foreground">
            {workspace.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("workspaceMeta", { role: tRoles(workspace.role), reports: reports.length })}
          </p>
        </div>
        {/* Makes it the current workspace, then opens its dashboard. */}
        <form action={selectWorkspace.bind(null, workspace.id)}>
          <Button type="submit" variant="outline" shape="pill" size="sm">
            {t.rich("openWorkspace", {
              name: workspace.name,
              hidden: (chunks) => <span className="sr-only">{chunks}</span>,
            })}
          </Button>
        </form>
      </div>
      {reports.length === 0 ? (
        <p className="border-t px-4 py-4 text-sm text-muted-foreground sm:px-5">{t("noReports")}</p>
      ) : (
        <ul className="divide-y border-t">
          {reports.map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportRow({ report }: { report: OrganizationReport }) {
  const t = useTranslations("Dashboard.reports");
  const format = useFormatter();
  const percent = format.number(report.completionPercent / 100, { style: "percent" });

  return (
    // The title link covers the whole row, so a tap anywhere on it opens the report.
    <li className="group relative flex items-center gap-4 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <h3 className="break-words text-sm font-medium leading-snug text-foreground">
          <Link
            href={`/rapports/${report.id}`}
            className="underline-offset-4 outline-none after:absolute after:inset-0 group-hover:underline focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
          >
            {report.title}
          </Link>
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <ReportStatusBadge status={report.status} />
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("sections", { count: report.totalSections })}
          </span>
        </div>
      </div>
      <div className="w-20 shrink-0 text-right sm:w-28">
        <span className="text-sm font-medium tabular-nums text-foreground">{percent}</span>
        <div
          role="progressbar"
          aria-label={t("progressLabel", { title: report.title })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={report.completionPercent}
          aria-valuetext={percent}
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-highlight"
            style={{ width: fillWidth(report.completionPercent) }}
          />
        </div>
      </div>
    </li>
  );
}
