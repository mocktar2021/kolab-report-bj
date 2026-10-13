import { useFormatter, useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { RecentGeneration } from "@/lib/ai/metrics-server";
import { cn } from "@/lib/utils";
import { RolloutMarker } from "./metrics-table";
import { useMetricFormat } from "./use-metric-format";

/** Error codes of ai_generations that have a French label. */
const KNOWN_ERRORS = [
  "aborted",
  "timeout",
  "providerError",
  "invalidOutput",
  "saveFailed",
  "crashed",
  "contextFailed",
  "stale",
] as const;

type KnownError = (typeof KNOWN_ERRORS)[number];

function isKnownError(code: string): code is KnownError {
  return (KNOWN_ERRORS as readonly string[]).includes(code);
}

const DATE_FORMAT = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
} as const;

const STATUS_STYLES: Record<RecentGeneration["status"], string> = {
  running: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20",
  succeeded:
    "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20",
  failed: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20",
};

type RecentGenerationsProps = {
  generations: readonly RecentGeneration[];
  workspaceId: string;
  /** Whether the server builds links to the traces. */
  tracingLinks: boolean;
};

/** The latest generations of the workspace, whatever the period, with a link to their trace. */
export function RecentGenerations({ generations, workspaceId, tracingLinks }: RecentGenerationsProps) {
  const t = useTranslations("AiDashboard.recent");
  const format = useFormatter();
  const fmt = useMetricFormat();

  return (
    <section
      aria-labelledby="recent-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id="recent-title" className="font-medium">
          {t("title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
      </div>
      {generations.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {generations.map((generation) => {
            const date = format.dateTime(new Date(generation.createdAt), DATE_FORMAT);
            const latency = fmt.seconds(generation.latencyMs);
            const cost = fmt.cost(generation.cost);
            const facts = [
              latency,
              generation.totalTokens === null ? null : t("tokens", { count: generation.totalTokens }),
              cost,
            ].filter((fact): fact is string => fact !== null);
            const error =
              generation.status === "failed" && generation.errorCode
                ? isKnownError(generation.errorCode)
                  ? t(`errors.${generation.errorCode}`)
                  : t("unknownError", { code: generation.errorCode })
                : null;

            return (
              <li
                key={generation.id}
                className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={cn(
                        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                        STATUS_STYLES[generation.status],
                      )}
                    >
                      {t(`status.${generation.status}`)}
                    </span>
                    {generation.promptVersionId ? (
                      <Link
                        href={`/espaces/${workspaceId}/modeles/${generation.promptVersionId}`}
                        className="min-w-0 break-words rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {generation.promptTitle ?? t("noPrompt")}
                        {generation.promptVersion === null ? null : (
                          <span className="ml-1.5 text-muted-foreground">
                            {t("version", { version: generation.promptVersion })}
                          </span>
                        )}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{t("noPrompt")}</span>
                    )}
                    {generation.fromRollout ? <RolloutMarker label={t("fromRollout")} /> : null}
                  </p>
                  {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                    <time dateTime={generation.createdAt}>{date}</time>
                    <code className="break-all font-mono">{generation.model}</code>
                    {facts.map((fact) => (
                      <span key={fact}>{fact}</span>
                    ))}
                  </p>
                </div>
                {generation.traceUrl ? (
                  <a
                    href={generation.traceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("traceLabel", { date })}
                    className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md text-xs font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("trace")}
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {tracingLinks ? null : (
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">{t("tracingOff")}</p>
      )}
    </section>
  );
}
