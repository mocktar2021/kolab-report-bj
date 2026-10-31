import { getTranslations } from "next-intl/server";
import { PUBLISHER } from "@/content/legal/publisher";
import { LANDING_FAQ, PRICING_FAQ, pricingFaqValues, REFUND_LINK } from "@/content/site-faq";
import type { Locale } from "@/i18n/routing";
import { CURRENCY, OFFER_CODES, OFFERS, PLANS, TRIAL, type Offer } from "@/lib/billing/catalog";
import { SHARE_IMAGE } from "./metadata";
import { localizedPath, siteUrl } from "./site";

// What search engines read about KolabReport (KRB-259), as schema.org JSON-LD:
// who sells it, what it is, what it costs and the answers of the FAQs. Prices
// come from the catalogue and answers from the messages, like the pages, so
// the two never differ.

type Node = Record<string, unknown>;

export type JsonLdGraph = { "@context": "https://schema.org"; "@graph": Node[] };

type FaqEntry = { question: string; answer: string };

/** The app icon, also the KolabReport logo. */
const LOGO_PATH = "/icons/icon-512.png";

const PRODUCT_NAME = "KolabReport";

function ids(base: string) {
  return {
    organization: `${base}/#organization`,
    website: `${base}/#website`,
    app: `${base}/#app`,
  };
}

/** Mocktar Technologies sells KolabReport: its own site is mocktar.com, the brand's is kolabreport.com. */
function organization(base: string): Node {
  return {
    "@type": "Organization",
    "@id": ids(base).organization,
    name: PUBLISHER.name,
    url: PUBLISHER.website,
    email: PUBLISHER.email,
    telephone: PUBLISHER.phone,
    address: PUBLISHER.address,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: PUBLISHER.email,
      telephone: PUBLISHER.phone,
      availableLanguage: "fr",
    },
    brand: { "@type": "Brand", name: PRODUCT_NAME, url: `${base}/`, logo: `${base}${LOGO_PATH}` },
  };
}

/** Gives search results the site name KolabReport. */
function website(base: string, locale: Locale): Node {
  return {
    "@type": "WebSite",
    "@id": ids(base).website,
    name: PRODUCT_NAME,
    url: `${base}/`,
    inLanguage: locale,
    publisher: { "@id": ids(base).organization },
  };
}

/** How long a payment covers, as an ISO 8601 duration. A Pack IA is not a period. */
function billingDuration(offer: Offer): string | null {
  switch (offer.kind) {
    case "subscription":
      return `P${offer.months}M`;
    case "mission":
      return `P${offer.days}D`;
    case "ai_pack":
      return null;
  }
}

/**
 * The free trial and every offer sold online, in FCFA. Prices are net: the
 * seller charges no VAT (src/lib/billing/catalog.ts). Institution is sold on
 * quote, so it has no price here.
 */
function offers(base: string, locale: Locale): Node[] {
  const url = `${base}${localizedPath("/tarifs", locale)}`;
  const trial: Node = {
    "@type": "Offer",
    name: `${PLANS.trial.label}, ${TRIAL.days} jours`,
    price: 0,
    priceCurrency: CURRENCY,
    url,
  };
  const sold = OFFER_CODES.map((code): Node => {
    const offer: Offer = OFFERS[code];
    const duration = billingDuration(offer);
    return {
      "@type": "Offer",
      name: offer.label,
      price: offer.priceHtXof,
      priceCurrency: CURRENCY,
      url,
      ...(duration && {
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: offer.priceHtXof,
          priceCurrency: CURRENCY,
          billingDuration: duration,
        },
      }),
    };
  });
  return [trial, ...sold];
}

function application(base: string, locale: Locale, description: string): Node {
  return {
    "@type": "WebApplication",
    "@id": ids(base).app,
    name: PRODUCT_NAME,
    url: `${base}${localizedPath("/", locale)}`,
    description,
    applicationCategory: "BusinessApplication",
    // A web app that installs as a PWA on a computer or a phone.
    operatingSystem: "Web",
    inLanguage: locale,
    image: `${base}${SHARE_IMAGE.url}`,
    publisher: { "@id": ids(base).organization },
    offers: offers(base, locale),
  };
}

function faqPage(url: string, entries: FaqEntry[]): Node {
  return {
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    url,
    mainEntity: entries.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

/** The FAQ of the landing page, as the page shows it. */
export async function landingFaq(locale: Locale): Promise<FaqEntry[]> {
  const t = await getTranslations({ locale, namespace: "Landing.faq" });
  return LANDING_FAQ.map((key) => ({
    question: t(`items.${key}.question`),
    answer: t(`items.${key}.answer`),
  }));
}

/** The FAQ of the pricing page, as the page shows it. Its one link stays a link. */
export async function pricingFaq(locale: Locale, base: string = siteUrl()): Promise<FaqEntry[]> {
  const t = await getTranslations({ locale, namespace: "Pricing.faq" });
  const refundUrl = `${base}${localizedPath(REFUND_LINK.path, locale)}${REFUND_LINK.hash}`;
  return PRICING_FAQ.map((key) => ({
    question: t(`${key}.question`),
    answer:
      key === "refund"
        ? t.markup("refund.answer", { link: (chunks) => `<a href="${refundUrl}">${chunks}</a>` })
        : t(`${key}.answer`, pricingFaqValues(key)),
  }));
}

async function appDescription(locale: Locale): Promise<string> {
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return t("description");
}

/** The landing page: the seller, the site, the app and its offers, and the FAQ. */
export async function landingJsonLd(locale: Locale): Promise<JsonLdGraph> {
  const base = siteUrl();
  const [description, faq] = await Promise.all([appDescription(locale), landingFaq(locale)]);
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization(base),
      website(base, locale),
      application(base, locale, description),
      faqPage(`${base}${localizedPath("/", locale)}`, faq),
    ],
  };
}

/** The pricing page: the seller, the app and its offers, and the pricing FAQ. */
export async function pricingJsonLd(locale: Locale): Promise<JsonLdGraph> {
  const base = siteUrl();
  const [description, faq] = await Promise.all([appDescription(locale), pricingFaq(locale, base)]);
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization(base),
      application(base, locale, description),
      faqPage(`${base}${localizedPath("/tarifs", locale)}`, faq),
    ],
  };
}
