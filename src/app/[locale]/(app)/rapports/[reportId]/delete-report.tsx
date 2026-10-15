import { getTranslations } from "next-intl/server";
import { DangerZone, DeletionList } from "@/components/deletion/danger-zone";
import { DeleteDialog } from "@/components/deletion/delete-dialog";
import type { ReportDeletionPreview } from "@/lib/deletions/preview";
import type { WorkspaceRole } from "@/lib/workspaces/roles";
import { deleteReport } from "./delete-actions";

/**
 * "Supprimer le rapport" at the end of the report page (KRB-180), for owners
 * and admins. A final report: owners only, who type its title. Admins see why
 * they cannot.
 */
export async function DeleteReport({
  preview,
  role,
}: {
  preview: ReportDeletionPreview;
  role: WorkspaceRole;
}) {
  const t = await getTranslations("Deletion");
  const final = preview.status === "final";
  const canDelete = role === "owner" || !final;

  return (
    <DangerZone
      id="delete-report-title"
      title={t("report.zoneTitle")}
      description={t("report.zoneDescription")}
    >
      {final ? (
        <p className="text-sm">{canDelete ? t("report.finalOwner") : t("report.finalAdmin")}</p>
      ) : null}
      {canDelete ? (
        <DeleteDialog
          action={deleteReport}
          id={preview.reportId}
          expected={final ? preview.title : undefined}
          labels={{
            trigger: t("report.button"),
            title: t("report.title"),
            description: t("report.description", { title: preview.title }),
            confirm: t("report.confirm"),
            pending: t("report.pending"),
            cancel: t("cancel"),
            typed: t("report.typed", { title: preview.title }),
            mismatch: t("mismatch"),
          }}
        >
          <DeletionList
            title={t("report.contentsTitle")}
            items={[
              preview.sections > 0 && t("report.sections", { count: preview.sections }),
              preview.files > 0 && t("report.files", { count: preview.files }),
              preview.exports > 0 && t("report.exports", { count: preview.exports }),
              t("report.history"),
            ]}
          />
          {final ? <p>{t("report.finalNote")}</p> : null}
          <p className="text-muted-foreground">{t("aiUsageKept")}</p>
        </DeleteDialog>
      ) : null}
    </DangerZone>
  );
}
