"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, LoaderCircle } from "lucide-react";
import { renumber } from "@/lib/section-outline";
import type { ReorderResult } from "./actions";
import { ReportDocument, type ReportSection } from "./report-document";
import { SectionList, type Assignee } from "./section-list";
import { useSectionOrder } from "./use-section-order";

type MasterReportProps = {
  reportId: string;
  workspaceId: string;
  sections: ReportSection[];
  assignees: Assignee[];
  canManage: boolean;
  /**
   * The report is final (KRB-20): no reordering, assignment, new section or
   * edit link, for managers too.
   */
  frozen?: boolean;
  /** Shown between the table of contents and the text, for managers. */
  addSectionForm?: ReactNode;
};

/**
 * The table of contents and the text of the report, in the same order. A
 * manager's new order shows in both right away, while it is saved.
 */
export function MasterReport({
  reportId,
  workspaceId,
  sections,
  assignees,
  canManage,
  frozen = false,
  addSectionForm,
}: MasterReportProps) {
  const order = useSectionOrder(reportId, sections);
  const manage = canManage && !frozen;
  // A new order shows its numbers right away (1, 1.1, 2), not after the save.
  const shown = useMemo(
    () =>
      renumber(frozen ? order.sections.map((section) => ({ ...section, canEdit: false })) : order.sections),
    [frozen, order.sections],
  );

  return (
    <>
      <SectionList
        workspaceId={workspaceId}
        sections={shown}
        assignees={assignees}
        canManage={manage}
        onReorder={manage ? order.reorder : undefined}
        reorderBusy={order.saving}
        reorderStatus={manage ? <ReorderStatus saving={order.saving} result={order.result} /> : undefined}
      />
      {manage ? addSectionForm : null}
      <ReportDocument workspaceId={workspaceId} sections={shown} />
    </>
  );
}

/** Always rendered, so screen readers hear each change of the live region. */
function ReorderStatus({ saving, result }: { saving: boolean; result: ReorderResult | null }) {
  const t = useTranslations("Report.reorder");

  return (
    <p role="status" aria-live="polite" className="w-full text-xs">
      {saving ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
          {t("saving")}
        </span>
      ) : result?.ok ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Check className="size-3.5" aria-hidden="true" />
          {t("saved")}
        </span>
      ) : result ? (
        <span className="text-destructive">{t(`errors.${result.error}`)}</span>
      ) : null}
    </p>
  );
}
