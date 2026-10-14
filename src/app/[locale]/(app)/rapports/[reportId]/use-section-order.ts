import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { reorderSections, type ReorderResult } from "./actions";

type LocalOrder = {
  /** The server list this order was made from. */
  base: readonly { id: string }[];
  ids: string[];
};

/**
 * Order of the sections on the page, moved right away when a manager drops a
 * section and saved in the background. One save runs at a time. A failed save
 * puts the server order back; "stale" also reloads the page data, since
 * another session changed the list, and so does "reportFinal", since the
 * report became final meanwhile.
 *
 * The local order only applies to the list it was made from: any new list from
 * the server (the save itself, or a refresh from another session) wins.
 */
export function useSectionOrder<T extends { id: string }>(reportId: string, sections: T[]) {
  const router = useRouter();
  const [local, setLocal] = useState<LocalOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ReorderResult | null>(null);
  const savingRef = useRef(false);

  const ordered = useMemo(() => {
    if (!local || local.base !== sections) return sections;
    const byId = new Map(sections.map((section) => [section.id, section]));
    return local.ids.flatMap((id) => {
      const section = byId.get(id);
      return section ? [section] : [];
    });
  }, [local, sections]);

  const reorder = useCallback(
    async (sectionIds: string[]) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      setResult(null);
      setLocal({ base: sections, ids: sectionIds });

      let outcome: ReorderResult;
      try {
        outcome = await reorderSections(reportId, sectionIds);
      } catch {
        // The action did not answer, for example after a network error.
        outcome = { ok: false, error: "generic" };
      }

      savingRef.current = false;
      setSaving(false);
      setResult(outcome);
      if (!outcome.ok) {
        setLocal(null);
        if (outcome.error === "stale" || outcome.error === "reportFinal") router.refresh();
      }
    },
    [reportId, sections, router],
  );

  return { sections: ordered, reorder, saving, result };
}
