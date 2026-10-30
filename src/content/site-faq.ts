import { LEGAL_PAGES } from "@/content/legal/pages";
import { GRACE_DAYS, OFFERS } from "@/lib/billing/catalog";

// The questions of the landing page and pricing page FAQs, in the order the
// pages show them. The pages and their structured data (KRB-259) both read
// these lists, so search engines get the same answers as visitors.

/** Keys of Landing.faq.items. */
export const LANDING_FAQ = ["security", "formats", "ai", "offline", "roles", "progress"] as const;

/** Keys of Pricing.faq. */
export const PRICING_FAQ = ["trialEnd", "pay", "change", "drafts", "mission", "refund"] as const;

export type PricingFaqKey = (typeof PRICING_FAQ)[number];

/** The values of a pricing answer. The refund answer also takes a link, to REFUND_LINK. */
export function pricingFaqValues(key: PricingFaqKey): { days: number } {
  return { days: key === "mission" ? OFFERS.mission_pass.days : GRACE_DAYS };
}

/** The refund rules in the terms of sale (ADR 001, Q10). The path has no locale prefix. */
export const REFUND_LINK = { path: LEGAL_PAGES.cgv, hash: "#remboursement" } as const;
