import { useTranslations } from "next-intl";
import type { SectionStatus } from "@/lib/sections";
import { cn } from "@/lib/utils";

const BADGE_STYLES: Record<SectionStatus, string> = {
  not_started:
    "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/20",
  in_progress:
    "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20",
  completed:
    "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20",
};

export const STATUS_DOT_STYLES: Record<SectionStatus, string> = {
  not_started: "bg-slate-400",
  in_progress: "bg-amber-500",
  completed: "bg-emerald-500",
};

type StatusBadgeProps = {
  status: SectionStatus;
  className?: string;
};

/** Softly tinted pill with the French label of a section status. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const t = useTranslations("SectionStatus");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        BADGE_STYLES[status],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", STATUS_DOT_STYLES[status])} />
      {t(status)}
    </span>
  );
}
