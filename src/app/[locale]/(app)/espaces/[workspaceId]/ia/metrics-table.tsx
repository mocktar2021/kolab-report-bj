import { useTranslations } from "next-intl";
import { BarChart3 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { PromptMetrics } from "@/lib/ai/metrics-server";
import { cn } from "@/lib/utils";
import { GlobalBadge } from "../modeles/prompt-badges";
import { positiveShare, type MetricsSummary } from "./summary";
import { useMetricFormat } from "./use-metric-format";

/** Placeholder for a figure the period doesn't have yet, read out in full by screen readers. */
function NoData() {
  const t = useTranslations("AiDashboard");
  return (
    <span className="text-muted-foreground" title={t("noDataTitle")}>
      <span aria-hidden="true">{t("noData")}</span>
      <span className="sr-only">{t("noDataTitle")}</span>
    </span>
  );
}

/** Pill on the rows and generations served by a progressive rollout. */
export function RolloutMarker({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center whitespace-nowrap rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20"
    >
      {label}
    </span>
  );
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <li className="surface-card flex h-full flex-col rounded-2xl border p-4 shadow-sm sm:p-5">
      <span className="text-[0.8125rem] font-medium text-muted-foreground sm:text-sm">{label}</span>
      <span className="mt-4 font-display text-[2rem] font-normal leading-none tracking-[-0.03em] tabular-nums text-foreground">
        {value}
      </span>
      <span className="mt-auto pt-2 text-xs tabular-nums text-muted-foreground">{hint}</span>
    </li>
  );
}

/** The figures of the whole period, above the table. */
export function SummaryTiles({ summary, days }: { summary: MetricsSummary; days: number }) {
  const t = useTranslations("AiDashboard.summary");
  const fmt = useMetricFormat();
  const acceptance = fmt.percent(summary.acceptanceRate);
  const rating = fmt.percent(summary.positiveShare);
  const failure = fmt.percent(summary.failureRate);
  const cost = fmt.cost(summary.cost);

  return (
    <section aria-labelledby="summary-title" className="mt-8">
      <h2 id="summary-title" className="text-sm font-medium text-muted-foreground">
        {t("title", { days })}
      </h2>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        <Tile
          label={t("generations")}
          value={fmt.count(summary.generations)}
          hint={t("generationsHint", { count: summary.fromRollout })}
        />
        <Tile
          label={t("acceptance")}
          value={acceptance ?? <NoData />}
          hint={t("acceptanceHint", { count: summary.decided })}
        />
        <Tile
          label={t("rating")}
          value={rating ?? <NoData />}
          hint={t("ratingHint", { count: summary.rated })}
        />
        <Tile
          label={t("cost")}
          value={cost ?? <span className="text-base font-medium tracking-normal">{t("costMissing")}</span>}
          hint={cost ? t("costHint") : t("costMissingHint")}
        />
        <Tile
          label={t("failure")}
          value={failure ?? <NoData />}
          hint={
            summary.finished > 0
              ? t("failureHint", { count: summary.failed, finished: summary.finished })
              : t("failureNone")
          }
        />
      </ul>
    </section>
  );
}

/** Shown instead of the summary and the table when the period has no generation. */
export function EmptyMetrics({ days }: { days: number }) {
  const t = useTranslations("AiDashboard");

  return (
    <section className="surface-card mt-8 rounded-2xl border px-6 py-12 text-center shadow-sm">
      <BarChart3 className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-3 text-h3">{t("emptyTitle")}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("empty", { days })}</p>
    </section>
  );
}

const th = "px-3 py-2.5 text-right font-medium whitespace-nowrap";
const td = "px-3 py-3 text-right align-top tabular-nums whitespace-nowrap";

/** One figure and, below it, what it was computed from. */
function Figure({ value, detail }: { value: string | null; detail?: string }) {
  return (
    <>
      <span className="block font-medium text-foreground">{value ?? <NoData />}</span>
      {detail ? <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span> : null}
    </>
  );
}

