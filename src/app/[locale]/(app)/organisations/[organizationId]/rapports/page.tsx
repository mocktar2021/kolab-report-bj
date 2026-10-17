import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Building2 } from "lucide-react";
import { OrganizationReportList } from "@/components/organization/organization-reports";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getOrganizationReports } from "@/lib/reports/organization-server";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { getMyWorkspaces } from "@/lib/workspaces/server";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: "fr"; organizationId: string }>;

/** The organization, seen through the user's own workspaces in it. Null when they have none. */
async function myOrganization(organizationId: string) {
  const id = uuidSchema.safeParse(organizationId);
  if (!id.success) return null;
  const workspaces = (await getMyWorkspaces()).filter((workspace) => workspace.organizationId === id.data);
  if (workspaces.length === 0) return null;
  return {
    id: id.data,
    name: workspaces.find((workspace) => workspace.organizationName)?.organizationName ?? null,
    owned: workspaces.some((workspace) => workspace.ownsOrganization),
    workspaces,
  };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { organizationId } = await params;
  const [t, tWorkspaces, organization] = await Promise.all([
    getTranslations("OrganizationReports"),
    getTranslations("Workspaces"),
    myOrganization(organizationId),
  ]);
  return { title: t("metaTitle", { name: organization?.name ?? tWorkspaces("noOrganizationName") }) };
}

/**
 * The reports of an organization (KRB-208), opened from its name in the
 * workspace switcher: the reports of every workspace the user belongs to in
 * it. Someone with no workspace in the organization gets a 404, and RLS
 * applies to every read.
 */
export default async function OrganizationReportsPage({ params }: { params: Params }) {
  const { locale, organizationId } = await params;
  setRequestLocale(locale);
  const organization = await myOrganization(organizationId);
  if (!organization) notFound();

  const [t, tWorkspaces, data] = await Promise.all([
    getTranslations("OrganizationReports"),
    getTranslations("Workspaces"),
    getOrganizationReports(organization.workspaces),
  ]);
  const workspaces = organization.workspaces.length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
      <Link
        href="/tableau-de-bord"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("backToDashboard")}
      </Link>
      <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{t("eyebrow")}</p>
          <h1 className="mt-1 break-words text-h2 text-foreground">
            {organization.name ?? tWorkspaces("noOrganizationName")}
          </h1>
          {data ? (
            <p className="mt-1 text-small text-muted-foreground">
              {data.total === 0
                ? t("summaryEmpty", { workspaces })
                : t("summary", { reports: data.total, workspaces, active: data.active })}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">{t("scope")}</p>
        </div>
        {organization.owned ? (
          <Button asChild variant="outline" shape="pill" className="shrink-0">
            <Link href={`/organisations/${organization.id}`}>
              <Building2 aria-hidden="true" />
              {tWorkspaces("organization")}
            </Link>
          </Button>
        ) : null}
      </header>

      {data ? (
        <OrganizationReportList data={data} />
      ) : (
        <p className="surface-card mt-8 rounded-2xl border px-5 py-8 text-center text-sm text-muted-foreground shadow-sm">
          {t("error")}
        </p>
      )}
    </div>
  );
}
