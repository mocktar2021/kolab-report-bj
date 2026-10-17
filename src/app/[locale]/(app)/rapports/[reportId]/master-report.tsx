"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, LoaderCircle } from "lucide-react";
import { renumber } from "@/lib/section-outline";
import type { ReorderResult } from "./actions";
import { ReportDocument, type ReportSection } from "./report-document";
import { SectionList, sectionAnchor, type Assignee } from "./section-list";
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
 * manager's new order shows in both right away, while it is saved. The text
 * stays hidden until "Aperçu" or a link to one of its sections (KRB-201).
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
  const [textOpen, setTextOpen] = useState(false);
  // The section a link opened the text for, to scroll to once it shows.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  // A link of the table of contents: the text shows before the browser follows it.
  const openForLink = useCallback(() => flushSync(() => setTextOpen(true)), []);

  // A link to a section from elsewhere (#section-…), when the page loads or later.
  useEffect(() => {
    function openForHash() {
      const anchor = window.location.hash.slice(1);
      // Already on screen: the browser went to it.
      if (!anchor.startsWith(sectionAnchor("")) || document.getElementById(anchor)) return;
      setTextOpen(true);
      setScrollTarget(anchor);
    }
    openForHash();
    window.addEventListener("hashchange", openForHash);
    return () => window.removeEventListener("hashchange", openForHash);
  }, []);

  useEffect(() => {
    if (!textOpen || !scrollTarget) return;
    document.getElementById(scrollTarget)?.scrollIntoView();
    setScrollTarget(null);
  }, [textOpen, scrollTarget]);

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
        onSectionLink={openForLink}
      />
      {manage ? addSectionForm : null}
      <ReportDocument workspaceId={workspaceId} sections={shown} open={textOpen} onOpenChange={setTextOpen} />
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
