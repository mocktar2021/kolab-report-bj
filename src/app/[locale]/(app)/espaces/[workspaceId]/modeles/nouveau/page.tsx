import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getPromptTemplate } from "@/lib/prompts/server";
import { createClient } from "@/lib/supabase/server";
import { isManager } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { EMPTY_EDITOR_VALUES, editorValuesFrom } from "../editor-values";
import { PromptsForbidden } from "../forbidden";
import { PromptEditor } from "../prompt-editor";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Prompts.editor");
  return { title: t("newMetaTitle") };
}

export default async function NewPromptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "fr"; workspaceId: string }>;
  searchParams: Promise<{ depuis?: string | string[] }>;
}) {
  const { locale, workspaceId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Prompts");

  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const access = await requireWorkspaceRole(workspaceId);
  if (!access) notFound();
  if (!isManager(access.role)) return <PromptsForbidden workspaceId={workspaceId} />;

  // ?depuis=<version id> starts from a global template or one of this
  // workspace. The result is still a new template: the source never changes.
  const { depuis } = await searchParams;
  const sourceId = typeof depuis === "string" ? depuis : null;
  const supabase = await createClient();
  const [{ data: workspace }, source] = await Promise.all([
    supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
    sourceId ? getPromptTemplate(workspaceId, sourceId) : null,
  ]);
  if (!workspace || (sourceId && !source)) notFound();

  const libraryHref = `/espaces/${workspaceId}/modeles`;
  const base = source?.version ?? null;
  const backHref = base ? `${libraryHref}/${base.id}` : libraryHref;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
      <Link
        href={backHref}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{base ? base.title : t("backToLibrary")}</span>
      </Link>
      <header className="mt-4">
        <h1 className="text-h2 text-foreground">{t("editor.newTitle")}</h1>
        <p className="mt-1 text-small text-muted-foreground">
          {base
            ? t("editor.customizeSubtitle", { title: base.title, version: base.version })
            : t("editor.newSubtitle", { workspace: workspace.name })}
        </p>
      </header>

      <PromptEditor
        workspaceId={workspaceId}
        baseId={null}
        expectedLatest={null}
        initial={
          base
            ? editorValuesFrom(base, t("editor.customizedFrom", { title: base.title, version: base.version }))
            : EMPTY_EDITOR_VALUES
        }
        cancelHref={backHref}
      />
    </div>
  );
}
