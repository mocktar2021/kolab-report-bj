import { useTranslations } from "next-intl";
import { Check, FileSpreadsheet, FileText, FileType2, Sparkles, Workflow } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { AccentBadge, EmptyAvatar, MiniAvatar, MockCard, MockLabel, SAMPLE_SECTIONS } from "./mock-ui";

type FeatureCardProps = {
  id: string;
  title: string;
  description: string;
  action: React.ReactNode;
  /** The product mockup, drawn inside the inset panel. */
  visual: React.ReactNode;
  /** Small card that overlaps the panel edge toward the text. */
  floating: React.ReactNode;
  /** Text on the right from lg up. */
  reverse?: boolean;
};

/**
 * Large card: text and a pill link on one side, a product mockup on the
 * other with a small card overlapping it. The card fades in once; its small
 * card follows a beat later.
 */
function FeatureCard({
  id,
  title,
  description,
  action,
  visual,
  floating,
  reverse = false,
}: FeatureCardProps) {
  return (
    <FadeIn
      id={id}
      amount={0.25}
      className="surface-feature relative grid scroll-mt-28 overflow-hidden rounded-[28px] border lg:grid-cols-2"
    >
      <div
        className={cn(
          "relative flex flex-col justify-center px-7 pb-4 pt-10 sm:px-10 sm:pt-12 lg:px-12 lg:py-14",
          reverse && "lg:order-2",
        )}
      >
        <h3 className="max-w-md text-h2 text-foreground">{title}</h3>
        <p className="mt-4 max-w-md text-body text-muted-foreground">{description}</p>
        <div className="mt-8">{action}</div>
      </div>
      <div aria-hidden="true" className="relative p-3 sm:p-4 lg:p-5">
        <div className="surface-panel relative flex h-full min-h-[300px] flex-col items-center justify-center rounded-[20px] border px-5 py-8 sm:min-h-[460px] sm:justify-start sm:px-10 sm:pt-8">
          {visual}
          <FadeIn
            delay={0.18}
            y={12}
            className={cn(
              "relative z-10 -mt-6 w-[min(16rem,100%)] sm:absolute sm:bottom-8 sm:mt-0",
              reverse ? "self-end sm:right-8 lg:-right-10" : "self-start sm:left-8 lg:-left-10",
            )}
          >
            {floating}
          </FadeIn>
        </div>
      </div>
    </FadeIn>
  );
}

function AssignVisual() {
  const t = useTranslations("Landing.features.assign");
  const sections = useTranslations("Landing.sample.sections");

  return (
    <MockCard className="w-full max-w-sm p-5">
      <MockLabel>{t("outline")}</MockLabel>
      <ol className="mt-3 space-y-1">
        {SAMPLE_SECTIONS.map((section, index) => (
          <li
            key={section.key}
            className={cn(
              "flex items-center gap-3 rounded-xl px-2 py-2 text-[13px]",
              section.key === "analysis" && "bg-muted ring-1 ring-inset ring-border",
            )}
          >
            <span className="w-3 text-right tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{sections(section.key)}</span>
            {section.initials ? (
              <MiniAvatar initials={section.initials} tone={index} />
            ) : (
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {t("unassigned")}
                <EmptyAvatar />
              </span>
            )}
          </li>
        ))}
      </ol>
    </MockCard>
  );
}

function AssignFloating() {
  const t = useTranslations("Landing.features.assign");
  const sections = useTranslations("Landing.sample.sections");

  return (
    <MockCard className="p-3.5">
      <div className="flex items-center gap-3">
        <MiniAvatar initials="FD" tone={2} className="size-8" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{sections("analysis")}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{t("assignedTo")}</span>
        </span>
      </div>
      <StatusBadge status="in_progress" className="mt-3" />
    </MockCard>
  );
}

const FILES = [
  { name: "docx", size: "docxSize", icon: FileText },
  { name: "xlsx", size: "xlsxSize", icon: FileSpreadsheet },
  { name: "pdf", size: "pdfSize", icon: FileType2 },
  { name: "drawio", size: "drawioSize", icon: Workflow },
] as const;

