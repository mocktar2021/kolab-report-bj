import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, FolderKanban, Plus } from "lucide-react";
import { DangerZone, DeletionList } from "@/components/deletion/danger-zone";
import { DeleteDialog } from "@/components/deletion/delete-dialog";
import { DeleteWorkspaceDialog } from "@/components/deletion/delete-workspace-dialog";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { PLANS } from "@/lib/billing/catalog";
import { formatBillingDate } from "@/lib/billing/format";
import { billingLosses } from "@/lib/deletions/losses";
import { getOrganizationDeletionPreview, getWorkspaceDeletionPreview } from "@/lib/deletions/preview";
import { deleteOrganization, deleteOrganizationWorkspace } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("OrganizationSettings");
  return { title: t("metaTitle") };
}

/**
 * An organization, for its owner (organizations.owner_id): its workspaces,
 * each with a delete action, even the ones the owner is not a member of, and
 * the danger zone to delete it with all of them (KRB-180). Anyone else gets a
 * 404. The billing pages of KRB-176 live under ./abonnement.
 */
export default async function OrganizationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "fr"; organizationId: string }>;
  searchParams: Promise<{ suppression?: string | string[] }>;
}) {
  const { locale, organizationId } = await params;
  // Set by deleteOrganizationWorkspace when it brings the owner back here.
  const workspaceDeleted = (await searchParams).suppression === "espace";
  setRequestLocale(locale);
  const t = await getTranslations("OrganizationSettings");
  const tDeletion = await getTranslations("Deletion");

  const preview = await getOrganizationDeletionPreview(organizationId);
  if (!preview) notFound();
  // What deleting each workspace takes, for its delete action.
  const workspacePreviews = new Map(
    (
      await Promise.all(preview.workspaces.map((workspace) => getWorkspaceDeletionPreview(workspace.id)))
    ).flatMap((workspace) => (workspace ? [[workspace.workspaceId, workspace] as const] : [])),
  );

  const losses = billingLosses(preview.billing);
  const names = new Map(preview.workspaces.map((workspace) => [workspace.id, workspace.name]));

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
        <p className="text-sm text-muted-foreground">{t("eyebrow")}</p>
        <h1 className="mt-1 break-words text-h2 text-foreground">{preview.name}</h1>
        <p className="mt-1 text-small text-muted-foreground">{t("subtitle")}</p>
      </header>

      {workspaceDeleted ? (
        <p role="status" className="mt-6 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          {tDeletion("done.espace")}
        </p>
      ) : null}

      <section
        aria-labelledby="organization-workspaces-title"
        className="surface-card mt-8 rounded-2xl border p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="organization-workspaces-title" className="font-medium">
            {t("workspacesTitle")}
          </h2>
          <Button asChild variant="outline" shape="pill" size="sm">
            <Link href="/espaces/nouveau">
              <Plus aria-hidden="true" />
              {t("addWorkspace")}
            </Link>
          </Button>
        </div>
        {preview.workspaces.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("workspacesEmpty")}</p>
        ) : (
          <ul className="mt-3 divide-y">
            {preview.workspaces.map((workspace) => {
              const deletion = workspacePreviews.get(workspace.id);
              return (
                <li key={workspace.id} className="flex items-center gap-3 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-highlight/[0.08] text-highlight ring-1 ring-inset ring-highlight/25">
                    <FolderKanban className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {workspace.name}
                      {workspace.billingMode === "mission" ? (
                        <span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                          {t("mission")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("workspaceMeta", { reports: workspace.reports, members: workspace.members })}
                    </p>
                  </div>
                  {deletion ? (
                    <div className="ml-auto shrink-0">
                      <DeleteWorkspaceDialog
                        preview={deletion}
                        action={deleteOrganizationWorkspace}
                        compact
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <DangerZone
        id="delete-organization-title"
        title={tDeletion("organization.zoneTitle")}
        description={tDeletion("organization.zoneDescription")}
      >
        <DeleteDialog
          action={deleteOrganization}
          id={preview.organizationId}
          expected={preview.name}
          labels={{
            trigger: tDeletion("organization.button"),
            title: tDeletion("organization.title"),
            description: tDeletion("organization.description", { name: preview.name }),
            confirm: tDeletion("organization.confirm"),
            pending: tDeletion("organization.pending"),
            cancel: tDeletion("cancel"),
            typed: tDeletion("organization.typed", { name: preview.name }),
            mismatch: tDeletion("mismatch"),
          }}
        >
          {preview.workspaces.length === 0 ? (
            <p>{tDeletion("organization.workspacesTitle", { count: 0 })}</p>
          ) : (
            <DeletionList
              title={tDeletion("organization.workspacesTitle", { count: preview.workspaces.length })}
              items={preview.workspaces.map((workspace) =>
                [
                  tDeletion("organization.workspace", {
                    name: workspace.name,
                    reports: workspace.reports,
                    members: workspace.members,
                  }),
                  workspace.billingMode === "mission" ? tDeletion("organization.mission") : null,
                ]
                  .filter(Boolean)
                  .join(", "),
              )}
            />
          )}
          {losses.any ? (
            <div role="note" className="rounded-lg border border-destructive/40 px-3 py-2">
              <DeletionList
                title={tDeletion("organization.billingTitle")}
                items={[
                  losses.plan &&
                    tDeletion("organization.plan", {
                      plan: PLANS[losses.plan.plan].label,
                      date: formatBillingDate(losses.plan.endsAt),
                    }),
                  ...losses.passes.map((pass) =>
                    tDeletion("organization.pass", {
                      workspace: names.get(pass.workspaceId) ?? "",
                      date: formatBillingDate(pass.endsAt),
                    }),
                  ),
                  losses.packDrafts > 0 && tDeletion("organization.packs", { count: losses.packDrafts }),
                ]}
              />
              <p className="mt-2 font-medium">{tDeletion("organization.lost")}</p>
            </div>
          ) : null}
          {losses.trialEndsAt ? <p>{tDeletion("organization.trial")}</p> : null}
          {preview.receipts > 0 ? (
            <p role="note" className="rounded-lg border px-3 py-2">
              {tDeletion.rich("organization.receipts", {
                count: preview.receipts,
                link: (chunks) => (
                  <Link
                    href={`/organisations/${preview.organizationId}/abonnement`}
                    className="font-medium underline underline-offset-4"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          ) : null}
          <p className="text-muted-foreground">{tDeletion("organization.accountsKept")}</p>
        </DeleteDialog>
      </DangerZone>
    </div>
  );
}
