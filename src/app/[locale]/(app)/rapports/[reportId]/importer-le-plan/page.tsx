import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { ReadOnlyNotice } from "@/components/billing/read-only-notice";
import { FrozenReportNotice } from "@/components/frozen-report-notice";
import { Link } from "@/i18n/navigation";
import { draftAvailability } from "@/lib/ai/config";
import { getReadOnlyReason } from "@/lib/billing/banner";
import { isReportFrozen } from "@/lib/reports/status";
import { createClient } from "@/lib/supabase/server";
import { isManager } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { PlanImport } from "./plan-import";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: "fr"; reportId: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PlanImport");
  return { title: t("metaTitle") };
}

/**
 * "Importer le plan" (KRB-196): owners and admins create the sections of a
 * report from a Word, text, Markdown or PDF file, or pasted text. The plan
 * shows in a preview first; nothing is created before they confirm.
 */
export default async function ImportPlanPage({ params }: { params: Params }) {
  const { locale, reportId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("PlanImport");

  if (!uuidSchema.safeParse(reportId).success) notFound();
  // RLS hides reports of other workspaces, so they look like missing ones.
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("reports")
    .select("id, title, status, workspace_id")
    .eq("id", reportId.toLowerCase())
    .maybeSingle();
  if (!report) notFound();
  const access = await requireWorkspaceRole(report.workspace_id);
  if (!access || !isManager(access.role)) notFound();

  const [{ count }, readOnly] = await Promise.all([
    supabase.from("report_sections").select("id", { count: "exact", head: true }).eq("report_id", report.id),
    getReadOnlyReason(report.workspace_id),
  ]);
  const frozen = isReportFrozen(report.status);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
      <Link
        href={`/rapports/${report.id}`}
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("backToReport")}
      </Link>

      <header className="mt-4">
        <p className="truncate text-sm text-muted-foreground">{t("subtitle", { title: report.title })}</p>
        <h1 className="mt-1 text-h2 text-foreground">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-small text-muted-foreground">{t("intro")}</p>
        {count ? (
          <p className="mt-1 max-w-2xl text-small text-muted-foreground">{t("existing", { count })}</p>
        ) : null}
      </header>

      {readOnly ? (
        <ReadOnlyNotice reason={readOnly} className="mt-6" />
      ) : frozen ? (
        <FrozenReportNotice className="mt-6" />
      ) : (
        <PlanImport reportId={report.id} pdfEnabled={draftAvailability() === "enabled"} />
      )}
    </div>
  );
}
