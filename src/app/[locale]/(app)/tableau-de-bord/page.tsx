import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Users } from "lucide-react";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { NoWorkspace } from "@/components/dashboard/no-workspace";
import { ReportList } from "@/components/dashboard/report-list";
import { SectionTable, SectionsError } from "@/components/dashboard/section-table";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getDashboardData, getWorkspaceReports } from "@/lib/dashboard";
import { sectionStatusSchema } from "@/lib/sections";
import { getCurrentProfile } from "@/lib/supabase/user";
import { isManager } from "@/lib/workspaces/roles";
import { getCurrentWorkspace } from "@/lib/workspaces/server";

// Per-user data behind auth: never prerender or cache.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Dashboard");
  return { title: t("title") };
}

export default async function TableauDeBordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "fr" }>;
  searchParams: Promise<{ statut?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Dashboard");

  // Unknown or repeated ?statut= values are ignored: the page shows everything.
  const { statut } = await searchParams;
  const parsedStatus = sectionStatusSchema.safeParse(statut);
  const activeStatus = parsedStatus.success ? parsedStatus.data : null;

  const [profile, workspace] = await Promise.all([getCurrentProfile(), getCurrentWorkspace()]);
  const [data, reports] = workspace
    ? await Promise.all([getDashboardData(workspace.id, activeStatus), getWorkspaceReports(workspace.id)])
    : [null, null];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{t("greeting", { name: profile?.name ?? "" })}</p>
          <h1 className="mt-1 text-h2 text-foreground">{t("title")}</h1>
          {workspace ? (
            <p className="mt-1 text-small text-muted-foreground">
              {t("subtitle", { workspace: workspace.name })}
            </p>
          ) : null}
        </div>
        {workspace && isManager(workspace.role) ? (
          <Button asChild variant="outline" shape="pill" className="shrink-0">
            <Link href={`/espaces/${workspace.id}/membres`}>
              <Users aria-hidden="true" />
              {t("manageMembers")}
            </Link>
          </Button>
        ) : null}
      </header>

      {/*
        Reloads the page when a section of the workspace changes elsewhere
        (KRB-19). No loading.tsx for this route: with a route loading boundary,
        Next 15.5 dropped about one router.refresh() result in three in the
        e2e test, and the dashboard stayed on the old figures.
      */}
      {workspace ? <LiveDashboard workspaceId={workspace.id} /> : null}

      {!workspace ? (
        <NoWorkspace />
      ) : data && reports ? (
        <>
          <KpiCards
            counts={data.counts}
            totalSections={data.totalSections}
            completionPercent={data.completionPercent}
            reportsWithSections={data.reportsWithSections}
            activeStatus={activeStatus}
          />
          <ReportList reports={reports} />
          <SectionTable
            sections={data.sections}
            matchingSections={data.matchingSections}
            activeStatus={activeStatus}
          />
        </>
      ) : (
        <SectionsError />
      )}
    </div>
  );
}
