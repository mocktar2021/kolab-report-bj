import { useTranslations } from "next-intl";
import { Check, CheckCircle2, FileSpreadsheet, FileText, Sparkles } from "lucide-react";
import { STATUS_DOT_STYLES, StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import {
  AccentBadge,
  AvatarStack,
  EmptyAvatar,
  MiniAvatar,
  MockCard,
  MockLabel,
  ProgressRing,
  SAMPLE_PROGRESS,
  SAMPLE_SECTIONS,
} from "./mock-ui";

// Hero load sequence: the headline, subtitle and buttons enter first (CSS in
// hero.tsx), then the cards rise one after the other, left to right, and
// keep a slow drift. Reduced motion shows them still, in place.
const ENTER =
  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-8 motion-safe:fill-mode-both motion-safe:duration-1000 motion-safe:ease-out-expo";
const FIRST_CARD_DELAY_MS = 380;
const CARD_STEP_MS = 70;

function Slot({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("shrink-0", ENTER, className)}
      style={{ animationDelay: `${FIRST_CARD_DELAY_MS + index * CARD_STEP_MS}ms` }}
    >
      <div
        className="motion-safe:animate-float"
        style={{ animationDuration: `${8 + (index % 3) * 1.6}s`, animationDelay: `${-index * 1.7}s` }}
      >
        {children}
      </div>
    </div>
  );
}

function OutlineCard() {
  const t = useTranslations("Landing.heroCards");
  const sections = useTranslations("Landing.sample.sections");

  return (
    <MockCard className="p-5">
      <MockLabel>{t("outlineTitle")}</MockLabel>
      <ol className="mt-3 space-y-1.5">
        {SAMPLE_SECTIONS.map((section, index) => (
          <li key={section.key} className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-[13px]">
            <span className="w-3 text-right tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="truncate">{sections(section.key)}</span>
            <span
              className={cn("ml-auto size-1.5 shrink-0 rounded-full", STATUS_DOT_STYLES[section.status])}
            />
          </li>
        ))}
      </ol>
    </MockCard>
  );
}

function SectionsCard() {
  const t = useTranslations("Landing.heroCards");
  const sections = useTranslations("Landing.sample.sections");
  const rows = SAMPLE_SECTIONS.filter((section) =>
    ["summary", "analysis", "recommendations"].includes(section.key),
  );

  return (
    <MockCard className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-medium">{t("sectionsTitle")}</p>
        <MockLabel className="text-xs">{t("sectionsMeta")}</MockLabel>
      </div>
      <ul className="mt-4 space-y-2">
        {rows.map((section, index) => (
          <li
            key={section.key}
            className="flex items-center gap-3 rounded-xl border bg-background/60 px-3 py-2.5 text-[13px]"
          >
            {section.initials ? <MiniAvatar initials={section.initials} tone={index} /> : <EmptyAvatar />}
            <span className="min-w-0 flex-1 truncate font-medium">{sections(section.key)}</span>
            <StatusBadge status={section.status} />
          </li>
        ))}
      </ul>
    </MockCard>
  );
}

