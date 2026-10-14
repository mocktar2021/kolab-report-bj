import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AlertCircle, ArrowLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { aiSettings } from "@/lib/ai/config";
import {
  METRIC_PERIODS,
  getPromptMetrics,
  getRecentGenerations,
  type MetricPeriod,
} from "@/lib/ai/metrics-server";
import { createClient } from "@/lib/supabase/server";
import { isManager } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { EmptyMetrics, MetricsTable, SummaryTiles } from "./metrics-table";
import { PeriodSwitch } from "./period-switch";
import { RecentGenerations } from "./recent-generations";
import { summarizeMetrics } from "./summary";

export const dynamic = "force-dynamic";

const DEFAULT_PERIOD: MetricPeriod = 30;
const RECENT_LIMIT = 20;

/** ?periode=7, 30 or 90. Anything else, a repeated value included, gives the default. */
function periodOf(value: string | string[] | undefined): MetricPeriod {
  const days = typeof value === "string" ? Number(value) : NaN;
  return METRIC_PERIODS.find((period) => period === days) ?? DEFAULT_PERIOD;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AiDashboard");
  return { title: t("metaTitle") };
}

export default async function AiDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "fr"; workspaceId: string }>;
  searchParams: Promise<{ periode?: string | string[] }>;
}) {
  const { locale, workspaceId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AiDashboard");

  // Unknown ids and workspaces the user is not a member of both give a 404.
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const access = await requireWorkspaceRole(workspaceId);
  if (!access) notFound();

  if (!isManager(access.role)) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="surface-card rounded-2xl border p-6 text-center shadow-sm">
          <ShieldAlert className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-3 text-h3">{t("forbiddenTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("forbiddenDescription")}</p>
          <Button asChild variant="outline" shape="pill" className="mt-5">
            <Link href="/tableau-de-bord">{t("backToDashboard")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const days = periodOf((await searchParams).periode);
  const supabase = await createClient();
  const [{ data: workspace }, metrics, recent] = await Promise.all([
    supabase.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle(),
    getPromptMetrics(workspaceId, days),
    getRecentGenerations(workspaceId, RECENT_LIMIT),
  ]);
  if (!workspace) notFound();
  const { tracing } = aiSettings();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
      <Link
        href="/tableau-de-bord"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("backToDashboard")}
      </Link>

      <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-h2 text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-small text-muted-foreground">
            {t("subtitle", { workspace: workspace.name })}
          </p>
        </div>
        <PeriodSwitch periods={METRIC_PERIODS} current={days} workspaceId={workspaceId} />
      </header>

      {metrics === null ? (
        <section className="surface-card mt-8 rounded-2xl border px-6 py-10 text-center shadow-sm">
          <AlertCircle className="mx-auto size-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm text-muted-foreground">{t("loadError")}</p>
        </section>
      ) : metrics.length === 0 ? (
        <EmptyMetrics days={days} />
      ) : (
        <>
          <SummaryTiles summary={summarizeMetrics(metrics)} days={days} />
          <MetricsTable rows={metrics} workspaceId={workspaceId} />
        </>
      )}

      <RecentGenerations
        generations={recent}
        workspaceId={workspaceId}
        tracingLinks={tracing.enabled && tracing.urlTemplate !== null}
      />
    </div>
  );
}
