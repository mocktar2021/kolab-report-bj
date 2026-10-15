import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";
import {
  getTransaction,
  getTransactionByMerchantReference,
  type FedapayError,
  type FedapayTransaction,
} from "./fedapay";
import type { FedapayConfig } from "./settings";

// Re-read and apply (ADR 001, sections 8.3 to 8.7). The webhook, the return
// page and the reconciliation all end here: whatever they were told, the
// status, amount, currency and merchant reference come from FedaPay's API,
// read with our secret key, and billing_apply_transaction compares them with
// the purchase and grants once, in one database transaction under the
// organization lock. Calling it twice, or from two places at once, grants
// once.

/** The service-role client, or a stand-in with the same calls in tests. */
export type BillingDb = Pick<SupabaseClient<Database>, "rpc" | "from">;

export type FedapayReader = {
  getTransaction: typeof getTransaction;
  getTransactionByMerchantReference: typeof getTransactionByMerchantReference;
};

export type ApplySource = "webhook" | "return" | "reconcile" | "checkout";

/** What billing_apply_transaction did. */
export const APPLY_OUTCOMES = [
  "granted",
  "already_granted",
  "review",
  "refunded",
  "expired",
  "not_paid",
  "pending",
  "unchanged",
  "ignored",
  "not_found",
] as const;

export type ApplyOutcome = (typeof APPLY_OUTCOMES)[number];

/** A purchase as the server reads it with the service role, by id. */
export type PurchaseRef = {
  id: string;
  organizationId: string | null;
  environment: string;
  status: string;
  fedapayTransactionId: number | null;
  merchantReference: string;
  createdAt: string;
  lastCheckedAt: string | null;
};

export type Applied = {
  ok: true;
  outcome: ApplyOutcome;
  /** With granted: paid_after_expiry or possible_duplicate. With review: what did not match. */
  notice: string | null;
  transaction: FedapayTransaction;
  entitlementId: string | null;
  packId: string | null;
  endsAt: string | null;
  receiptNumber: string | null;
};

export type ApplyFailure = {
  ok: false;
  /**
   * environment: the purchase belongs to another FedaPay environment.
   * no_transaction: FedaPay has no transaction for this purchase yet.
   * fedapay: FedaPay could not be read. database: the grant failed.
   */
  reason: "environment" | "no_transaction" | "fedapay" | "database";
  /** What FedaPay said, when it was read. */
  transaction?: FedapayTransaction;
  error?: FedapayError;
};

export type ApplyResult = Applied | ApplyFailure;

/** What happened, for the e-mails sent once the grant has committed. */
export type AppliedEvent = {
  purchase: PurchaseRef;
  result: Applied;
  source: ApplySource;
};

export type ApplyDeps = {
  db: BillingDb;
  /** The FedaPay account of this deployment (BillingSettings.api or .webhook.api). */
  api: FedapayConfig;
  fedapay?: FedapayReader;
  /** Sends the confirmation and the alerts. Never throws. */
  notify?: (event: AppliedEvent) => Promise<void>;
};

/**
 * FedaPay's id of the CFA franc (XOF): the API reference shows transactions
 * with currency_id 1 and no currency code. A real sandbox transaction must
 * confirm it (docs/security/fedapay-webhook.md). Until then, a transaction
 * that shows neither XOF nor this id goes to review.
 */
export const FEDAPAY_XOF_CURRENCY_ID = 1;

/** The ISO currency of a transaction, null when FedaPay's answer does not say. */
export function transactionCurrency(transaction: FedapayTransaction): string | null {
  if (transaction.currencyIso) return transaction.currencyIso;
  if (transaction.currencyId === FEDAPAY_XOF_CURRENCY_ID) return "XOF";
  return null;
}

const PURCHASE_COLUMNS =
  "id, organization_id, environment, status, fedapay_transaction_id, merchant_reference, created_at, last_checked_at";

type PurchaseRow = {
  id: string;
  organization_id: string | null;
  environment: string;
  status: string;
  fedapay_transaction_id: number | null;
  merchant_reference: string;
  created_at: string;
  last_checked_at: string | null;
};

function toPurchaseRef(row: PurchaseRow): PurchaseRef {
  return {
    id: row.id,
    organizationId: row.organization_id,
    environment: row.environment,
    status: row.status,
    fedapayTransactionId: row.fedapay_transaction_id,
    merchantReference: row.merchant_reference,
    createdAt: row.created_at,
    lastCheckedAt: row.last_checked_at,
  };
}

