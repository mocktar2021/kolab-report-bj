import { OFFERS, PLANS, YEAR_PAID_MONTHS, type PlanLimits } from "./catalog";

// What the public pricing page shows, read from the catalogue (KRB-179). The
// page never writes a price or a limit itself, so it changes with
// catalog.ts. No server-only import: the page is prerendered and its FAQ is
// a Client Component.

/** Plans sold by the month, the quarter and the year. */
export const PRICED_PLANS = ["independant", "cabinet"] as const;

export type PricedPlan = (typeof PRICED_PLANS)[number];

export type PlanPrices = {
  month: number;
  quarter: number;
  year: number;
  /** Months the year gives for free. */
  freeMonths: number;
  /** What the year saves against 12 single months. */
  yearSaving: number;
};

/** Prices HT in FCFA of a plan, for each length sold online. */
export function planPrices(plan: PricedPlan): PlanPrices {
  const month = OFFERS[`${plan}_1m`].priceHtXof;
  const year = OFFERS[`${plan}_12m`].priceHtXof;
  return {
    month,
    quarter: OFFERS[`${plan}_3m`].priceHtXof,
    year,
    freeMonths: 12 - YEAR_PAID_MONTHS,
    yearSaving: month * 12 - year,
  };
}

/** One line of a plan card: a key of Pricing.features and its count, if any. */
export type PlanFeature =
  | { key: "members" | "reports" | "activeReports" | "draftsPerMonth" | "draftsTotal"; count: number }
  | { key: "membersUnlimited" | "reportsUnlimited" | "customTemplates" | "readersFree" };

/**
 * What a plan includes, in the order the cards list it. A plan's reports are
 * "active" ones (draft and in review) except for the trial and the pass,
 * which hold one report whatever its status (ADR 001, 3.4).
 */
export function planFeatures(
  limits: PlanLimits,
  { activeReports }: { activeReports: boolean },
): PlanFeature[] {
  const features: PlanFeature[] = [];
  features.push(
    limits.maxMembers === null ? { key: "membersUnlimited" } : { key: "members", count: limits.maxMembers },
  );
  if (limits.maxReports === null) features.push({ key: "reportsUnlimited" });
  else features.push({ key: activeReports ? "activeReports" : "reports", count: limits.maxReports });
  if (limits.draftsPerMonth !== null) features.push({ key: "draftsPerMonth", count: limits.draftsPerMonth });
  if (limits.draftsTotal !== null) features.push({ key: "draftsTotal", count: limits.draftsTotal });
  if (limits.customTemplates) features.push({ key: "customTemplates" });
  features.push({ key: "readersFree" });
  return features;
}

/** The four plans of the main grid, in order. */
export const PRICING_PLANS = [
  { code: "trial", features: planFeatures(PLANS.trial.limits, { activeReports: false }) },
  { code: "independant", features: planFeatures(PLANS.independant.limits, { activeReports: true }) },
  { code: "cabinet", features: planFeatures(PLANS.cabinet.limits, { activeReports: true }) },
  { code: "institution", features: planFeatures(PLANS.institution.limits, { activeReports: true }) },
] as const;
