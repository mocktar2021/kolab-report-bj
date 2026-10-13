import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type PeriodSwitchProps = {
  periods: readonly number[];
  current: number;
  workspaceId: string;
};

/** Links to the same page over 7, 30 or 90 days (?periode=). */
export function PeriodSwitch({ periods, current, workspaceId }: PeriodSwitchProps) {
  const t = useTranslations("AiDashboard");

  return (
    <nav aria-label={t("periodLabel")} className="shrink-0">
      <ul className="flex w-max gap-1 rounded-full bg-muted p-1">
        {periods.map((days) => {
          const active = days === current;
          return (
            <li key={days}>
              <Link
                href={`/espaces/${workspaceId}/ia?periode=${days}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-7 items-center whitespace-nowrap rounded-full px-3 text-xs font-medium outline-none transition-[color,background-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-card text-highlight shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("period", { days })}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
