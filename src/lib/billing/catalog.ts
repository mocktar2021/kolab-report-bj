// Plans, offers and prices of KolabReport (ADR 001, section 4). This is the
// only place with prices: the server computes every amount from it, and no
// amount ever comes from the browser. A grant copies the limits of its plan
// into the entitlement row, so a change here never touches a period already
// paid. Bump CATALOG_VERSION when a price, a limit or a label changes.
//
// The database starts the trial (trigger on organizations), so the trial
// terms also live in private.billing_trial_terms() in
// supabase/migrations/20261015100000_billing_entitlements.sql. catalog.test.ts
// reads that file and fails when the two differ.
//
// No zod and no server-only import: the public pricing page and Client
// Components may import this module.

export const CATALOG_VERSION = 1;

/** Prices are in FCFA (XOF), before tax (HT). */
export const CURRENCY = "XOF";

/** Days of full access after a period ends, before read-only (trial included). */
export const GRACE_DAYS = 7;

/** A year of Indépendant or Cabinet costs this many months. */
export const YEAR_PAID_MONTHS = 10;

/** Mirrors the plan column of public.billing_entitlements. */
export const PLAN_CODES = ["trial", "independant", "cabinet", "institution", "mission"] as const;

export type PlanCode = (typeof PLAN_CODES)[number];

/** Copied into each entitlement. Null means no limit. */
export type PlanLimits = {
  /** Distinct people with the owner, admin or expert role, open invitations included. Readers are free. */
  maxMembers: number | null;
  /** Subscription plans: draft and in-review reports. Pass Mission: every report of its workspace. */
  maxReports: number | null;
  /** AI drafts per calendar month (UTC), for the whole organization. */
  draftsPerMonth: number | null;
  /** AI drafts for the whole entitlement (trial, Pass Mission). */
  draftsTotal: number | null;
  /** Custom prompt templates in the workspaces. */
  customTemplates: boolean;
};

export type Plan = {
  code: PlanCode;
  label: string;
  /** Monthly price HT for plans sold by the month, null otherwise. */
  monthlyPriceHtXof: number | null;
  limits: PlanLimits;
};

export const PLANS = {
  trial: {
    code: "trial",
    label: "Essai gratuit",
    monthlyPriceHtXof: null,
    limits: { maxMembers: 5, maxReports: 1, draftsPerMonth: null, draftsTotal: 20, customTemplates: true },
  },
  independant: {
    code: "independant",
    label: "Indépendant",
    monthlyPriceHtXof: 15_000,
    limits: { maxMembers: 3, maxReports: 3, draftsPerMonth: 60, draftsTotal: null, customTemplates: false },
  },
  cabinet: {
    code: "cabinet",
    label: "Cabinet",
    monthlyPriceHtXof: 49_000,
    limits: {
      maxMembers: 10,
      maxReports: null,
      draftsPerMonth: 250,
      draftsTotal: null,
      customTemplates: true,
    },
  },
  institution: {
    code: "institution",
    label: "Institution",
    monthlyPriceHtXof: null,
    // Default limits of a quote. A deal can set others when the operator grants it.
    limits: {
      maxMembers: null,
      maxReports: null,
      draftsPerMonth: 1_000,
      draftsTotal: null,
      customTemplates: true,
    },
  },
  mission: {
    code: "mission",
    label: "Pass Mission",
    monthlyPriceHtXof: null,
    limits: { maxMembers: 10, maxReports: 1, draftsPerMonth: null, draftsTotal: 80, customTemplates: false },
  },
} as const satisfies Record<PlanCode, Plan>;

/** Free trial: one per customer, no card, started when the organization is created. */
export const TRIAL = { days: 14, limits: PLANS.trial.limits } as const;

/** Institution is sold on quote, paid by bank transfer and granted by the operator, never online. */
export const INSTITUTION = { fromMonthlyPriceHtXof: 150_000, minMonths: 12, onboardingHours: 2 } as const;

