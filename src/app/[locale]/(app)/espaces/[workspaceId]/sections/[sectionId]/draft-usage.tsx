import { useTranslations } from "next-intl";
import { FileText, TriangleAlert } from "lucide-react";
import type { DeliverableUse } from "@/lib/ai/types";

/** What the context builder did to a deliverable, or null when it went in whole. */
function useNotes() {
  const t = useTranslations("AiDraft.usage");
  return (use: DeliverableUse): string | null => {
    if (use.dropped) return t("dropped");
    const notes = [
      use.summarized ? t("summarized") : null,
      use.rowsCut > 0 ? t("rowsCut", { count: use.rowsCut }) : null,
    ].filter((note): note is string => note !== null);
    if (notes.length === 0 && use.truncated) notes.push(t("cut"));
    return notes.length > 0 ? notes.join(", ") : null;
  };
}

function UsageItem({ use, note }: { use: DeliverableUse; note: string | null }) {
  return (
    <li className="flex min-w-0 items-start gap-2">
      <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 break-words">
        <span className="font-medium">{use.fileName}</span>
        {note ? <span className="text-muted-foreground"> ({note})</span> : null}
      </span>
    </li>
  );
}

/**
 * One sentence per reason the deliverables didn't all go in whole (KRB-250):
 * a table over the row cap is not a lack of room, so it gets its own words.
 * A file can count for rows and for length when both happened to it.
 */
function useReasons() {
  const t = useTranslations("AiDraft.truncation");
  return (deliverables: DeliverableUse[]): string[] => {
    const dropped = deliverables.filter((use) => use.dropped).length;
    const kept = deliverables.filter((use) => !use.dropped);
    const rows = kept.filter((use) => use.rowsCut > 0).length;
    const long = kept.filter((use) => use.summarized || (use.truncated && use.rowsCut === 0)).length;
    const reasons = [
      rows > 0 ? t("rows", { count: rows }) : null,
      long > 0 ? t("long", { count: long }) : null,
      dropped > 0 ? t("dropped", { count: dropped }) : null,
    ].filter((reason): reason is string => reason !== null);
    return reasons.length > 0 ? reasons : [t("other")];
  };
}

/**
 * Says why the deliverables didn't all go in whole. With `list`, it also
 * names the ones that were cut and how; without, it points to the sources
 * list under the draft, which has the same notes.
 */
export function TruncationNotice({ deliverables, list }: { deliverables: DeliverableUse[]; list: boolean }) {
  const t = useTranslations("AiDraft.truncation");
  const notesOf = useNotes();
  const reasonsOf = useReasons();
  const affected = list
    ? deliverables.flatMap((use) => {
        const note = notesOf(use);
        return note ? [{ use, note }] : [];
      })
    : [];
  const text = [...reasonsOf(deliverables), list ? t("missing") : t("details")].join(" ");

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
      <p className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{text}</span>
      </p>
      {affected.length > 0 ? (
        <ul className="mt-2 space-y-1 pl-6 text-xs">
          {affected.map(({ use, note }) => (
            <li key={use.ref} className="break-words">
              <span className="font-medium">{use.fileName}</span> ({note})
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The deliverables a draft was written from, in context order, with what was cut from each. */
export function SourcesList({
  deliverables,
  headingId,
}: {
  deliverables: DeliverableUse[];
  headingId: string;
}) {
  const t = useTranslations("AiDraft");
  const notesOf = useNotes();

  return (
    <div>
      <h4 id={headingId} className="text-xs font-medium text-muted-foreground">
        {t("sourcesTitle")}
      </h4>
      <ul aria-labelledby={headingId} className="mt-2 space-y-1.5 text-sm">
        {deliverables.map((use) => (
          <UsageItem key={use.ref} use={use} note={notesOf(use)} />
        ))}
      </ul>
    </div>
  );
}
