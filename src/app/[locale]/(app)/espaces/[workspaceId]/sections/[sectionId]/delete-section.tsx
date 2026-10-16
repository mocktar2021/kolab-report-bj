import { getTranslations } from "next-intl/server";
import { DangerZone, DeletionList } from "@/components/deletion/danger-zone";
import { DeleteDialog } from "@/components/deletion/delete-dialog";
import type { SectionDeletionPreview } from "@/lib/deletions/preview";
import { deleteSection } from "./manage-actions";

/**
 * "Supprimer la section" at the end of the section page (KRB-195), for owners
 * and admins while the report is not final. The dialog names what goes with
 * it: subsections, text, files.
 */
export async function DeleteSection({ preview }: { preview: SectionDeletionPreview }) {
  const t = await getTranslations("Deletion");
  const sub = preview.parentId !== null;
  const empty = preview.subsections === 0 && preview.files === 0 && preview.withText === 0;

  return (
    <DangerZone
      id="delete-section-title"
      title={t(sub ? "section.zoneTitleSub" : "section.zoneTitle")}
      description={t(sub ? "section.zoneDescriptionSub" : "section.zoneDescription")}
    >
      <DeleteDialog
        action={deleteSection}
        id={preview.sectionId}
        labels={{
          trigger: t(sub ? "section.buttonSub" : "section.button"),
          title: t(sub ? "section.titleSub" : "section.title"),
          description: t("section.description", { title: preview.title }),
          confirm: t("section.confirm"),
          pending: t("section.pending"),
          cancel: t("cancel"),
        }}
      >
        {empty ? (
          <p className="text-muted-foreground">{t("section.nothing")}</p>
        ) : (
          <DeletionList
            title={t("section.contentsTitle")}
            items={[
              preview.subsections > 0 && t("section.subsections", { count: preview.subsections }),
              preview.withText > 0 && t("section.withText", { count: preview.withText }),
              preview.files > 0 && t("section.files", { count: preview.files }),
            ]}
          />
        )}
        <p className="text-muted-foreground">{t("aiUsageKept")}</p>
      </DeleteDialog>
    </DangerZone>
  );
}
