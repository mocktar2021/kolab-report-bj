import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { WebAnalytics } from "@/components/monitoring/web-analytics";
import { Extras, PlanGrid } from "@/components/pricing/plans";
import { PricingFaq } from "@/components/pricing/pricing-faq";
import { Button } from "@/components/ui/button";
import { getPathname, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { GRACE_DAYS, TRIAL, YEAR_PAID_MONTHS } from "@/lib/billing/catalog";

// Public pricing page (KRB-179). Every price and limit comes from the
// catalogue (src/lib/billing/catalog.ts). It reads no cookies, so it is
// prerendered at build time like the landing page, and signed-in users can
// read it too.
type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Pricing" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

const FACTS = ["members", "payment", "end", "receipt"] as const;

export default async function PricingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tLanding] = await Promise.all([
    getTranslations({ locale, namespace: "Pricing" }),
    getTranslations({ locale, namespace: "Landing" }),
  ]);
  // The header and footer link to sections of the landing page.
  const landing = getPathname({ href: "/", locale });

  return (
    <div className="relative isolate">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-glow [mask-image:linear-gradient(to_bottom,#000_45%,transparent)]"
      />
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:text-background"
      >
        {tLanding("skipToContent")}
      </a>
      <SiteHeader sectionBase={landing} />
      <main id="contenu" className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        <header className="max-w-3xl">
          <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
          <h1 className="mt-3 text-h1 text-foreground">{t("title")}</h1>
          <p className="mt-4 text-lead text-muted-foreground">{t("subtitle", { days: TRIAL.days })}</p>
          <ul className="mt-6 flex flex-wrap gap-2 text-sm">
            {[t("notes.tax"), t("notes.readers"), t("notes.year", { paidMonths: YEAR_PAID_MONTHS })].map(
              (note) => (
                <li key={note} className="rounded-full border bg-card px-3 py-1 text-foreground">
                  {note}
                </li>
              ),
            )}
          </ul>
        </header>

        <section aria-labelledby="offres-title" className="mt-14 sm:mt-16">
          <h2 id="offres-title" className="sr-only">
            {t("plansTitle")}
          </h2>
          <PlanGrid />
        </section>

        <section aria-labelledby="extras-title" className="mt-20 sm:mt-24">
          <h2 id="extras-title" className="text-h2 text-foreground">
            {t("extrasTitle")}
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">{t("extrasSubtitle")}</p>
          <Extras />
        </section>

        <section aria-labelledby="facts-title" className="mt-20 sm:mt-24">
          <h2 id="facts-title" className="text-h2 text-foreground">
            {t("factsTitle")}
          </h2>
          <dl className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
            {FACTS.map((key) => (
              <div key={key} className="border-t pt-5">
                <dt className="font-medium text-foreground">{t(`facts.${key}.title`)}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`facts.${key}.text`, { days: GRACE_DAYS })}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <PricingFaq />

        <section
          aria-labelledby="essai-title"
          className="surface-feature relative mt-24 overflow-hidden rounded-[28px] border px-6 py-14 text-center sm:mt-28 sm:px-10"
        >
          <h2 id="essai-title" className="text-h2 text-foreground">
            {t("cta.title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            {t("cta.subtitle", { days: TRIAL.days })}
          </p>
          <Button asChild size="lg" shape="pill" className="mt-8 h-12 px-7">
            <Link href="/inscription">{t("startTrial")}</Link>
          </Button>
        </section>
      </main>
      <SiteFooter sectionBase={landing} />
      <WebAnalytics />
    </div>
  );
}
