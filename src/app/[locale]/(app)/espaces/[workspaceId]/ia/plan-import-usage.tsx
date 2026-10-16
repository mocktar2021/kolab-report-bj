import { useTranslations } from "next-intl";
import { FileUp } from "lucide-react";
import type { PlanImportUsage as Usage } from "@/lib/ai/metrics-server";
import { useMetricFormat } from "./use-metric-format";

/**
 * The AI readings of PDF plans in the period (KRB-196), apart from the
 * drafts: each one counts as an AI draft of the plan but writes no section,
 * so it has no acceptance or rating. One line per model with readings,
 * failures, tokens and cost.
 */
export function PlanImportUsage({ rows, days }: { rows: readonly Usage[]; days: number }) {
  const t = useTranslations("AiDashboard.planImport");
  const fmt = useMetricFormat();

  return (
    <section
      aria-labelledby="plan-import-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id="plan-import-title" className="flex items-center gap-2 font-medium">
          <FileUp className="size-4 text-highlight" aria-hidden="true" />
          {t("title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("description", { days })}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => {
            const cost = fmt.cost(row.cost);
            return (
              <li
                key={row.model}
                className="flex flex-col gap-1 px-5 py-3.5 text-sm sm:flex-row sm:items-baseline sm:gap-4"
              >
                <span className="min-w-0 break-all font-mono text-xs text-muted-foreground sm:w-56 sm:shrink-0">
                  {row.model}
                </span>
                <span className="font-medium">{t("calls", { count: row.calls })}</span>
                <span className="text-muted-foreground">{t("failed", { count: row.failed })}</span>
                <span className="text-muted-foreground">
                  {t("tokens", { input: fmt.count(row.inputTokens), output: fmt.count(row.outputTokens) })}
                </span>
                <span className="sm:ml-auto">{cost === null ? t("costMissing") : t("cost", { cost })}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
