// Dates and amounts of billing, as customers read them. No imports: e-mails,
// pages and Client Components share it.

/** Billing dates are shown in Benin time, like the rest of the app. */
export const BILLING_TIME_ZONE = "Africa/Porto-Novo";

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: BILLING_TIME_ZONE });

const AMOUNT_FORMAT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** "1 novembre 2026", in Porto-Novo time. */
export function formatBillingDate(date: Date | string): string {
  return DATE_FORMAT.format(typeof date === "string" ? new Date(date) : date);
}

/** "15 000", grouped the French way, without the currency. */
export function formatXof(amount: number): string {
  return AMOUNT_FORMAT.format(amount);
}