function ProgressCard() {
  const t = useTranslations("Landing.heroCards");
  const sample = useTranslations("Landing.sample");

  return (
    <MockCard className="flex h-[272px] flex-col p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[15px] font-medium">{t("progress")}</p>
          <MockLabel className="mt-0.5 truncate">{sample("reportTitle")}</MockLabel>
        </div>
        <AccentBadge>{t("due")}</AccentBadge>
      </div>
      <div className="mt-auto flex items-end justify-between gap-4">
        <p className="font-display text-[3.5rem] font-normal leading-none tracking-[-0.04em]">
          {t("progressValue")}
        </p>
        <ProgressRing value={SAMPLE_PROGRESS} className="size-[4.5rem]" />
      </div>
      <div className="mt-5 flex gap-1" aria-hidden="true">
        {SAMPLE_SECTIONS.map((section) => (
          <span key={section.key} className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
            <span
              className={cn("block h-full rounded-full", STATUS_DOT_STYLES[section.status])}
              style={{ width: `${section.progress}%` }}
            />
          </span>
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", STATUS_DOT_STYLES.completed)} />
          {t("legendCompleted")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", STATUS_DOT_STYLES.in_progress)} />
          {t("legendInProgress")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", STATUS_DOT_STYLES.not_started)} />
          {t("legendNotStarted")}
        </li>
      </ul>
    </MockCard>
  );
}

function UploadCard() {
  const t = useTranslations("Landing.heroCards");
  const features = useTranslations("Landing.features.deliverables");
  const rows = [
    { icon: FileSpreadsheet, name: t("uploadFile"), meta: t("uploadMeta") },
    { icon: FileText, name: features("docx"), meta: features("docxSize") },
  ];

  return (
    <MockCard className="p-4">
      <MockLabel className="px-1">{t("uploadTitle")}</MockLabel>
      <ul className="mt-3 space-y-2">
        {rows.map(({ icon: Icon, name, meta }) => (
          <li key={name} className="flex items-center gap-3 rounded-xl border bg-background/60 px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{meta}</span>
            </span>
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <Check className="size-3" strokeWidth={3} aria-hidden="true" />
            </span>
          </li>
        ))}
      </ul>
    </MockCard>
  );
}

function AiCard() {
  const t = useTranslations("Landing.heroCards");

  return (
    <MockCard className="p-5">
      <div className="flex items-center gap-2">
        <AccentBadge>
          <Sparkles className="size-3" aria-hidden="true" />
          {t("aiBadge")}
        </AccentBadge>
        <p className="text-[15px] font-medium">{t("aiTitle")}</p>
      </div>
      <MockLabel className="mt-1.5 text-xs">{t("aiMeta")}</MockLabel>
      <p className="mt-3 text-[13px] leading-relaxed text-foreground/85">{t("aiExcerpt")}</p>
      <div className="mt-4 flex justify-end">
        <span className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground">
          {t("aiReview")}
        </span>
      </div>
    </MockCard>
  );
}

function ExpertsCard() {
  const t = useTranslations("Landing.heroCards");

  return (
    <MockCard className="p-5">
      <p className="text-[15px] font-medium">{t("expertsTitle")}</p>
      <AvatarStack className="mt-4" size="size-9" />
      <MockLabel className="mt-4">{t("expertsMeta")}</MockLabel>
    </MockCard>
  );
}

function DoneCard() {
  const t = useTranslations("Landing.heroCards");

  return (
    <MockCard className="flex items-center gap-3 p-3.5 pr-5">
      <CheckCircle2 className="size-5 shrink-0 text-status-completed" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{t("doneTitle")}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{t("doneMeta")}</span>
      </span>
    </MockCard>
  );
}

function AcceptedCard() {
  const t = useTranslations("Landing.heroCards");

  return (
    <MockCard className="flex items-center gap-3 p-3.5 pr-5">
      <Sparkles className="size-5 shrink-0 text-highlight" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{t("acceptedTitle")}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{t("acceptedMeta")}</span>
      </span>
    </MockCard>
  );
}

/**
 * Row of app cards under the hero copy. The row is wider than the screen and
 * scaled per breakpoint, so the outer cards are cut by the page edges.
 */
export function HeroCards() {
  const t = useTranslations("Landing.heroCards");

  return (
    <>
      {/*
        Two faded cards beside the subtitle, from lg up. Pure decoration, so
        their faded text has no contrast requirement (WCAG 1.4.3). The
        accessibility tests skip anything marked data-decorative.
      */}
      <div
        aria-hidden="true"
        data-decorative=""
        className="pointer-events-none absolute inset-x-0 top-[21rem] hidden lg:block xl:top-[22.5rem]"
      >
        <div
          className={cn("absolute left-[8%] w-60 xl:left-[12%]", ENTER)}
          style={{ animationDelay: "300ms" }}
        >
          <div className="opacity-60 motion-safe:animate-float [animation-duration:10s]">
            <AcceptedCard />
          </div>
        </div>
        <div
          className={cn("absolute right-[8%] w-60 xl:right-[12%]", ENTER)}
          style={{ animationDelay: "340ms" }}
        >
          <div className="opacity-60 motion-safe:animate-float [animation-delay:-4s] [animation-duration:11s]">
            <DoneCard />
          </div>
        </div>
      </div>

      <div
        role="img"
        aria-label={t("label")}
        className="relative mt-14 h-[178px] sm:mt-16 sm:h-[222px] lg:mt-20 lg:h-[250px] xl:h-[268px] 2xl:h-[300px]"
      >
        <div className="absolute left-1/2 top-0 flex w-[2040px] origin-top -translate-x-1/2 scale-[0.58] items-end gap-5 sm:scale-[0.72] lg:scale-[0.8] xl:scale-[0.86] 2xl:scale-100">
          <Slot index={0} className="mb-3 w-[300px]">
            <OutlineCard />
          </Slot>
          <Slot index={1} className="mb-10 w-[330px]">
            <SectionsCard />
          </Slot>
          <Slot index={2} className="w-[400px]">
            <ProgressCard />
          </Slot>
          <Slot index={3} className="mb-1 w-[300px]">
            <UploadCard />
          </Slot>
          <Slot index={4} className="mb-14 w-[310px]">
            <AiCard />
          </Slot>
          <Slot index={5} className="mb-4 w-[300px]">
            <ExpertsCard />
          </Slot>
        </div>
      </div>
    </>
  );
}
