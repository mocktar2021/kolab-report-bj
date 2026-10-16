import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import type { TemplateWriterUsage as Usage } from "@/lib/ai/metrics-server";
import { useMetricFormat } from "./use-metric-format";

/**
 * The "Rédiger avec l'IA" calls of the period (KRB-198), apart from the
 * drafts: they write a template, not a section, so they have no acceptance
 * or rating. One line per model with calls, failures, tokens and cost.
 */
export function TemplateWriterUsage({ rows, days }: { rows: readonly Usage[]; days: number }) {
  const t = useTranslations("AiDashboard.writer");
  const fmt = useMetricFormat();

  return (
    <section
      aria-labelledby="writer-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id="writer-title" className="flex items-center gap-2 font-medium">
          <Sparkles className="size-4 text-highlight" aria-hidden="true" />
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
                  {t("tokens", { input: row.inputTokens, output: row.outputTokens })}
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
