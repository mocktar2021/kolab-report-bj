import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { sectionStatusSchema } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspaces/members";
import { isAssignable, isManager } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { AddSectionForm, SectionList, type SectionRowData } from "./section-list";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: "fr"; reportId: string }>;

async function loadReport(reportId: string) {
  if (!uuidSchema.safeParse(reportId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("id, title, workspace_id, workspace:workspaces(name)")
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

  const supabase = await createClient();
  const [{ data: sections }, members, { data: progress }] = await Promise.all([
    supabase
      .from("report_sections")
      .select("id, title, status, weight, assigned_to")
      .eq("report_id", report.id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    getWorkspaceMembers(report.workspace_id),
    supabase.from("report_progress").select("completion_percent").eq("report_id", report.id).maybeSingle(),
  ]);
  if (!sections || !members) notFound();

  const manager = isManager(access.role);
  const names = new Map(members.map((member) => [member.userId, member.name]));
  const rows: SectionRowData[] = sections.map((section) => ({
    id: section.id,
    title: section.title,
    status: sectionStatusSchema.catch("not_started").parse(section.status),
    weight: Number(section.weight),
    assignedTo: section.assigned_to,
    assigneeName: section.assigned_to ? (names.get(section.assigned_to) ?? null) : null,
    mine: section.assigned_to === access.userId,
  }));
  const assignees = members
    .filter((member) => isAssignable(member.role))
    .map((member) => ({ userId: member.userId, name: member.name, role: member.role }));
  const completion = Number(progress?.completion_percent ?? 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
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
          <h1 className="mt-1 text-h2 text-foreground">{report.title}</h1>
          <p className="mt-1 text-small text-muted-foreground">
            {t("completion", { percent: format.number(completion / 100, { style: "percent" }) })}
          </p>
        </div>
        {manager ? (
          <Button asChild variant="outline" shape="pill" className="shrink-0">
            <Link href={`/espaces/${report.workspace_id}/membres`}>
              <Users aria-hidden="true" />
              {t("manageMembers")}
            </Link>
          </Button>
        ) : null}
      </header>

      {manager ? null : (
        <p className="mt-6 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {access.role === "expert" ? t("expertNote") : t("viewerNote")}
        </p>
      )}

      <SectionList
        workspaceId={report.workspace_id}
        sections={rows}
        assignees={assignees}
        canManage={manager}
      />
      {manager ? <AddSectionForm reportId={report.id} /> : null}
    </div>
  );
}
