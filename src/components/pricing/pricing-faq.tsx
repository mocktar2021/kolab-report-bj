import { useLocale, useTranslations } from "next-intl";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { getPathname } from "@/i18n/navigation";
import { GRACE_DAYS, OFFERS } from "@/lib/billing/catalog";

const QUESTIONS = ["trialEnd", "pay", "change", "drafts", "mission", "refund"] as const;

/** Questions on prices and payment, under the offers of the pricing page. */
export function PricingFaq() {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  // The refund rules are in the terms of sale (ADR 001, Q10).
  const refundHref = `${getPathname({ href: "/cgv", locale })}#remboursement`;

  return (
    <section id="faq-tarifs" aria-labelledby="faq-tarifs-title" className="mt-24 scroll-mt-24 sm:mt-28">
      <h2 id="faq-tarifs-title" className="text-h2 text-foreground">
        {t("faqTitle")}
      </h2>
      <Accordion type="single" collapsible className="mt-8 max-w-3xl border-t">
        {QUESTIONS.map((key) => (
          <AccordionItem key={key} value={key}>
            <AccordionTrigger>{t(`faq.${key}.question`)}</AccordionTrigger>
            <AccordionContent>
              {key === "mission"
                ? t("faq.mission.answer", { days: OFFERS.mission_pass.days })
                : key === "refund"
                  ? t.rich("faq.refund.answer", {
                      link: (chunks) => (
                        <a
                          href={refundHref}
                          className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
                        >
                          {chunks}
                        </a>
                      ),
                    })
                  : t(`faq.${key}.answer`, { days: GRACE_DAYS })}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
