import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Building2, ShieldAlert } from "lucide-react";
import { DangerZone } from "@/components/deletion/danger-zone";
import { DeleteWorkspaceDialog } from "@/components/deletion/delete-workspace-dialog";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getWorkspaceDeletionPreview } from "@/lib/deletions/preview";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { getMyWorkspaces, requireWorkspaceRole } from "@/lib/workspaces/server";
import { deleteWorkspace } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("WorkspaceSettings");
  return { title: t("metaTitle") };
}

/**
 * Settings of a workspace, for its owners (KRB-180): its organization, and
 * the danger zone to delete it. Other members get a "page réservée" screen,
 * people outside a 404.
 */
export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ locale: "fr"; workspaceId: string }>;
}) {
  const { locale, workspaceId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("WorkspaceSettings");
  const tDeletion = await getTranslations("Deletion");

  if (!uuidSchema.safeParse(workspaceId).success) notFound();
  const access = await requireWorkspaceRole(workspaceId);
  if (!access) notFound();

  if (access.role !== "owner") {
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

  const [preview, workspaces] = await Promise.all([
    getWorkspaceDeletionPreview(workspaceId),
    getMyWorkspaces(),
  ]);
  if (!preview) notFound();
  const ownsOrganization = workspaces.some(
    (workspace) => workspace.id === preview.workspaceId && workspace.ownsOrganization,
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
      <Link
        href="/tableau-de-bord"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("backToDashboard")}
      </Link>
      <header className="mt-4">
        <h1 className="break-words text-h2 text-foreground">{t("title", { workspace: preview.name })}</h1>
        <p className="mt-1 text-small text-muted-foreground">{t("subtitle")}</p>
      </header>

      <section
        aria-labelledby="workspace-organization-title"
        className="surface-card mt-8 rounded-2xl border p-5 shadow-sm"
      >
        <h2 id="workspace-organization-title" className="flex items-center gap-2 font-medium">
          <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("organizationTitle")}
        </h2>
        <p className="mt-2 text-sm">{t("organization", { organization: preview.organizationName })}</p>
        {ownsOrganization ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">{t("organizationOwner")}</p>
            <Button asChild variant="outline" shape="pill" size="sm" className="mt-4">
              <Link href={`/organisations/${preview.organizationId}`}>{t("organizationLink")}</Link>
            </Button>
          </>
        ) : null}
      </section>

      <DangerZone
        id="delete-workspace-title"
        title={tDeletion("workspace.zoneTitle")}
        description={tDeletion("workspace.zoneDescription")}
      >
        <DeleteWorkspaceDialog preview={preview} action={deleteWorkspace} />
      </DangerZone>
    </div>
  );
}