/** Offers sold online. Institution is not one of them. */
export const OFFER_CODES = [
  "independant_1m",
  "independant_3m",
  "independant_12m",
  "cabinet_1m",
  "cabinet_3m",
  "cabinet_12m",
  "mission_pass",
  "ai_pack_100",
] as const;

export type OfferCode = (typeof OFFER_CODES)[number];

export type SubscriptionOffer = {
  code: OfferCode;
  kind: "subscription";
  plan: "independant" | "cabinet";
  months: 1 | 3 | 12;
  priceHtXof: number;
  /** Frozen into the purchase and printed on the receipt. */
  label: string;
};

export type MissionOffer = {
  code: OfferCode;
  kind: "mission";
  plan: "mission";
  /** Covers one workspace holding one report. */
  days: number;
  priceHtXof: number;
  label: string;
};

export type AiPackOffer = {
  code: OfferCode;
  kind: "ai_pack";
  /** AI drafts per pack, used after the plan's own allowance. */
  drafts: number;
  validMonths: number;
  /** Packs bought at once, and running at the same time. */
  maxQuantity: number;
  /** Price of one pack. */
  priceHtXof: number;
  label: string;
};

export type Offer = SubscriptionOffer | MissionOffer | AiPackOffer;

// Prices are written out, not computed, so the table reads like the price
// list. catalog.test.ts checks that a quarter costs 3 months and a year 10.
export const OFFERS = {
  independant_1m: {
    code: "independant_1m",
    kind: "subscription",
    plan: "independant",
    months: 1,
    priceHtXof: 15_000,
    label: "Indépendant, 1 mois",
  },
  independant_3m: {
    code: "independant_3m",
    kind: "subscription",
    plan: "independant",
    months: 3,
    priceHtXof: 45_000,
    label: "Indépendant, 3 mois",
  },
  independant_12m: {
    code: "independant_12m",
    kind: "subscription",
    plan: "independant",
    months: 12,
    priceHtXof: 150_000,
    label: "Indépendant, 12 mois",
  },
  cabinet_1m: {
    code: "cabinet_1m",
    kind: "subscription",
    plan: "cabinet",
    months: 1,
    priceHtXof: 49_000,
    label: "Cabinet, 1 mois",
  },
  cabinet_3m: {
    code: "cabinet_3m",
    kind: "subscription",
    plan: "cabinet",
    months: 3,
    priceHtXof: 147_000,
    label: "Cabinet, 3 mois",
  },
  cabinet_12m: {
    code: "cabinet_12m",
    kind: "subscription",
    plan: "cabinet",
    months: 12,
    priceHtXof: 490_000,
    label: "Cabinet, 12 mois",
  },
  mission_pass: {
    code: "mission_pass",
    kind: "mission",
    plan: "mission",
    days: 90,
    priceHtXof: 39_000,
    label: "Pass Mission, 90 jours",
  },
  ai_pack_100: {
    code: "ai_pack_100",
    kind: "ai_pack",
    drafts: 100,
    validMonths: 12,
    maxQuantity: 10,
    priceHtXof: 12_000,
    label: "Pack IA, 100 brouillons IA",
  },
} as const satisfies { [Code in OfferCode]: Offer & { code: Code } };

export function isOfferCode(value: unknown): value is OfferCode {
  return typeof value === "string" && (OFFER_CODES as readonly string[]).includes(value);
}

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && (PLAN_CODES as readonly string[]).includes(value);
}

/**
 * Amount HT of an order, in FCFA. Only packs take a quantity (1 to 10); the
 * other offers are bought one at a time. Throws on anything else, so a bad
 * request never reaches FedaPay.
 */
export function offerAmountHtXof(code: OfferCode, quantity = 1): number {
  const offer: Offer = OFFERS[code];
  const max = offer.kind === "ai_pack" ? offer.maxQuantity : 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
    throw new RangeError(`Invalid quantity ${quantity} for offer ${code}`);
  }
  return offer.priceHtXof * quantity;
}
