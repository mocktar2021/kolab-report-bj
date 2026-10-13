"use client";

import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** parse_status, plus "stale" for a read that stopped answering. */
export type ParseState = "pending" | "processing" | "parsed" | "failed" | "skipped" | "stale";

const STYLES: Record<ParseState, string> = {
  pending:
    "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/20",
  processing:
    "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20",
  parsed:
    "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20",
  failed: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20",
  stale: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20",
  skipped: "bg-transparent text-muted-foreground ring-border",
};

export function ParseBadge({ state }: { state: ParseState }) {
  const t = useTranslations("Deliverables");
  const label = t(`parse.${state}`);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        STYLES[state],
      )}
      title={t("parseBadgeLabel", { status: label })}
    >
      {state === "processing" ? (
        <LoaderCircle className="size-3 motion-safe:animate-spin" aria-hidden="true" />
      ) : null}
      {label}
    </span>
  );
}
