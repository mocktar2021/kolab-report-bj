import { useTranslations } from "next-intl";
import type { PromptStatus } from "@/lib/prompts/catalog";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<PromptStatus, { badge: string; dot: string }> = {
  published: {
    badge:
      "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20",
    dot: "bg-status-completed",
  },
  draft: {
    badge:
      "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20",
    dot: "bg-status-in-progress",
  },
  archived: {
    badge:
      "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/20",
    dot: "bg-status-not-started",
  },
};

/** Pill with the French label of a template or version status. */
export function PromptStatusBadge({ status, className }: { status: PromptStatus; className?: string }) {
  const t = useTranslations("Prompts.status");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        STATUS_STYLES[status].badge,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", STATUS_STYLES[status].dot)} />
      {t(status)}
    </span>
  );
}

/** Marks a template that ships with KolabReport and that no one edits from the app. */
export function GlobalBadge({ className }: { className?: string }) {
  const t = useTranslations("Prompts");

  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full bg-highlight/10 px-2 py-0.5 text-[11px] font-medium text-highlight",
        className,
      )}
    >
      {t("globalBadge")}
    </span>
  );
}
