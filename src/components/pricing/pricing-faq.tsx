import { useLocale, useTranslations } from "next-intl";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PRICING_FAQ, pricingFaqValues, REFUND_LINK } from "@/content/site-faq";
import { getPathname } from "@/i18n/navigation";

/** Questions on prices and payment, under the offers of the pricing page. */
export function PricingFaq() {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const refundHref = `${getPathname({ href: REFUND_LINK.path, locale })}${REFUND_LINK.hash}`;

  return (
    <section id="faq-tarifs" aria-labelledby="faq-tarifs-title" className="mt-24 scroll-mt-24 sm:mt-28">
      <h2 id="faq-tarifs-title" className="text-h2 text-foreground">
        {t("faqTitle")}
      </h2>
      <Accordion type="single" collapsible className="mt-8 max-w-3xl border-t">
        {PRICING_FAQ.map((key) => (
          <AccordionItem key={key} value={key}>
            <AccordionTrigger>{t(`faq.${key}.question`)}</AccordionTrigger>
            <AccordionContent>
              {key === "refund"
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
                : t(`faq.${key}.answer`, pricingFaqValues(key))}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
