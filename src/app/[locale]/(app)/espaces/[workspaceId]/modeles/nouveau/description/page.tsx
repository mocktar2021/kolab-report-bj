import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { aiSettings, draftAvailability } from "@/lib/ai/config";
import { getTemplatePlan, templatesBlocked } from "@/lib/prompts/plan";
import { createClient } from "@/lib/supabase/server";
import { isManager } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { PromptsForbidden } from "../../forbidden";
import { TemplatesBlocked } from "../../templates-blocked";
import { DescribeTemplate } from "./describe-template";

export const dynamic = "force-dynamic";
// "Rédiger avec l'IA" runs as a server action of this page and waits for
// the model, 45 seconds at most (assist-actions.ts).
export const maxDuration = 60;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Prompts.builder");
  return { title: t("metaTitle") };
}

/** "Décrire le modèle" (KRB-198): a short form, or a few sentences for the AI, then the editor. */
export default async function DescribeTemplatePage({
  params,
}: {
  params: Promise<{ locale: "fr"; workspaceId: string }>;
}) {
  const { locale, workspaceId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Prompts.builder");

  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const access = await requireWorkspaceRole(workspaceId);
  if (!access) notFound();
  if (!isManager(access.role)) return <PromptsForbidden workspaceId={workspaceId} />;

  const supabase = await createClient();
  const [{ data: workspace }, plan] = await Promise.all([
    supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
    getTemplatePlan(workspaceId),
  ]);
  if (!workspace) notFound();
  const startHref = `/espaces/${workspaceId}/modeles/nouveau`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
      <Link
        href={startHref}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("backToStart")}</span>
      </Link>
      <header className="mt-4">
        <h1 className="text-h2 text-foreground">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-small text-muted-foreground">{t("subtitle")}</p>
      </header>

      {templatesBlocked(plan) ? (
        <TemplatesBlocked plan={plan} workspaceId={workspaceId} />
      ) : (
        <DescribeTemplate
          workspaceId={workspaceId}
          aiAvailable={draftAvailability() === "enabled"}
          dailyLimit={aiSettings().templateWriterPerDay}
          cancelHref={startHref}
        />
      )}
    </div>
  );
}
