import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import type { ReportStatus } from "@/lib/reports/status";
import { cn } from "@/lib/utils";

// Draft and review are tinted like the section badges. Final is the solid ink
// pill with a lock, so the final version stands out on both themes.
const BADGE_STYLES: Record<ReportStatus, string> = {
  draft:
    "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/20",
  in_review: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20",
  final: "bg-primary text-primary-foreground ring-primary",
};

const DOT_STYLES: Record<Exclude<ReportStatus, "final">, string> = {
  draft: "bg-status-not-started",
  in_review: "bg-sky-600 dark:bg-sky-400",
};

type ReportStatusBadgeProps = {
  status: ReportStatus;
  className?: string;
};

/** Pill with the French label of a report status: Brouillon, En revue or Final. */
export function ReportStatusBadge({ status, className }: ReportStatusBadgeProps) {
  const t = useTranslations("ReportStatus.labels");

  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        BADGE_STYLES[status],
        className,
      )}
    >
      {status === "final" ? (
        <Lock className="size-3 shrink-0" aria-hidden="true" strokeWidth={2.5} />
      ) : (
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT_STYLES[status])} />
      )}
      {t(status)}
    </span>
  );
}
