import "server-only";
import { log } from "@/lib/log";
import { applyPurchase, type ApplyDeps, type PurchaseRef } from "./apply";

// Reconciliation (ADR 001, section 8.7): pending purchases are checked with
// FedaPay again, so a payment whose webhook was lost, and whose customer
// never came back, is still granted. It runs from the billing page for one
// organization, and from the daily cron (KRB-178) for every purchase.
// Purchases still pending 48 hours after their creation expire; a payment
// approved after that still grants.

export type ReconcileSummary = {
  checked: number;
  granted: number;
  expired: number;
  failed: number;
};

export type ReconcileOptions = {
  /** How many purchases at most, oldest check first. */
  limit?: number;
  /** One organization only (billing page). */
  organizationId?: string;
  /** Skip purchases checked more recently than this, a Postgres interval. */
  recheckAfter?: string;
  /** Called when FedaPay approved a payment that could not be granted for 15 minutes. */
  onStuck?: (purchase: PurchaseRef, fedapayTransactionId: number) => Promise<void>;
};

type PendingRow = {
  purchase_id: string;
  organization_id: string | null;
  fedapay_transaction_id: number | null;
  merchant_reference: string;
  created_at: string;
};

/** A transaction approved this long ago and still not granted gets an alert. */
const STUCK_AFTER_MS = 15 * 60 * 1000;

const PAID_STATUSES = new Set(["approved", "transferred"]);

export async function reconcilePendingPurchases(
  deps: ApplyDeps,
  options: ReconcileOptions = {},
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, granted: 0, expired: 0, failed: 0 };
  const { data, error } = await deps.db.rpc("billing_pending_purchases", {
    p_environment: deps.api.environment,
    p_limit: options.limit ?? 20,
    p_organization_id: options.organizationId,
    p_recheck_after: options.recheckAfter,
  });
  if (error) {
    log.error("billing: could not list pending purchases", { error: error.message });
    summary.failed += 1;
    return summary;
  }

  for (const row of (data ?? []) as PendingRow[]) {
    const purchase: PurchaseRef = {
      id: row.purchase_id,
      organizationId: row.organization_id,
      environment: deps.api.environment,
      status: "pending",
      fedapayTransactionId: row.fedapay_transaction_id,
      merchantReference: row.merchant_reference,
      createdAt: row.created_at,
      lastCheckedAt: null,
    };
    const result = await applyPurchase(deps, purchase, { source: "reconcile" });

    if (!result.ok && result.reason !== "no_transaction") {
      summary.failed += 1;
      const approvedAt = result.transaction?.approvedAt;
      if (
        result.reason === "database" &&
        result.transaction &&
        PAID_STATUSES.has(result.transaction.status) &&
        approvedAt &&
        Date.now() - new Date(approvedAt).getTime() > STUCK_AFTER_MS
      ) {
        await options.onStuck?.(purchase, result.transaction.id);
      }
      continue;
    }

    summary.checked += 1;
    if (result.ok && result.outcome === "granted") summary.granted += 1;
    if (result.ok && result.outcome === "expired") summary.expired += 1;
    // Still pending at FedaPay, or no transaction there: expires after 48 hours.
    if (!result.ok || result.outcome === "pending" || result.outcome === "not_paid") {
      const { data: status, error: checkError } = await deps.db.rpc("billing_check_pending", {
        p_purchase_id: purchase.id,
      });
      if (checkError) {
        log.error("billing: could not check a pending purchase", {
          purchaseId: purchase.id,
          error: checkError.message,
        });
        summary.failed += 1;
      } else if (status === "expired") {
        summary.expired += 1;
      }
    }
  }

  log.info("billing: reconcile finished", { ...summary, organizationId: options.organizationId ?? null });
  return summary;
}
