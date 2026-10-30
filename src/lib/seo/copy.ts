import { OFFERS, TRIAL } from "@/lib/billing/catalog";
import { formatXof } from "@/lib/billing/format";

// Values of the titles and descriptions search engines show (KRB-261), read
// from the catalogue so a new price or trial length reaches the results by
// itself. copy.test.ts keeps each one within what Google displays.

/** Landing.metaDescription. */
export const LANDING_META_VALUES = { days: TRIAL.days };

/** Pricing.metaTitle and Pricing.metaDescription. */
export const PRICING_META_VALUES = {
  days: TRIAL.days,
  independant: formatXof(OFFERS.independant_1m.priceHtXof),
  cabinet: formatXof(OFFERS.cabinet_1m.priceHtXof),
  mission: formatXof(OFFERS.mission_pass.priceHtXof),
};

/** Longest title and description Google shows in full, in characters. */
export const MAX_TITLE_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 155;
