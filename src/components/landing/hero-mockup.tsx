import { useTranslations } from "next-intl";
import { CalendarDays, Check, FileSpreadsheet, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { SectionStatus } from "@/lib/sections";
import { cn } from "@/lib/utils";
import { TiltStage } from "./tilt-stage";

type MockSection = {
  key: "summary" | "context" | "analysis" | "finance" | "recommendations";
  status: SectionStatus;
  initials: string | null;
};

// Sample report used only for the illustration. 2 completed and 2 in
// progress out of 5 equal-weight sections gives the 60 % shown.
const SECTIONS: MockSection[] = [
  { key: "summary", status: "completed", initials: "AK" },
  { key: "context", status: "completed", initials: "MB" },
  { key: "analysis", status: "in_progress", initials: "FD" },
  { key: "finance", status: "in_progress", initials: "JT" },
  { key: "recommendations", status: "not_started", initials: null },
];

const ACTIVE_SECTION: MockSection["key"] = "analysis";

const AVATAR_TONES = [
  "bg-zinc-900 text-white",
  "bg-zinc-200 text-zinc-800",
  "bg-zinc-700 text-white",
  "bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-200",
];

function Avatar({ initials, index }: { initials: string; index: number }) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        AVATAR_TONES[index % AVATAR_TONES.length],
      )}
    >
      {initials}
    </span>
  );
}

function CompletionRing({ value }: { value: number }) {
  return (
    <svg viewBox="0 0 36 36" className="size-12 -rotate-90" aria-hidden="true">
      <circle cx="18" cy="18" r="15.5" className="fill-none stroke-zinc-200" strokeWidth="3.5" />
      <circle
        cx="18"
        cy="18"
        r="15.5"
        pathLength={100}
        strokeDasharray={`${value} 100`}
        strokeLinecap="round"
        className="fill-none stroke-zinc-900"
        strokeWidth="3.5"
      />
    </svg>
  );
}

