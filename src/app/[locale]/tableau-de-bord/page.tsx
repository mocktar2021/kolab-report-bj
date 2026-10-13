import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { SectionTable, SectionsError } from "@/components/dashboard/section-table";
import { getDashboardData } from "@/lib/dashboard";
import { sectionStatusSchema } from "@/lib/sections";
import { getCurrentProfile } from "@/lib/supabase/user";

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

  const [profile, data] = await Promise.all([getCurrentProfile(), getDashboardData(activeStatus)]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
      <header>
        <p className="text-sm text-muted-foreground">{t("greeting", { name: profile?.name ?? "" })}</p>
        <h1 className="mt-1 text-h2 text-foreground">{t("title")}</h1>
        <p className="mt-1 text-small text-muted-foreground">{t("subtitle")}</p>
      </header>

      {data ? (
        <>
          <KpiCards
            counts={data.counts}
            totalSections={data.totalSections}
            completionPercent={data.completionPercent}
            reportsWithSections={data.reportsWithSections}
            activeStatus={activeStatus}
          />
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
