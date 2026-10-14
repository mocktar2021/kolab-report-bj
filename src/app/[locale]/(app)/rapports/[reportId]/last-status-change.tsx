import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReportStatus } from "@/lib/reports/status";
import type { ReportStatusChange } from "@/lib/reports/workflow";
import { cn } from "@/lib/utils";

type LastStatusChangeProps = {
  status: ReportStatus;
  change: Pick<ReportStatusChange, "to" | "at" | "byName"> | null;
  className?: string;
};

/**
 * "Final depuis le 14 octobre 2026 à 10:32, par Fatou Dossou". Nothing for a
 * report that never changed status, or when the last change is not the
 * current status.
 */
export function LastStatusChange({ status, change, className }: LastStatusChangeProps) {
  const t = useTranslations("ReportStatus");
  const format = useFormatter();
  if (!change || change.to !== status) return null;

  const date = format.dateTime(new Date(change.at), { dateStyle: "long", timeStyle: "short" });
  const time = (chunks: ReactNode) => <time dateTime={change.at}>{chunks}</time>;

  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {change.byName
        ? t.rich(`sinceBy.${status}`, { date, name: change.byName, time })
        : t.rich(`since.${status}`, { date, time })}
    </p>
  );
}