/** One purchase by id, with the service role. Null when unknown or on error. */
export async function loadPurchase(db: BillingDb, purchaseId: string): Promise<PurchaseRef | null> {
  const { data, error } = await db
    .from("billing_purchases")
    .select(PURCHASE_COLUMNS)
    .eq("id", purchaseId)
    .maybeSingle();
  if (error) {
    log.error("billing: could not read a purchase", { purchaseId, error: error.message });
    return null;
  }
  return data ? toPurchaseRef(data as PurchaseRow) : null;
}

type ApplyRow = {
  outcome: string;
  notice: string | null;
  entitlement_id: string | null;
  pack_id: string | null;
  ends_at: string | null;
  receipt_number: string | null;
};

function isOutcome(value: string): value is ApplyOutcome {
  return (APPLY_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Re-reads the purchase's transaction from FedaPay and applies it. Nothing
 * from a webhook body or a URL is used: the transaction id comes from the
 * purchase row, or FedaPay finds it by the purchase's merchant reference.
 * The e-mails go out after the database has committed.
 */
export async function applyPurchase(
  deps: ApplyDeps,
  purchase: PurchaseRef,
  options: { source: ApplySource; eventId?: string | null; eventName?: string | null },
): Promise<ApplyResult> {
  const fields = { purchaseId: purchase.id, source: options.source };
  // A sandbox deployment never reads or grants a live purchase, and the
  // other way round (ADR 001, 8.9).
  if (purchase.environment !== deps.api.environment) {
    log.error("billing: purchase of another environment", {
      ...fields,
      purchaseEnvironment: purchase.environment,
      environment: deps.api.environment,
    });
    return { ok: false, reason: "environment" };
  }

  const fedapay = deps.fedapay ?? { getTransaction, getTransactionByMerchantReference };
  const read =
    purchase.fedapayTransactionId !== null
      ? await fedapay.getTransaction(deps.api, purchase.fedapayTransactionId)
      : await fedapay.getTransactionByMerchantReference(deps.api, purchase.merchantReference);
  if (!read.ok) {
    if (read.error.code === "not_found" && purchase.fedapayTransactionId === null) {
      return { ok: false, reason: "no_transaction", error: read.error };
    }
    log.error("billing: fedapay request failed", {
      ...fields,
      request: read.error.request,
      status: read.error.status,
      code: read.error.code,
    });
    return { ok: false, reason: "fedapay", error: read.error };
  }
  const transaction = read.value;

  const { data, error } = await deps.db.rpc("billing_apply_transaction", {
    p_purchase_id: purchase.id,
    p_source: options.source,
    p_transaction_id: transaction.id,
    p_status: transaction.status,
    p_amount_xof: transaction.amountXof,
    p_environment: deps.api.environment,
    p_currency: transactionCurrency(transaction) ?? undefined,
    p_merchant_reference: transaction.merchantReference ?? undefined,
    p_event_id: options.eventId ?? undefined,
    p_event_name: options.eventName ?? undefined,
    p_reference: transaction.reference ?? undefined,
    p_mode: transaction.mode ?? undefined,
    p_fees_xof: transaction.feesXof ?? undefined,
    p_approved_at: transaction.approvedAt ?? undefined,
  });
  const row = (Array.isArray(data) ? data[0] : data) as ApplyRow | undefined | null;
  if (error || !row || !isOutcome(row.outcome)) {
    log.error("billing: could not apply a transaction", {
      ...fields,
      fedapayTransactionId: transaction.id,
      fedapayStatus: transaction.status,
      error: error?.message ?? "no answer",
    });
    Sentry.captureException(new Error("billing: could not apply a transaction"), {
      tags: { purchaseId: purchase.id },
    });
    return { ok: false, reason: "database", transaction };
  }

  const result: Applied = {
    ok: true,
    outcome: row.outcome,
    notice: row.notice,
    transaction,
    entitlementId: row.entitlement_id,
    packId: row.pack_id,
    endsAt: row.ends_at,
    receiptNumber: row.receipt_number,
  };

  if (result.outcome === "granted") {
    log.info("billing: purchase granted", {
      ...fields,
      organizationId: purchase.organizationId,
      entitlementId: result.entitlementId,
      packId: result.packId,
      receiptNumber: result.receiptNumber,
      fedapayTransactionId: transaction.id,
      notice: result.notice,
    });
  } else if (result.outcome === "review") {
    log.error("billing: purchase needs review", {
      ...fields,
      reason: result.notice,
      fedapayTransactionId: transaction.id,
    });
  } else if (result.outcome === "refunded") {
    log.warn("billing: refund seen", { ...fields, fedapayTransactionId: transaction.id });
  }

  if (deps.notify) await deps.notify({ purchase, result, source: options.source });
  return result;
}
