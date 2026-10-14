import { useFormatter, useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { STATUS_DOT_STYLES } from "@/components/status-badge";
import { Link } from "@/i18n/navigation";
import { SECTION_STATUSES, type SectionStatus } from "@/lib/sections";
import { cn } from "@/lib/utils";

// The cards rise one after the other with CSS, so they show on first paint.
// With the motion library they stayed transparent until hydration, and its
// per-frame work blocked the main thread on phones (KRB-154).
const ENTER =
  "motion-safe:animate-in motion-safe:fade-in-50 motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-out-expo";
const STEP_MS = 60;

// Large figures in the display face, light and tightly tracked.
const valueClass =
  "mt-5 font-display text-[2.5rem] font-normal leading-none tracking-[-0.03em] tabular-nums text-foreground sm:text-[2.75rem]";

type KpiCardsProps = {
  counts: Record<SectionStatus, number>;
  totalSections: number;
  completionPercent: number;
  reportsWithSections: number;
  activeStatus: SectionStatus | null;
};

export function KpiCards({
  counts,
  totalSections,
  completionPercent,
  reportsWithSections,
  activeStatus,
}: KpiCardsProps) {
  const t = useTranslations("Dashboard");
  const tFilters = useTranslations("Dashboard.filters");
  const format = useFormatter();

  return (
    <section aria-label={t("kpiLabel")} className="mt-8">
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {SECTION_STATUSES.map((status, index) => {
          const active = status === activeStatus;
          const share = totalSections > 0 ? counts[status] / totalSections : 0;
          return (
            <li key={status} className={ENTER} style={{ animationDelay: `${index * STEP_MS}ms` }}>
              <Link
                href={`/tableau-de-bord?statut=${status}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "surface-card lift group relative flex h-full cursor-pointer flex-col rounded-2xl border p-4 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-5",
                  active
                    ? "border-highlight/50 shadow-md ring-1 ring-highlight/30"
                    : "hover:border-foreground/20",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground sm:text-sm">
                    <span
                      aria-hidden="true"
                      className={cn("size-2 shrink-0 rounded-full", STATUS_DOT_STYLES[status])}
                    />
                    <span className="truncate">{tFilters(status)}</span>
                  </span>
                  {active ? (
                    <span className="hidden shrink-0 rounded-full bg-highlight/10 px-2 py-0.5 text-[11px] font-medium text-highlight sm:inline">
                      {t("activeFilter")}
                    </span>
                  ) : (
                    <ArrowUpRight
                      aria-hidden="true"
                      className="hidden size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100 sm:block"
                    />
                  )}
                </span>
                <span className={valueClass}>{format.number(counts[status])}</span>
                <span className="mt-auto pt-2 text-xs tabular-nums text-muted-foreground">
                  {t("share", { percent: format.number(share, "percent") })}
                </span>
              </Link>
            </li>
          );
        })}
        <li className={ENTER} style={{ animationDelay: `${SECTION_STATUSES.length * STEP_MS}ms` }}>
          <div className="surface-card flex h-full flex-col rounded-2xl border p-4 shadow-sm sm:p-5">
            <span className="text-[0.8125rem] font-medium text-muted-foreground sm:text-sm">
              {t("completion")}
            </span>
            <span className={valueClass}>{format.number(completionPercent / 100, "percent")}</span>
            <span aria-hidden="true" className="mt-3 block h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full origin-left rounded-full bg-highlight motion-safe:animate-in motion-safe:slide-in-from-left-full motion-safe:duration-1000 motion-safe:ease-out-expo"
                style={{ width: `${Math.min(100, Math.max(0, completionPercent))}%` }}
              />
            </span>
            <span className="mt-auto pt-2 text-xs text-muted-foreground">
              {t("completionHint", { count: reportsWithSections })}
            </span>
          </div>
        </li>
      </ul>
    </section>
  );
}
