import { getTranslations } from "next-intl/server";
import { DeletionList } from "@/components/deletion/danger-zone";
import { DeleteDialog, type DeleteDialogProps } from "@/components/deletion/delete-dialog";
import { formatBillingDate } from "@/lib/billing/format";
import type { WorkspaceDeletionPreview } from "@/lib/deletions/preview";

/**
 * "Supprimer l'espace de travail" (KRB-180): the dialog that names what goes
 * with a workspace and the pass it loses, and asks for its exact name. The
 * settings page of the workspace and the organization page share it; each
 * passes its own action, which decides where the user goes next.
 */
export async function DeleteWorkspaceDialog({
  preview,
  action,
  compact = false,
}: {
  preview: WorkspaceDeletionPreview;
  action: DeleteDialogProps["action"];
  /** A small "Supprimer" button named after the workspace, for a list. */
  compact?: boolean;
}) {
  const t = await getTranslations("Deletion");
  const passEnd = preview.passes.reduce<string | null>(
    (latest, pass) =>
      latest === null || Date.parse(pass.endsAt) > Date.parse(latest) ? pass.endsAt : latest,
    null,
  );

  return (
    <DeleteDialog
      action={action}
      id={preview.workspaceId}
      expected={preview.name}
      size={compact ? "sm" : "default"}
      labels={{
        trigger: compact ? t("workspace.buttonShort") : t("workspace.button"),
        triggerLabel: compact ? t("workspace.buttonLabel", { name: preview.name }) : undefined,
        title: t("workspace.title"),
        description: t("workspace.description", { name: preview.name, members: preview.members }),
        confirm: t("workspace.confirm"),
        pending: t("workspace.pending"),
        cancel: t("cancel"),
        typed: t("workspace.typed", { name: preview.name }),
        mismatch: t("mismatch"),
      }}
    >
      <DeletionList
        title={t("workspace.contentsTitle")}
        items={[
          preview.reports > 0 &&
            [
              t("workspace.reports", { count: preview.reports }),
              preview.finalReports > 0 && t("workspace.finalReports", { count: preview.finalReports }),
            ]
              .filter(Boolean)
              .join(", "),
          preview.sections > 0 && t("workspace.sections", { count: preview.sections }),
          preview.files > 0 && t("workspace.files", { count: preview.files }),
          preview.exports > 0 && t("workspace.exports", { count: preview.exports }),
          preview.invitations > 0 && t("workspace.invitations", { count: preview.invitations }),
          preview.templates > 0 && t("workspace.templates", { count: preview.templates }),
          t("workspace.access", { count: preview.members }),
        ]}
      />
      {passEnd ? (
        <p role="note" className="rounded-lg border border-destructive/40 px-3 py-2">
          {t("workspace.pass", { date: formatBillingDate(passEnd) })}
        </p>
      ) : null}
      <p className="text-muted-foreground">
        {t("workspace.organizationKept", { organization: preview.organizationName })} {t("aiUsageKept")}
      </p>
    </DeleteDialog>
  );
}
