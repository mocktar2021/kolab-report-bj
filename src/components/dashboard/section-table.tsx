import { useFormatter, useTranslations } from "next-intl";
import { AlertCircle, Inbox } from "lucide-react";
import { initialsOf } from "@/components/app-shell/user-avatar";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { DashboardSection } from "@/lib/dashboard";
import { SECTION_STATUSES, type SectionStatus } from "@/lib/sections";
import { cn } from "@/lib/utils";

const DATE_FORMAT = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} as const;

type SectionTableProps = {
  sections: DashboardSection[];
  matchingSections: number;
  activeStatus: SectionStatus | null;
};

export function SectionTable({ sections, matchingSections, activeStatus }: SectionTableProps) {
  const t = useTranslations("Dashboard");
  const format = useFormatter();

  return (
    <section
      aria-labelledby="sections-title"
      className="mt-8 overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      <SectionTableHeader count={matchingSections} activeStatus={activeStatus} />

      {sections.length === 0 ? (
        <EmptyState activeStatus={activeStatus} />
      ) : (
        <>
          <table className="hidden w-full text-sm md:table">
            <caption className="sr-only">{t("table.caption")}</caption>
            <thead className="border-b bg-muted/40 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  {t("table.section")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  {t("table.report")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  {t("table.expert")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  {t("table.status")}
                </th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">
                  {t("table.updatedAt")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sections.map((section) => (
                <tr key={section.id} className="transition-colors duration-200 hover:bg-muted/50">
                  <td className="max-w-[18rem] px-5 py-3.5">
                    <span className="block truncate font-medium text-foreground" title={section.title}>
                      {section.title}
                    </span>
                  </td>
                  <td className="max-w-[14rem] px-3 py-3.5 text-muted-foreground">
                    <span className="block truncate" title={section.reportTitle ?? undefined}>
                      {section.reportTitle}
                    </span>
                  </td>
                  <td className="px-3 py-3.5">
                    <Assignee assignee={section.assignee} />
                  </td>
                  <td className="px-3 py-3.5">
                    <StatusBadge status={section.status} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                    <time dateTime={section.updatedAt}>
                      {format.dateTime(new Date(section.updatedAt), DATE_FORMAT)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-y md:hidden">
            {sections.map((section) => (
              <li key={section.id} className="px-4 py-4 transition-colors hover:bg-muted/50">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-medium leading-snug text-foreground">{section.title}</p>
                  <StatusBadge status={section.status} className="shrink-0" />
                </div>
                {section.reportTitle ? (
                  <p className="mt-1 truncate text-sm text-muted-foreground">{section.reportTitle}</p>
                ) : null}
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <Assignee assignee={section.assignee} compact />
                  <time dateTime={section.updatedAt} className="shrink-0 tabular-nums">
                    {format.dateTime(new Date(section.updatedAt), DATE_FORMAT)}
                  </time>
                </div>
              </li>
            ))}
          </ul>

          {matchingSections > sections.length ? (
            <p className="border-t px-5 py-3 text-xs text-muted-foreground">
              {t("table.truncated", {
                shown: format.number(sections.length),
                total: format.number(matchingSections),
              })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function SectionTableHeader({
  count,
  activeStatus,
}: {
  count: number;
  activeStatus: SectionStatus | null;
}) {
  const t = useTranslations("Dashboard");
  const filters: { key: "all" | SectionStatus; href: string }[] = [
    { key: "all", href: "/tableau-de-bord" },
    ...SECTION_STATUSES.map((status) => ({
      key: status,
      href: `/tableau-de-bord?statut=${status}`,
    })),
  ];

  return (
    <div className="flex flex-col gap-3 border-b px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 id="sections-title" className="text-h3 text-foreground">
          {t("table.title")}
        </h2>
        <p className="text-xs tabular-nums text-muted-foreground">{t("table.count", { count })}</p>
      </div>
      {/* Fits a 390px screen; scrolls sideways on anything narrower. */}
      <nav
        aria-label={t("filters.label")}
        className="-mx-4 min-w-0 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-5 sm:px-5 md:mx-0 md:px-0"
      >
        <ul className="flex w-max gap-1 rounded-full bg-muted p-1">
          {filters.map(({ key, href }) => {
            const active = key === "all" ? activeStatus === null : key === activeStatus;
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-7 items-center whitespace-nowrap rounded-full px-2 text-xs font-medium sm:px-3 outline-none transition-[color,background-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-card text-primary shadow-sm ring-1 ring-black/5 dark:ring-white/10"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`filters.${key}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function Assignee({
  assignee,
  compact = false,
}: {
  assignee: DashboardSection["assignee"];
  compact?: boolean;
}) {
  const t = useTranslations("Dashboard.table");

  if (!assignee) {
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <span
          aria-hidden="true"
          className="size-6 shrink-0 rounded-full border border-dashed border-zinc-300 dark:border-zinc-600"
        />
        {t("unassigned")}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2" title={assignee.email}>
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-700 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700"
      >
        {initialsOf(assignee.name)}
      </span>
      <span className={cn("truncate", !compact && "max-w-[12rem] text-foreground")}>{assignee.name}</span>
    </span>
  );
}

function EmptyState({ activeStatus }: { activeStatus: SectionStatus | null }) {
  const t = useTranslations("Dashboard.empty");
  const tStatus = useTranslations("SectionStatus");

  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl border bg-muted/60 shadow-sm">
        <Inbox className="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-h3 text-foreground">
        {activeStatus ? t("filteredTitle", { status: tStatus(activeStatus) }) : t("title")}
      </h3>
      <p className="mt-1.5 max-w-md text-small text-muted-foreground">
        {activeStatus ? t("filteredDescription") : t("description")}
      </p>
      {activeStatus ? (
        <Button asChild variant="outline" shape="pill" className="mt-6">
          <Link href="/tableau-de-bord">{t("clearFilter")}</Link>
        </Button>
      ) : null}
    </div>
  );
}

/** Shown when a Supabase query fails, instead of an error page. */
export function SectionsError() {
  const t = useTranslations("Dashboard.error");

  return (
    <section
      role="alert"
      className="mt-8 flex flex-col items-center rounded-2xl border bg-card px-6 py-16 text-center shadow-sm"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl border bg-muted/60">
        <AlertCircle className="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-h3 text-foreground">{t("title")}</h2>
      <p className="mt-1.5 max-w-md text-small text-muted-foreground">{t("description")}</p>
      <Button asChild variant="outline" shape="pill" className="mt-6">
        {/* Full reload on purpose: retries every query, not just a client transition. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/fr/tableau-de-bord">{t("retry")}</a>
      </Button>
    </section>
  );
}
