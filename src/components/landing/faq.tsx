import { useTranslations } from "next-intl";
import { LogoMark } from "@/components/brand/logo";
import { FadeIn } from "@/components/motion/fade-in";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { EdgeLines } from "./edge-lines";

const QUESTIONS = ["security", "formats", "ai", "offline", "roles", "progress"] as const;

/** Square tile with the KolabReport mark lit from behind (lg and up). */
function FaqTile() {
  return (
    <div
      aria-hidden="true"
      className="surface-feature relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[28px] border"
    >
      <EdgeLines side="left" className="top-1/2 -translate-y-1/2" />
      <EdgeLines side="right" className="top-1/2 -translate-y-1/2" />
      <div className="absolute size-56 rounded-full bg-[radial-gradient(closest-side,hsl(var(--highlight)/0.22),transparent)] blur-xl" />
      <div className="surface-float relative rounded-[1.75rem] border p-3">
        <LogoMark className="size-24 rounded-[1.25rem]" />
      </div>
    </div>
  );
}

export function Faq() {
  const t = useTranslations("Landing.faq");

  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-28 sm:px-6 sm:pt-36"
    >
      <FadeIn className="mx-auto max-w-2xl text-center">
        <h2 id="faq-title" className="text-h1 text-foreground">
          {t("title")}
        </h2>
        <p className="mt-4 text-lead text-muted-foreground">{t("subtitle")}</p>
      </FadeIn>
      <div className="mt-12 grid items-start gap-12 sm:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <FadeIn className="hidden lg:block">
          <FaqTile />
        </FadeIn>
        <FadeIn delay={0.1}>
          <Accordion type="single" collapsible className="border-t">
            {QUESTIONS.map((key) => (
              <AccordionItem key={key} value={key}>
                <AccordionTrigger>{t(`items.${key}.question`)}</AccordionTrigger>
                <AccordionContent>{t(`items.${key}.answer`)}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </FadeIn>
      </div>
    </section>
  );
}
