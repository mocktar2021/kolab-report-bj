import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Users } from "lucide-react";
import { FrozenReportNotice } from "@/components/frozen-report-notice";
import { ReportStatusBadge } from "@/components/report-status-badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { EXPORTS_PER_HOUR, listReportExports } from "@/lib/reports/exports";
import { allowedReportActions, isReportFrozen } from "@/lib/reports/status";
import { getReportWorkflow } from "@/lib/reports/workflow";
import { canEditSection, sectionStatusSchema } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspaces/members";
import { isAssignable, isManager } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { ExportButtons } from "./export-buttons";
import { LastStatusChange } from "./last-status-change";
import { LiveReport } from "./live-report";
import { MasterReport } from "./master-report";
import { RecentExports } from "./recent-exports";
import type { ReportSection } from "./report-document";
import { ReportStatusControls } from "./report-status-controls";
import { AddSectionForm } from "./section-list";

export const dynamic = "force-dynamic";

// Finalizing builds the snapshot of the report during the action (KRB-20), like an export.
export const maxDuration = 60;

type Params = Promise<{ locale: "fr"; reportId: string }>;

async function loadReport(reportId: string) {
  if (!uuidSchema.safeParse(reportId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("id, title, status, workspace_id, workspace:workspaces(name)")
    .eq("id", reportId)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { reportId } = await params;
  const report = await loadReport(reportId);
  const t = await getTranslations("Report");
  return { title: report?.title ?? t("metaTitle") };
}

/**
 * The master report (Story KRB-18): every section in order, with its text.
 * Members read it all and edit their own sections from it; owners and admins
 * also assign, weigh and reorder the sections, and export the report. Owners
 * and admins move it through review; once final, nobody edits it (KRB-20).
 */
export default async function ReportPage({ params }: { params: Params }) {
  const { locale, reportId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Report");
  const format = await getFormatter();

  // RLS hides reports of other workspaces, so they look like missing ones.
  const report = await loadReport(reportId);
  if (!report) notFound();
  const access = await requireWorkspaceRole(report.workspace_id);
  if (!access) notFound();
  const manager = isManager(access.role);
  const frozen = isReportFrozen(report.status);

  const supabase = await createClient();
  const [{ data: sections }, members, { data: progress }, exports, workflow] = await Promise.all([
    supabase
      .from("report_sections")
      .select("id, title, status, weight, assigned_to, content")
      .eq("report_id", report.id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    getWorkspaceMembers(report.workspace_id),
    supabase.from("report_progress").select("completion_percent").eq("report_id", report.id).maybeSingle(),
    // RLS only lets owners and admins read the exports.
    manager ? listReportExports(report.id) : [],
    getReportWorkflow(report, manager),
  ]);
  if (!sections || !members) notFound();

  const names = new Map(members.map((member) => [member.userId, member.name]));
  const rows: ReportSection[] = sections.map((section) => ({
    id: section.id,
    title: section.title,
    status: sectionStatusSchema.catch("not_started").parse(section.status),
    weight: Number(section.weight),
    assignedTo: section.assigned_to,
    assigneeName: section.assigned_to ? (names.get(section.assigned_to) ?? null) : null,
    mine: section.assigned_to === access.userId,
    canEdit: canEditSection(access, section.assigned_to),
    content: section.content,
  }));
  const assignees = members
    .filter((member) => isAssignable(member.role))
    .map((member) => ({ userId: member.userId, name: member.name, role: member.role }));
  const completion = Number(progress?.completion_percent ?? 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
      <Link
        href="/tableau-de-bord"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("backToDashboard")}
      </Link>

      <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{report.workspace?.name}</p>
          <h1 className="mt-1 break-words text-h2 text-foreground">{report.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <ReportStatusBadge status={report.status} />
            <p className="text-small text-muted-foreground">
              {t("completion", { percent: format.number(completion / 100, { style: "percent" }) })}
            </p>
          </div>
          <LastStatusChange status={report.status} change={workflow.lastChange} className="mt-1.5" />
        </div>
        {manager ? (
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <Button asChild variant="outline" shape="pill" className="self-start sm:self-end">
              <Link href={`/espaces/${report.workspace_id}/membres`}>
                <Users aria-hidden="true" />
                {t("manageMembers")}
              </Link>
            </Button>
            <ExportButtons reportId={report.id} hourlyLimit={EXPORTS_PER_HOUR} />
          </div>
        ) : null}
      </header>

      {frozen ? (
        <FrozenReportNotice className="mt-6" />
      ) : manager ? null : (
        <p className="mt-6 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {access.role === "expert" ? t("expertNote") : t("viewerNote")}
        </p>
      )}

      {manager ? (
        <ReportStatusControls
          reportId={report.id}
          status={report.status}
          actions={allowedReportActions(report.status, access.role)}
          snapshot={workflow.snapshot}
        />
      ) : null}

      <MasterReport
        reportId={report.id}
        workspaceId={report.workspace_id}
        sections={rows}
        assignees={assignees}
        canManage={manager}
        frozen={frozen}
        addSectionForm={manager && !frozen ? <AddSectionForm reportId={report.id} /> : null}
      />

      {manager ? (
        <RecentExports
          exports={exports.map((file) => ({
            ...file,
            authorName: file.createdBy ? (names.get(file.createdBy) ?? null) : null,
          }))}
        />
      ) : null}

      <LiveReport reportId={report.id} />
    </div>
  );
}