/** Static HTML illustration of the app: report outline, progress and an AI draft. */
export function HeroMockup() {
  const t = useTranslations("Landing.mockup");

  return (
    <div
      role="img"
      aria-label={t("label")}
      className="relative mx-auto mt-16 max-w-5xl px-4 pb-8 sm:mt-20 sm:px-6 sm:pb-36"
    >
      {/* Ground shadow under the floating window. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-[12%] bottom-16 h-24 rounded-[50%] bg-zinc-900/20 blur-3xl sm:bottom-20"
      />

      <TiltStage>
        <div className="relative rounded-[1.75rem] border border-black/5 bg-white/60 p-1.5 shadow-float ring-1 ring-white/60 backdrop-blur-sm sm:p-2">
          <div className="overflow-hidden rounded-[1.375rem] border bg-card">
            {/* Window bar */}
            <div className="flex items-center gap-3 border-b bg-zinc-50/80 px-4 py-3">
              <div aria-hidden="true" className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-zinc-300" />
                <span className="size-2.5 rounded-full bg-zinc-300" />
                <span className="size-2.5 rounded-full bg-zinc-300" />
              </div>
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {t("breadcrumb")} <span className="px-1 text-zinc-300">/</span>
                <span className="font-medium text-foreground">{t("reportTitle")}</span>
              </p>
              <div className="ml-auto hidden -space-x-0.5 sm:flex">
                {SECTIONS.flatMap((section, index) =>
                  section.initials ? (
                    <span key={section.key} className="rounded-full ring-2 ring-zinc-50">
                      <Avatar initials={section.initials} index={index} />
                    </span>
                  ) : [],
                )}
              </div>
            </div>

            <div className="grid md:grid-cols-[13.5rem_1fr]">
              {/* Outline */}
              <aside className="hidden border-r bg-zinc-50/50 p-4 md:block">
                <p className="px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("outline")}
                </p>
                <ol className="mt-3 space-y-0.5">
                  {SECTIONS.map((section, index) => {
                    const active = section.key === ACTIVE_SECTION;
                    return (
                      <li
                        key={section.key}
                        className={cn(
                          "relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px]",
                          active ? "bg-white font-medium text-foreground shadow-sm ring-1 ring-black/5" : "text-muted-foreground",
                        )}
                      >
                        {active ? (
                          <span className="absolute -left-4 top-2 h-5 w-0.5 rounded-full bg-primary shadow-glow" />
                        ) : null}
                        <span className="w-4 text-right tabular-nums text-zinc-400">{index + 1}</span>
                        <span className="truncate">{t(`sections.${section.key}`)}</span>
                        <span
                          className={cn(
                            "ml-auto size-1.5 shrink-0 rounded-full",
                            section.status === "completed" && "bg-emerald-500",
                            section.status === "in_progress" && "bg-amber-500",
                            section.status === "not_started" && "bg-slate-300",
                          )}
                        />
                      </li>
                    );
                  })}
                </ol>
              </aside>

              {/* Report. The extra bottom padding leaves room for the AI card. */}
              <div className="p-4 sm:p-6 sm:pb-16">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold tracking-[-0.01em] sm:text-lg">
                      {t("reportTitle")}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("reportMeta")}</p>
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl border bg-zinc-50/70 py-1.5 pl-1.5 pr-4">
                    <div className="relative">
                      <CompletionRing value={60} />
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums">
                        60
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-medium">
                        {t("progress")} <span className="tabular-nums">{t("progressValue")}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">{t("progressDetail")}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 overflow-hidden rounded-xl border">
                  <div className="hidden grid-cols-[1fr_5rem_8.5rem] gap-3 border-b bg-zinc-50/70 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:grid">
                    <span>{t("columnSection")}</span>
                    <span>{t("columnExpert")}</span>
                    <span>{t("columnStatus")}</span>
                  </div>
                  <ul className="divide-y">
                    {SECTIONS.map((section, index) => (
                      <li
                        key={section.key}
                        className={cn(
                          "grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 text-[13px] sm:grid-cols-[1fr_5rem_8.5rem] sm:px-4",
                          section.key === ACTIVE_SECTION && "bg-zinc-50/80",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="w-4 shrink-0 text-right tabular-nums text-zinc-400">{index + 1}</span>
                          <span className="truncate font-medium">{t(`sections.${section.key}`)}</span>
                        </span>
                        <span className="hidden sm:block">
                          {section.initials ? (
                            <Avatar initials={section.initials} index={index} />
                          ) : (
                            <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-zinc-300" />
                          )}
                        </span>
                        <span>
                          <StatusBadge status={section.status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5" aria-hidden="true" />
                  {t("dueDate")}
                </p>
              </div>
            </div>
          </div>

          {/* Glass highlight across the top-left corner. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[1.75rem] bg-gradient-to-br from-white/50 via-white/0 to-white/0"
          />
        </div>

        {/* Upload notification, over the empty end of the outline column. */}
        <div className="absolute -left-8 bottom-10 hidden items-center gap-3 rounded-2xl border bg-white/95 py-2 pl-2 pr-4 shadow-lg md:flex">
          <span className="flex size-8 items-center justify-center rounded-xl bg-zinc-900 text-white">
            <FileSpreadsheet className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium">{t("uploadFile")}</span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Check className="size-3 text-emerald-600" aria-hidden="true" />
              {t("uploadTitle")}
            </span>
          </span>
        </div>

        {/* AI draft card. In the flow on phones, floating over the corner from sm up. */}
        <div className="relative z-10 -mt-6 ml-auto mr-3 w-[min(19rem,calc(100%-1.5rem))] rounded-2xl border bg-white/95 p-4 shadow-xl sm:absolute sm:-bottom-28 sm:-right-6 sm:mr-0 sm:mt-0 sm:w-80">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold text-white">
              <Sparkles className="size-3" aria-hidden="true" />
              {t("aiBadge")}
            </span>
            <p className="text-xs font-semibold">{t("aiTitle")}</p>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("aiMeta")}</p>
          <p className="mt-3 text-xs leading-relaxed text-zinc-700">{t("aiExcerpt")}</p>
          <span
            aria-hidden="true"
            className="mt-2 block h-1.5 w-2/3 origin-left rounded-full bg-zinc-200 motion-safe:animate-grow-x"
          />
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="truncate rounded-full border bg-zinc-50 px-2 py-0.5 text-[10px] text-muted-foreground">
              {t("aiPrompt")}
            </span>
            <span className="shrink-0 rounded-full bg-zinc-900 px-2.5 py-1 text-[10px] font-medium text-white">
              {t("aiReview")}
            </span>
          </div>
        </div>
      </TiltStage>
    </div>
  );
}
