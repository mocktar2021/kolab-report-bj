import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";
import { STATUS_DOT_STYLES } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { EdgeLines } from "./edge-lines";
import { MockCard, MockLabel, ProgressRing, SAMPLE_PROGRESS, SAMPLE_SECTIONS } from "./mock-ui";

function MasterOutlineCard() {
  const t = useTranslations("Landing.progress");
  const sections = useTranslations("Landing.sample.sections");

  return (
    <MockCard className="p-5">
      <MockLabel>{t("outlineTitle")}</MockLabel>
      <ol className="mt-3 space-y-2 text-[13px]">
        {SAMPLE_SECTIONS.map((section, index) => (
          <li key={section.key} className="flex items-center gap-3">
            <span className="w-3 text-right tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate">{sections(section.key)}</span>
            {section.status === "completed" ? (
              <Check className="size-3.5 text-status-completed" />
            ) : (
              <span className={cn("size-1.5 rounded-full", STATUS_DOT_STYLES[section.status])} />
            )}
          </li>
        ))}
      </ol>
    </MockCard>
  );
}

function SectionBarsCard() {
  const t = useTranslations("Landing.progress");
  const sections = useTranslations("Landing.sample.sections");

  return (
    <MockCard className="p-5">
      <MockLabel>{t("barsTitle")}</MockLabel>
      <ul className="mt-4 space-y-3">
        {SAMPLE_SECTIONS.map((section) => (
          <li key={section.key}>
            <span className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate">{sections(section.key)}</span>
              <span className="tabular-nums text-muted-foreground">{section.progress} %</span>
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-foreground/10">
              <span
                className={cn("block h-full rounded-full", STATUS_DOT_STYLES[section.status])}
                style={{ width: `${section.progress}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </MockCard>
  );
}

function RingCard() {
  const t = useTranslations("Landing.progress");
  const sample = useTranslations("Landing.sample");

  return (
    <MockCard className="flex items-center gap-4 p-5">
      <div className="relative">
        <ProgressRing value={SAMPLE_PROGRESS} className="size-16" />
        <span className="absolute inset-0 flex items-center justify-center font-display text-sm tabular-nums">
          {SAMPLE_PROGRESS}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{t("ringTitle")}</p>
        <MockLabel className="truncate text-xs">{sample("reportTitle")}</MockLabel>
      </div>
    </MockCard>
  );
}

function StatusCountCard() {
  const t = useTranslations("Landing.progress");
  const status = useTranslations("SectionStatus");
  const counts = { completed: 2, in_progress: 2, not_started: 1 } as const;

  return (
    <MockCard className="p-5">
      <MockLabel>{t("statusTitle")}</MockLabel>
      <ul className="mt-3 grid grid-cols-3 gap-3">
        {(Object.keys(counts) as (keyof typeof counts)[]).map((key) => (
          <li key={key}>
            <span className="block font-display text-3xl font-normal tracking-[-0.03em]">{counts[key]}</span>
            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", STATUS_DOT_STYLES[key])} />
              {status(key)}
            </span>
          </li>
        ))}
      </ul>
    </MockCard>
  );
}

// Faded cards around the text from lg up: they recede toward the middle so
// the heading stays the focus.
const fadeToCenterLeft = "[mask-image:linear-gradient(to_right,#000_30%,transparent_95%)]";
const fadeToCenterRight = "[mask-image:linear-gradient(to_left,#000_30%,transparent_95%)]";

/** Centered call to action about the master report, with the progress cards around it. */
export function ProgressShowcase() {
  const t = useTranslations("Landing.progress");

  return (
    <section aria-labelledby="progress-title" className="relative px-4 pt-28 sm:px-6 sm:pt-36">
      <div className="relative mx-auto max-w-7xl">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[10%] inset-y-0 -z-10 rounded-full bg-[radial-gradient(closest-side,hsl(var(--highlight)/0.08),transparent)] blur-2xl"
        />
        <EdgeLines side="left" className="-left-4 top-10 hidden lg:block xl:-left-6" />
        <EdgeLines side="right" className="-right-4 bottom-0 hidden lg:block xl:-right-6" />

        <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden lg:block">
          <div className={cn("absolute left-[12%] top-6 w-64 opacity-70", fadeToCenterLeft)}>
            <MasterOutlineCard />
          </div>
          <div className={cn("absolute bottom-0 left-[6%] w-72 opacity-80", fadeToCenterLeft)}>
            <SectionBarsCard />
          </div>
          <div className={cn("absolute right-[11%] top-10 w-72 opacity-80", fadeToCenterRight)}>
            <RingCard />
          </div>
          <div className={cn("absolute bottom-10 right-[5%] w-72 opacity-70", fadeToCenterRight)}>
            <StatusCountCard />
          </div>
        </div>

        <FadeIn className="relative mx-auto max-w-2xl text-center lg:py-44">
          <h2 id="progress-title" className="text-h1 text-foreground">
            {t("title")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lead text-muted-foreground">{t("subtitle")}</p>
          <Button asChild shape="pill" className="mt-8 h-11 px-6">
            <Link href="/connexion">{t("cta")}</Link>
          </Button>
        </FadeIn>

        <div aria-hidden="true" className="mx-auto mt-12 max-w-sm space-y-4 lg:hidden">
          <RingCard />
          <SectionBarsCard />
        </div>
      </div>
    </section>
  );
}
