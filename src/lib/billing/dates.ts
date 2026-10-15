import { BILLING_TIME_ZONE } from "./format";

// Calendar days in Benin time (Africa/Porto-Novo, UTC+1 all year), the days
// the reminders and the banner count. No server-only import: the banner, the
// e-mails and Client Components share these helpers.

export { BILLING_TIME_ZONE, formatBillingDate } from "./format";

// en-CA writes YYYY-MM-DD.
const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: BILLING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of the Porto-Novo calendar day of `date`, to count whole days. */
function calendarDay(date: Date): number {
  const [year, month, day] = DAY_FORMAT.format(date).split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/**
 * Calendar days in Porto-Novo from `now` to `end`: 0 on the end day, 1 the
 * day before, negative once the end day has passed. The same days the
 * reminders count (private.billing_due).
 */
export function calendarDaysUntil(end: Date | string, now: Date = new Date()): number {
  return Math.round((calendarDay(typeof end === "string" ? new Date(end) : end) - calendarDay(now)) / DAY_MS);
}
