/**
 * The renewal reminders of KRB-178, in the order they go out: 7 days before
 * the end day, the day before, once the period has ended, once the grace is
 * over. Mirrors private.billing_notices.kind and notifications.billing_notice.
 */
export const BILLING_NOTICE_KINDS = ["d7", "d1", "ended", "read_only"] as const;

export type BillingNoticeKind = (typeof BILLING_NOTICE_KINDS)[number];
