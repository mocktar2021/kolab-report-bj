import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getPromptTemplate } from "@/lib/prompts/server";
import { isManager } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { editorValuesFrom } from "../../editor-values";
import { PromptsForbidden } from "../../forbidden";
import { PromptEditor } from "../../prompt-editor";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Prompts.editor");
  return { title: t("editMetaTitle") };
}

export default async function NewPromptVersionPage({
  params,
}: {
  params: Promise<{ locale: "fr"; workspaceId: string; promptId: string }>;
}) {
  const { locale, workspaceId, promptId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Prompts");

  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const access = await requireWorkspaceRole(workspaceId);
  if (!access) notFound();
  if (!isManager(access.role)) return <PromptsForbidden workspaceId={workspaceId} />;

  // Global templates change through migrations only: they get "Personnaliser" instead.
  const detail = await getPromptTemplate(workspaceId, promptId);
  if (!detail || detail.version.workspaceId === null) notFound();

  const { version, history } = detail;
  // The editor sends this back, so a version saved meanwhile by someone else is not skipped.
  const latest = history[0]?.version ?? version.version;
  const versionHref = `/espaces/${workspaceId}/modeles/${version.id}`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
      <Link
        href={versionHref}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("versionLabel", { version: version.version })}</span>
      </Link>
      <header className="mt-4">
        <p className="text-sm text-muted-foreground">{t("editor.editEyebrow")}</p>
        <h1 className="mt-1 break-words text-h2 text-foreground">{version.title}</h1>
        <p className="mt-1 text-small text-muted-foreground">
          {t("editor.editSubtitle", { version: latest + 1 })}
        </p>
      </header>

      <PromptEditor
        workspaceId={workspaceId}
        baseId={version.id}
        expectedLatest={latest}
        initial={editorValuesFrom(version)}
        cancelHref={versionHref}
      />
    </div>
  );
}
