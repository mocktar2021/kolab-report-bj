import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, ChevronRight, Plus, Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { listActiveRollouts, type ActiveRollout } from "@/lib/prompts/rollouts";
import { listPromptTemplates, type PromptTemplateSummary } from "@/lib/prompts/server";
import { createClient } from "@/lib/supabase/server";
import { isManager } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { GlobalBadge, PromptStatusBadge } from "./prompt-badges";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Prompts");
  return { title: t("metaTitle") };
}

export default async function PromptLibraryPage({
  params,
}: {
  params: Promise<{ locale: "fr"; workspaceId: string }>;
}) {
  const { locale, workspaceId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Prompts");

  // Unknown ids and workspaces the user is not a member of both give a 404.
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const access = await requireWorkspaceRole(workspaceId);
  if (!access) notFound();

  const supabase = await createClient();
  const [{ data: workspace }, templates, allRollouts] = await Promise.all([
    supabase.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle(),
    listPromptTemplates(workspaceId),
    listActiveRollouts(workspaceId),
  ]);
  if (!workspace || !templates) notFound();

  // A global rollout limited to another workspace of the user doesn't reach this one.
  const rollouts: RolloutMap = new Map(
    [...allRollouts].filter(
      ([, rollout]) =>
        rollout.targetWorkspaceId === null || rollout.targetWorkspaceId === workspaceId.toLowerCase(),
    ),
  );

  const manager = isManager(access.role);
  const own = templates.filter((template) => template.scope === "workspace");
  const active = own.filter((template) => template.state !== "archived");
  const archived = own.filter((template) => template.state === "archived");
  const globals = templates.filter((template) => template.scope === "global");

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
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
          <p className="mt-1 text-small text-muted-foreground">
            {t("subtitle", { workspace: workspace.name })}
          </p>
        </div>
        {manager ? (
          <Button asChild shape="pill" className="shrink-0">
            <Link href={`/espaces/${workspaceId}/modeles/nouveau`}>
              <Plus aria-hidden="true" />
              {t("newTemplate")}
            </Link>
          </Button>
        ) : null}
      </header>

      {manager ? null : (
        <p className="mt-6 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {t("readOnlyNote")}
        </p>
      )}

      <TemplateGroup
        id="workspace-templates"
        title={t("workspaceGroup")}
        templates={active}
        workspaceId={workspaceId}
        rollouts={rollouts}
        empty={manager ? t("emptyManager") : t("emptyMember")}
      />
      <TemplateGroup
        id="global-templates"
        title={t("globalGroup")}
        help={t("globalGroupHelp")}
        templates={globals}
        workspaceId={workspaceId}
        rollouts={rollouts}
      />
      {archived.length > 0 ? (
        <TemplateGroup
          id="archived-templates"
          title={t("archivedGroup")}
          help={t("archivedGroupHelp")}
          templates={archived}
          workspaceId={workspaceId}
          rollouts={rollouts}
        />
      ) : null}
    </div>
  );
}

/** Active rollouts by "workspace:<key>" or "global:<key>", as listActiveRollouts gives them. */
type RolloutMap = ReadonlyMap<string, ActiveRollout>;

type TemplateGroupProps = {
  id: string;
  title: string;
  help?: string;
  templates: PromptTemplateSummary[];
  workspaceId: string;
  rollouts: RolloutMap;
  empty?: string;
};

function TemplateGroup({ id, title, help, templates, workspaceId, rollouts, empty }: TemplateGroupProps) {
  const t = useTranslations("Prompts");

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="font-medium">
            {title}
          </h2>
          <span className="text-sm text-muted-foreground">{t("count", { count: templates.length })}</span>
        </div>
        {help ? <p className="mt-1 text-xs text-muted-foreground">{help}</p> : null}
      </div>
      {templates.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {templates.map((template) => (
            <TemplateItem
              key={`${template.scope}/${template.templateKey}`}
              template={template}
              workspaceId={workspaceId}
              rollout={rollouts.get(`${template.scope}:${template.templateKey}`) ?? null}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

type TemplateItemProps = {
  template: PromptTemplateSummary;
  workspaceId: string;
  rollout: ActiveRollout | null;
};

function TemplateItem({ template, workspaceId, rollout }: TemplateItemProps) {
  const t = useTranslations("Prompts");
  const format = useFormatter();
  const { current } = template;
  // The published version can be older than the latest one, a draft for example.
  const olderPublished = template.state === "published" && current.version !== template.latestVersion;

  return (
    <li className="group relative flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/50">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          {/* The link covers the whole row; its name stays the title. */}
          <Link
            href={`/espaces/${workspaceId}/modeles/${current.id}`}
            className="min-w-0 break-words font-medium text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
          >
            {current.title}
          </Link>
          {template.scope === "global" ? <GlobalBadge /> : null}
          <PromptStatusBadge status={template.state} />
        </p>
        {current.description ? (
          <p className="mt-1 break-words text-sm text-muted-foreground">{current.description}</p>
        ) : null}
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{t(`outputSchemas.${current.outputSchema}.label`)}</span>
          <span>{t("itemVersions", { version: template.latestVersion, count: template.versionCount })}</span>
          {olderPublished ? <span>{t("itemPublished", { version: current.version })}</span> : null}
        </p>
        {rollout && rollout.candidateVersion !== null ? (
          <p className="mt-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20">
              <Split className="size-3.5" aria-hidden="true" />
              {t(rollout.targetWorkspaceId ? "rollout.listBadgePreview" : "rollout.listBadge", {
                version: rollout.candidateVersion,
                percent: format.number(rollout.percent / 100, { style: "percent", maximumFractionDigits: 0 }),
              })}
            </span>
          </p>
        ) : null}
      </div>
      <ChevronRight
        className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </li>
  );
}
