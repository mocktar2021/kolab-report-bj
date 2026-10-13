import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getPromptTemplate, type PromptVersionRow } from "@/lib/prompts/server";
import { cn } from "@/lib/utils";
import { getWorkspaceMembers } from "@/lib/workspaces/members";
import { isManager } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { GlobalBadge, PromptStatusBadge } from "../prompt-badges";
import { VersionActions } from "./version-actions";
import { VersionDiff } from "./version-diff";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: "fr"; workspaceId: string; promptId: string }>;

const DATE_FORMAT = {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} as const;

// Shared by the metadata and the page within one request.
const loadTemplate = cache(getPromptTemplate);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, promptId } = await params;
  const t = await getTranslations("Prompts");
  const detail = await loadTemplate(workspaceId, promptId);
  return { title: detail?.version.title ?? t("metaTitle") };
}

export default async function PromptVersionPage({ params }: { params: Params }) {
  const { locale, workspaceId, promptId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Prompts");
  const format = await getFormatter();

  // Global templates are readable by everyone, so membership is checked first.
  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const access = await requireWorkspaceRole(workspaceId);
  if (!access) notFound();
  const [detail, members] = await Promise.all([
    loadTemplate(workspaceId, promptId),
    getWorkspaceMembers(workspaceId),
  ]);
  if (!detail) notFound();

  const { version, history } = detail;
  const global = version.workspaceId === null;
  const manager = isManager(access.role);
  const names = new Map((members ?? []).map((member) => [member.userId, member.name]));
  const authorOf = (row: PromptVersionRow) =>
    row.workspaceId === null
      ? t("globalAuthor")
      : ((row.createdBy ? names.get(row.createdBy) : undefined) ?? t("unknownAuthor"));
  // History is newest first: the first lower number is the version just below.
  const previous = history.find((row) => row.version < version.version) ?? null;
  const libraryHref = `/espaces/${workspaceId}/modeles`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
      <Link
        href={libraryHref}
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("backToLibrary")}
      </Link>

      <header className="mt-4">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {global ? <GlobalBadge /> : null}
          <PromptStatusBadge status={version.status} />
          <span>{t("versionLabel", { version: version.version })}</span>
          {global ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span>{t("workspaceScope")}</span>
            </>
          )}
        </p>
        <h1 className="mt-2 break-words text-h2 text-foreground">{version.title}</h1>
        {version.description ? (
          <p className="mt-1 max-w-3xl break-words text-small text-muted-foreground">{version.description}</p>
        ) : null}
        <p className="mt-2 text-sm text-muted-foreground">
          {t.rich("byOn", {
            name: authorOf(version),
            date: format.dateTime(new Date(version.createdAt), DATE_FORMAT),
            time: (chunks) => <time dateTime={version.createdAt}>{chunks}</time>,
          })}
        </p>
        {version.changelog ? (
          <p className="mt-3 max-w-3xl whitespace-pre-line break-words rounded-xl border bg-muted/40 px-4 py-3 text-sm">
            {t.rich("changelogLine", {
              changelog: version.changelog,
              label: (chunks) => <span className="font-medium">{chunks}</span>,
            })}
          </p>
        ) : null}

        {global ? (
          <>
            <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
              {manager ? t("globalNoteManager") : t("globalNote")}
            </p>
            {manager ? (
              <Button asChild variant="outline" shape="pill" className="mt-4">
                <Link href={`${libraryHref}/nouveau?depuis=${version.id}`}>
                  <Copy aria-hidden="true" />
                  {t("actions.customize")}
                </Link>
              </Button>
            ) : null}
          </>
        ) : manager ? (
          <VersionActions
            workspaceId={workspaceId}
            versionId={version.id}
            status={version.status}
            newVersionHref={`${libraryHref}/${version.id}/modifier`}
          />
        ) : null}
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <TemplateBody version={version} />
          <VersionDiff version={version} previous={previous} />
        </div>
        <aside className="min-w-0 space-y-6">
          <Settings version={version} />
          <History history={history} currentId={version.id} libraryHref={libraryHref} authorOf={authorOf} />
        </aside>
      </div>
    </div>
  );
}

