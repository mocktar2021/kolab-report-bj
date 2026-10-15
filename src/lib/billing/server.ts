import "server-only";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ApplyDeps } from "./apply";
import type { CheckoutDeps } from "./checkout";
import { sendBillingAlert, sendPurchaseNotices, type NoticeOptions } from "./notify";
import type { ReconcileOptions } from "./reconcile";
import type { BillingSettings, FedapayConfig } from "./settings";

// The real dependencies of checkout, apply and reconcile: the service-role
// client, FedaPay's API, and the e-mails. Every query they make is scoped by
// a purchase id or an organization id (ADR 001, section 11).

function noticeOptions(settings: BillingSettings): NoticeOptions {
  return { alertEmail: settings.alertEmail, appUrl: publicEnv.NEXT_PUBLIC_APP_URL };
}

export function applyDeps(settings: BillingSettings, api: FedapayConfig): ApplyDeps {
  const db = createAdminClient();
  const options = noticeOptions(settings);
  return { db, api, notify: (event) => sendPurchaseNotices(db, event, options) };
}

export function checkoutDeps(settings: BillingSettings, api: FedapayConfig): CheckoutDeps {
  const { db, notify } = applyDeps(settings, api);
  return { db, api, notify, appUrl: publicEnv.NEXT_PUBLIC_APP_URL };
}

/** The alert for a payment approved at FedaPay that the reconciliation cannot grant. */
export function stuckAlert(settings: BillingSettings, deps: ApplyDeps): ReconcileOptions["onStuck"] {
  const options = noticeOptions(settings);
  return (purchase, fedapayTransactionId) =>
    sendBillingAlert(
      deps.db,
      {
        kind: "stuck",
        purchaseId: purchase.id,
        organizationId: purchase.organizationId,
        fedapayTransactionId,
      },
      options,
    );
}
