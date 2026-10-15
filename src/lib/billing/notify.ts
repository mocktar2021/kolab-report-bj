import "server-only";
import { billingAlertEmail, paymentReceivedEmail, type BillingAlertKind } from "@/lib/email/billing-email";
import { sendEmail } from "@/lib/email/send";
import { log } from "@/lib/log";
import type { AppliedEvent, BillingDb } from "./apply";
import { billingPagePath, RECEIPTS_ANCHOR } from "./navigation";

// E-mails about a purchase, sent once the grant has committed (ADR 001, 8.5
// and 12). Each one is claimed in the database before it goes
// (billing_claim_notice), so a webhook delivered twice, a return page and
// the reconciliation never send it twice. Nothing here throws: a failed
// e-mail is logged and the payment stays granted.

export type NoticeOptions = {
  /** BILLING_ALERT_EMAIL. Without it alerts are only logged. */
  alertEmail: string | null;
  /** NEXT_PUBLIC_APP_URL, for the link to the billing page. */
  appUrl: string;
  send?: typeof sendEmail;
};

/** Staging alerts must never read as production ones. */
function environmentName(): string {
  return process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "development";
}

async function claim(db: BillingDb, purchaseId: string, kind: string): Promise<boolean> {
  const { data, error } = await db.rpc("billing_claim_notice", { p_purchase_id: purchaseId, p_kind: kind });
  if (error) {
    log.error("billing: could not claim a notice", { purchaseId, kind, error: error.message });
    return false;
  }
  return data === true;
}

/** The operator's alert, once per purchase and kind. */
export async function sendBillingAlert(
  db: BillingDb,
  alert: {
    kind: BillingAlertKind;
    purchaseId: string;
    organizationId: string | null;
    fedapayTransactionId: number | null;
    reason?: string | null;
  },
  options: NoticeOptions,
): Promise<void> {
  if (!options.alertEmail) {
    log.warn("billing: alert not sent, BILLING_ALERT_EMAIL is not set", {
      kind: alert.kind,
      purchaseId: alert.purchaseId,
    });
    return;
  }
  if (!(await claim(db, alert.purchaseId, alert.kind))) return;
  const sent = await (options.send ?? sendEmail)(
    billingAlertEmail({ to: options.alertEmail, environment: environmentName(), ...alert }),
  );
  if (!sent) log.error("billing: alert e-mail not sent", { kind: alert.kind, purchaseId: alert.purchaseId });
}

type ConfirmationRow = {
  organization_id: string | null;
  organization_name: string | null;
  offer_label: string;
  quantity: number;
  amount_xof: number;
  buyer_email: string | null;
  billing_email: string | null;
  plan: string | null;
  ends_at: string | null;
  drafts: number | null;
  receipt_number: string | null;
};

/** The buyer's confirmation, once per purchase, to the buyer and the organization's billing address. */
export async function sendPaymentConfirmation(
  db: BillingDb,
  purchaseId: string,
  options: NoticeOptions,
): Promise<void> {
  if (!(await claim(db, purchaseId, "confirmation"))) return;
  const { data, error } = await db.rpc("billing_confirmation_details", { p_purchase_id: purchaseId });
  const row = (Array.isArray(data) ? data[0] : data) as ConfirmationRow | undefined | null;
  if (error || !row || !row.organization_id) {
    log.error("billing: confirmation e-mail not sent", {
      purchaseId,
      error: error?.message ?? "no paid purchase",
    });
    return;
  }
  const recipients = [
    ...new Set([row.buyer_email, row.billing_email].flatMap((email) => (email ? [email.toLowerCase()] : []))),
  ];
  // The receipts of the billing page rather than the PDF route (ADR 001,
  // section 9 suggests the PDF): signed out, the route only answers 401,
  // while the page sends the reader to the sign-in first.
  const page = `${options.appUrl.replace(/\/+$/, "")}/fr${billingPagePath(row.organization_id)}`;
  const link = row.receipt_number ? `${page}#${RECEIPTS_ANCHOR}` : page;
  let sent = 0;
  for (const to of recipients) {
    const ok = await (options.send ?? sendEmail)(
      paymentReceivedEmail({
        to,
        organizationName: row.organization_name ?? "",
        offerLabel: row.offer_label,
        quantity: row.quantity,
        amountXof: row.amount_xof,
        plan: row.plan,
        endsAt: row.ends_at,
        drafts: row.drafts,
        receiptNumber: row.receipt_number,
        link,
      }),
    );
    if (ok) sent += 1;
  }
  if (sent === 0)
    log.error("billing: confirmation e-mail not sent", { purchaseId, recipients: recipients.length });
}

/** What a grant, a review or a refund sends. */
export async function sendPurchaseNotices(
  db: BillingDb,
  event: AppliedEvent,
  options: NoticeOptions,
): Promise<void> {
  const { purchase, result } = event;
  const alert = {
    purchaseId: purchase.id,
    organizationId: purchase.organizationId,
    fedapayTransactionId: result.transaction.id,
  };
  try {
    if (result.outcome === "granted" || result.outcome === "already_granted") {
      await sendPaymentConfirmation(db, purchase.id, options);
    }
    if (
      result.outcome === "granted" &&
      (result.notice === "paid_after_expiry" || result.notice === "possible_duplicate")
    ) {
      await sendBillingAlert(db, { ...alert, kind: result.notice }, options);
    }
    if (result.outcome === "review") {
      await sendBillingAlert(db, { ...alert, kind: "review", reason: result.notice }, options);
    }
    if (result.outcome === "refunded") {
      await sendBillingAlert(db, { ...alert, kind: "refund" }, options);
    }
  } catch (error) {
    log.error("billing: could not send the purchase e-mails", { purchaseId: purchase.id, error });
  }
}