function TemplateBody({ version }: { version: PromptVersionRow }) {
  const t = useTranslations("Prompts");

  return (
    <section
      aria-labelledby="template-title"
      className="surface-card overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id="template-title" className="font-medium">
          {t("templateTitle")}
        </h2>
      </div>
      <div className="border-b px-5 py-3">
        <h3 className="text-xs font-medium text-muted-foreground">{t("variablesTitle")}</h3>
        {version.variables.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t("noVariables")}</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {version.variables.map((name) => (
              <li
                key={name}
                title={t(`variables.${name}.description`)}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs"
              >
                <code className="font-mono">{`{{${name}}}`}</code>
                <span className="text-muted-foreground">{t(`variables.${name}.label`)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <pre className="max-h-[40rem] overflow-y-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-[13px] leading-relaxed">
        {version.template}
      </pre>
    </section>
  );
}

function Settings({ version }: { version: PromptVersionRow }) {
  const t = useTranslations("Prompts");
  const format = useFormatter();

  return (
    <section
      aria-labelledby="settings-title"
      className="surface-card overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id="settings-title" className="font-medium">
          {t("settingsTitle")}
        </h2>
      </div>
      <dl className="space-y-3 px-5 py-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t("fields.outputSchema")}</dt>
          <dd className="mt-0.5 font-medium">{t(`outputSchemas.${version.outputSchema}.label`)}</dd>
          <dd className="mt-0.5 text-xs text-muted-foreground">
            {t(`outputSchemas.${version.outputSchema}.description`)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("fields.modelTier")}</dt>
          <dd className="mt-0.5 font-medium">{t(`modelTiers.${version.modelTier}.label`)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("fields.temperature")}</dt>
          <dd className="mt-0.5 font-medium">
            {version.temperature === null ? t("byDefault") : format.number(version.temperature)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("fields.maxOutputTokens")}</dt>
          <dd className="mt-0.5 font-medium">
            {version.maxOutputTokens === null
              ? t("byDefault")
              : t("tokens", { count: version.maxOutputTokens })}
          </dd>
        </div>
      </dl>
    </section>
  );
}

type HistoryProps = {
  history: PromptVersionRow[];
  currentId: string;
  libraryHref: string;
  authorOf: (row: PromptVersionRow) => string;
};

function History({ history, currentId, libraryHref, authorOf }: HistoryProps) {
  const t = useTranslations("Prompts");
  const format = useFormatter();

  return (
    <section
      aria-labelledby="history-title"
      className="surface-card overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 id="history-title" className="font-medium">
          {t("historyTitle")}
        </h2>
        <span className="text-sm text-muted-foreground">{t("historyCount", { count: history.length })}</span>
      </div>
      <ol className="divide-y">
        {history.map((row) => {
          const current = row.id === currentId;
          return (
            <li
              key={row.id}
              className={cn(
                "relative px-5 py-3.5 transition-colors",
                current ? "bg-highlight/[0.06]" : "hover:bg-muted/50",
              )}
            >
              <p className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${libraryHref}/${row.id}`}
                  aria-current={current ? "page" : undefined}
                  className="text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                >
                  {t("versionLabel", { version: row.version })}
                </Link>
                <PromptStatusBadge status={row.status} />
                {current ? (
                  <span aria-hidden="true" className="text-[11px] font-medium text-highlight">
                    {t("shownVersion")}
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.rich("historyByOn", {
                  name: authorOf(row),
                  date: format.dateTime(new Date(row.createdAt), DATE_FORMAT),
                  time: (chunks) => <time dateTime={row.createdAt}>{chunks}</time>,
                })}
              </p>
              {row.changelog ? (
                <p className="mt-1 line-clamp-3 break-words text-xs text-foreground/80">{row.changelog}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