/** Every metric of the period, one row per prompt version and model. */
export function MetricsTable({ rows, workspaceId }: { rows: readonly PromptMetrics[]; workspaceId: string }) {
  const t = useTranslations("AiDashboard.table");
  const tDashboard = useTranslations("AiDashboard");
  const fmt = useMetricFormat();
  const noCost = rows.every((row) => row.cost === null);

  return (
    <section
      aria-labelledby="metrics-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id="metrics-title" className="font-medium">
          {t("title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
      </div>
      {/* Scrolls sideways inside the card on narrow screens; the first column stays in view. */}
      <div
        role="region"
        aria-labelledby="metrics-title"
        tabIndex={0}
        className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <table className="w-full min-w-[64rem] text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card px-5 py-2.5 text-left font-medium">
                {t("prompt")}
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-medium">
                {t("model")}
              </th>
              <th scope="col" className={th}>
                {t("generations")}
              </th>
              <th scope="col" className={th}>
                {t("acceptance")}
              </th>
              <th scope="col" className={th}>
                {t("rating")}
              </th>
              <th scope="col" className={th}>
                {t("editRatio")}
              </th>
              <th scope="col" className={th}>
                {t("tokens")}
              </th>
              <th scope="col" className={th}>
                {t("cost")}
              </th>
              <th scope="col" className={th}>
                {t("latency")}
              </th>
              <th scope="col" className={cn(th, "pr-5")}>
                {t("failure")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={`${row.promptVersionId ?? "none"}:${row.model}`} className="hover:bg-muted/40">
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-[18rem] bg-card px-5 py-3 text-left align-top font-normal"
                >
                  {row.promptVersionId ? (
                    <Link
                      href={`/espaces/${workspaceId}/modeles/${row.promptVersionId}`}
                      className="rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="break-words">{row.title ?? t("unknownPrompt")}</span>
                      {row.version === null ? null : (
                        <span className="ml-1.5 text-muted-foreground">
                          {t("version", { version: row.version })}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t("unknownPrompt")}</span>
                  )}
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {row.scope === "global" ? <GlobalBadge /> : null}
                    {row.scope === "workspace" ? (
                      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {t("workspaceBadge")}
                      </span>
                    ) : null}
                    {row.fromRollout > 0 ? (
                      <RolloutMarker
                        label={t("fromRollout", { count: row.fromRollout })}
                        title={t("fromRolloutTitle", { count: row.fromRollout })}
                      />
                    ) : null}
                  </span>
                </th>
                <td className="px-3 py-3 align-top">
                  <code className="break-all font-mono text-xs">{row.model}</code>
                </td>
                <td className={td}>
                  <Figure value={fmt.count(row.generations)} />
                </td>
                <td className={td}>
                  <Figure
                    value={fmt.percent(row.acceptanceRate)}
                    detail={t("decided", { accepted: row.accepted, decided: row.accepted + row.discarded })}
                  />
                </td>
                <td className={td}>
                  <Figure
                    value={fmt.percent(positiveShare(row.meanRating))}
                    detail={t("rated", { count: row.rated })}
                  />
                </td>
                <td className={td}>
                  <Figure value={fmt.percent(row.meanEditRatio)} />
                </td>
                <td className={td}>
                  <Figure
                    value={t("pair", {
                      first: fmt.count(row.inputTokens),
                      second: fmt.count(row.outputTokens),
                    })}
                    detail={t("tokensTotal", { count: row.totalTokens })}
                  />
                </td>
                <td className={td}>
                  {noCost ? (
                    <span className="text-xs text-muted-foreground">{t("costMissing")}</span>
                  ) : (
                    <Figure value={fmt.cost(row.cost)} />
                  )}
                </td>
                <td className={td}>
                  {row.p50LatencyMs === null && row.p95LatencyMs === null ? (
                    <NoData />
                  ) : (
                    <Figure
                      value={t("pair", {
                        first: fmt.seconds(row.p50LatencyMs) ?? tDashboard("noData"),
                        second: fmt.seconds(row.p95LatencyMs) ?? tDashboard("noData"),
                      })}
                    />
                  )}
                </td>
                <td className={cn(td, "pr-5")}>
                  <Figure
                    value={fmt.percent(row.failureRate)}
                    detail={t("failedOf", { failed: row.failed, finished: row.succeeded + row.failed })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t px-5 py-3 text-xs text-muted-foreground">{t("legend")}</p>
    </section>
  );
}
