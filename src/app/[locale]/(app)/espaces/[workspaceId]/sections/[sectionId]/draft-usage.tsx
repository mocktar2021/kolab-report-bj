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
 * Says that the deliverables didn't all fit in the context. With `list`, it
 * also names the ones that were cut and how.
 */
export function TruncationNotice({ deliverables, list }: { deliverables: DeliverableUse[]; list: boolean }) {
  const t = useTranslations("AiDraft");
  const notesOf = useNotes();
  const affected = list
    ? deliverables.flatMap((use) => {
        const note = notesOf(use);
        return note ? [{ use, note }] : [];
      })
    : [];

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
      <p className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{t("truncated")}</span>
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