function DeliverablesVisual() {
  const t = useTranslations("Landing.features.deliverables");

  return (
    <MockCard className="w-full max-w-sm p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-medium">{t("listTitle")}</p>
        <MockLabel className="hidden text-xs sm:block">{t("listMeta")}</MockLabel>
      </div>
      <ul className="mt-4 space-y-2">
        {FILES.map(({ name, size, icon: Icon }) => (
          <li key={name} className="flex items-center gap-3 rounded-xl border bg-background/60 px-3 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{t(name)}</span>
              <span className="block text-[11px] tabular-nums text-muted-foreground">{t(size)}</span>
            </span>
            <Check className="size-4 shrink-0 text-status-completed" />
          </li>
        ))}
      </ul>
    </MockCard>
  );
}

function DeliverablesFloating() {
  const t = useTranslations("Landing.features.deliverables");

  return (
    <MockCard className="p-3.5">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="min-w-0 truncate font-medium">{t("uploadFile")}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{t("uploadValue")}</span>
      </div>
      <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <span className="block h-full w-[68%] rounded-full bg-highlight" />
      </span>
      <MockLabel className="mt-2 text-[11px]">{t("uploading")}</MockLabel>
    </MockCard>
  );
}

const PROMPTS = ["summary", "data", "recommendations"] as const;
const SELECTED_PROMPT: (typeof PROMPTS)[number] = "data";

function AiVisual() {
  const t = useTranslations("Landing.features.ai");

  return (
    <MockCard className="w-full max-w-sm p-5">
      <MockLabel>{t("libraryTitle")}</MockLabel>
      <ul className="mt-3 space-y-2">
        {PROMPTS.map((key) => (
          <li
            key={key}
            className={cn(
              "rounded-xl border px-3.5 py-2",
              key === SELECTED_PROMPT
                ? "border-highlight/50 bg-highlight/[0.06] ring-1 ring-highlight/30"
                : "bg-background/60",
            )}
          >
            <span className="block text-[13px] font-medium">{t(`prompts.${key}.name`)}</span>
            <span className="block text-[11px] text-muted-foreground">{t(`prompts.${key}.hint`)}</span>
          </li>
        ))}
      </ul>
    </MockCard>
  );
}

function AiFloating() {
  const t = useTranslations("Landing.features.ai");

  return (
    <MockCard className="p-3.5">
      <div className="flex items-center gap-2">
        <AccentBadge>
          <Sparkles className="size-3" />
          {t("badge")}
        </AccentBadge>
        <span className="text-[13px] font-medium">{t("draftTitle")}</span>
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-foreground/85">{t("excerpt")}</p>
      <span className="mt-3 inline-flex rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground">
        {t("review")}
      </span>
    </MockCard>
  );
}

export function FeatureCards() {
  const t = useTranslations("Landing.features");

  return (
    <section
      id="fonctionnalites"
      aria-labelledby="features-title"
      className="scroll-mt-20 px-4 pt-24 sm:px-6 sm:pt-32"
    >
      <FadeIn className="mx-auto max-w-2xl text-center">
        <h2 id="features-title" className="text-h1 text-foreground">
          {t("title")}
        </h2>
        <p className="mt-4 text-lead text-muted-foreground">{t("subtitle")}</p>
      </FadeIn>

      <div className="mx-auto mt-12 max-w-5xl space-y-6 sm:mt-16 sm:space-y-8">
        <FeatureCard
          id="attribution"
          title={t("assign.title")}
          description={t("assign.description")}
          action={
            <Button asChild shape="pill" className="h-11 px-6">
              <a href="#livrables">{t("assign.cta")}</a>
            </Button>
          }
          visual={<AssignVisual />}
          floating={<AssignFloating />}
        />
        <FeatureCard
          id="livrables"
          reverse
          title={t("deliverables.title")}
          description={t("deliverables.description")}
          action={
            <Button asChild shape="pill" className="h-11 px-6">
              <a href="#brouillons">{t("deliverables.cta")}</a>
            </Button>
          }
          visual={<DeliverablesVisual />}
          floating={<DeliverablesFloating />}
        />
        <FeatureCard
          id="brouillons"
          title={t("ai.title")}
          description={t("ai.description")}
          action={
            <Button asChild shape="pill" className="h-11 px-6">
              <Link href="/connexion">{t("ai.cta")}</Link>
            </Button>
          }
          visual={<AiVisual />}
          floating={<AiFloating />}
        />
      </div>
    </section>
  );
}
