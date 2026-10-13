import { useTranslations } from "next-intl";
import { FadeIn } from "@/components/motion/fade-in";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const QUESTIONS = ["security", "formats", "ai", "offline", "roles", "progress"] as const;

export function Faq() {
  const t = useTranslations("Landing.faq");

  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="mx-auto grid max-w-6xl scroll-mt-24 gap-10 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:gap-16"
    >
      <FadeIn>
        <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
        <h2 id="faq-title" className="mt-3 text-h1">
          {t("title")}
        </h2>
        <p className="mt-4 text-lead text-muted-foreground">{t("subtitle")}</p>
      </FadeIn>
      <FadeIn delay={0.1}>
        <Accordion
          type="single"
          collapsible
          defaultValue="security"
          className="rounded-3xl border bg-card px-5 shadow-sm sm:px-7"
        >
          {QUESTIONS.map((key) => (
            <AccordionItem key={key} value={key}>
              <AccordionTrigger>{t(`items.${key}.question`)}</AccordionTrigger>
              <AccordionContent>{t(`items.${key}.answer`)}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </FadeIn>
    </section>
  );
}
