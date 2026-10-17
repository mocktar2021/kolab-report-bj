import "server-only";
import { log } from "@/lib/log";
import { applyPurchase, loadPurchase, type ApplyDeps } from "./apply";
import {
  CATALOG_VERSION,
  OFFERS,
  isOfferCode,
  offerAmountHtXof,
  offerTerms,
  taxLines,
  type OfferCode,
} from "./catalog";
import {
  createToken,
  createTransaction,
  getTransaction,
  getTransactionByMerchantReference,
  type FedapayCustomer,
  type FedapayTransaction,
} from "./fedapay";

// Checkout (ADR 001, section 8.2). The browser sends an offer code, a pack
// quantity and, for a pass, a workspace. The amount, the label and the terms
// come from the catalogue. The database checks the buyer's right to pay and
// the offer's preconditions, then FedaPay gets a transaction with the
// purchase's merchant reference, and the buyer goes to FedaPay's payment
// page. A pending order less than 24 hours old is paid again on the same
// transaction instead of a new one, so two tabs never pay twice.

export type CheckoutRequest = {
  organizationId: string;
  offer: string;
  quantity: number;
  /** The workspace a Pass Mission covers. */
  workspaceId: string | null;
  buyer: { id: string; email: string; name: string | null };
};

/** Keys of Billing.checkout.errors in messages/fr.json. */
export type CheckoutError =
  | "invalidOffer"
  | "forbidden"
  | "review"
  | "missionWorkspace"
  | "packNeedsPlan"
  | "packLimit"
  | "unavailable";

export type CheckoutResult =
  { ok: true; purchaseId: string; url: string } | { ok: false; error: CheckoutError };

export type CheckoutDeps = ApplyDeps & {
  /** NEXT_PUBLIC_APP_URL: FedaPay sends the buyer back there. */
  appUrl: string;
  fedapay?: ApplyDeps["fedapay"] & {
    createTransaction: typeof createTransaction;
    createToken: typeof createToken;
  };
};

const REFUSALS = new Set<CheckoutError>([
  "forbidden",
  "review",
  "missionWorkspace",
  "packNeedsPlan",
  "packLimit",
]);

/** Statuses on which FedaPay lets the customer pay again (declined and canceled are not final). */
const PAYABLE = new Set(["pending", "declined", "canceled"]);

/** Where FedaPay sends the buyer back, with ?id=&status= added. */
export function returnUrl(appUrl: string, organizationId: string, purchaseId: string): string {
  return `${appUrl.replace(/\/+$/, "")}/fr/organisations/${organizationId}/abonnement/retour/${purchaseId}`;
}

/** "Awa Dossou" into a first and a last name for FedaPay's customer. A bare e-mail gives neither. */
export function customerFromBuyer(buyer: CheckoutRequest["buyer"]): FedapayCustomer {
  const name = buyer.name?.trim();
  if (!name || name.includes("@")) return { email: buyer.email };
  const [firstname, ...rest] = name.split(/\s+/);
  return {
    email: buyer.email,
    firstname: firstname?.slice(0, 100),
    ...(rest.length > 0 ? { lastname: rest.join(" ").slice(0, 100) } : {}),
  };
}

/** "KolabReport, offre Cabinet, 1 mois, Cabinet Dossou", at most 255 characters. */
export function transactionDescription(offer: OfferCode, quantity: number, organizationName: string): string {
  const label = quantity > 1 ? `${OFFERS[offer].label} (x${quantity})` : OFFERS[offer].label;
  return `KolabReport, offre ${label}, ${organizationName}`.slice(0, 255);
}

type CreatedRow = {
  purchase_id: string | null;
  merchant_reference: string | null;
  fedapay_transaction_id: number | null;
  reused: boolean;
  refusal: string | null;
};

async function createPurchase(
  deps: CheckoutDeps,
  request: CheckoutRequest & { offer: OfferCode },
  amountHtXof: number,
  taxXof: number,
  reuse: boolean,
): Promise<CreatedRow | CheckoutError> {
  const { data, error } = await deps.db.rpc("billing_create_purchase", {
    p_organization_id: request.organizationId,
    p_offer: request.offer,
    p_offer_label: OFFERS[request.offer].label,
    p_catalog_version: CATALOG_VERSION,
    p_quantity: request.quantity,
    p_terms: offerTerms(request.offer),
    p_amount_ht_xof: amountHtXof,
    p_tax_xof: taxXof,
    p_environment: deps.api.environment,
    p_created_by: request.buyer.id,
    p_workspace_id: request.workspaceId ?? undefined,
    p_reuse: reuse,
  });
  const row = (Array.isArray(data) ? data[0] : data) as CreatedRow | undefined | null;
  if (error || !row) {
    log.error("billing: could not create a purchase", {
      organizationId: request.organizationId,
      offer: request.offer,
      error: error?.message ?? "no answer",
    });
    return "unavailable";
  }
  if (row.refusal) {
    return REFUSALS.has(row.refusal as CheckoutError) ? (row.refusal as CheckoutError) : "unavailable";
  }
  return row;
}

/** The transaction of a new purchase: created, or found by merchant reference after an unclear failure. */
async function ensureTransaction(
  deps: CheckoutDeps,
  request: CheckoutRequest & { offer: OfferCode },
  purchaseId: string,
  merchantReference: string,
  amountXof: number,
): Promise<FedapayTransaction | null> {
  const fedapay = { createTransaction, getTransactionByMerchantReference, ...deps.fedapay };
  const { data: organization } = await deps.db
    .from("organizations")
    .select("name")
    .eq("id", request.organizationId)
    .maybeSingle();
  const created = await fedapay.createTransaction(deps.api, {
    description: transactionDescription(request.offer, request.quantity, organization?.name ?? ""),
    amountXof,
    callbackUrl: returnUrl(deps.appUrl, request.organizationId, purchaseId),
    merchantReference,
    customMetadata: { purchase_id: purchaseId },
    customer: customerFromBuyer(request.buyer),
  });
  if (created.ok) return created.value;

  // A timeout may hide a transaction FedaPay did create, and a refusal may be
  // the duplicate merchant reference of an earlier attempt: look it up.
  if (created.error.transient || created.error.code === "rejected") {
    const found = await fedapay.getTransactionByMerchantReference(deps.api, merchantReference);
    if (found.ok) return found.value;
  }
  log.error("billing: fedapay request failed", {
    purchaseId,
    request: created.error.request,
    status: created.error.status,
    code: created.error.code,
  });
  return null;
}

async function paymentPage(
  deps: CheckoutDeps,
  purchaseId: string,
  transactionId: number,
): Promise<string | null> {
  const token = await (deps.fedapay?.createToken ?? createToken)(deps.api, transactionId);
  if (token.ok) return token.value.url;
  log.error("billing: fedapay request failed", {
    purchaseId,
    request: token.error.request,
    status: token.error.status,
    code: token.error.code,
  });
  return null;
}

/**
 * Starts or resumes a payment and returns the page to send the buyer to:
 * FedaPay's payment page, or the return page when the order turns out to be
 * paid already.
 */
export async function startPurchase(deps: CheckoutDeps, request: CheckoutRequest): Promise<CheckoutResult> {
  if (!isOfferCode(request.offer)) return { ok: false, error: "invalidOffer" };
  const offer = request.offer;
  let amountHtXof: number;
  try {
    amountHtXof = offerAmountHtXof(offer, request.quantity);
  } catch {
    return { ok: false, error: "invalidOffer" };
  }
  if ((OFFERS[offer].kind === "mission") !== (request.workspaceId !== null)) {
    return { ok: false, error: "invalidOffer" };
  }
  const taxXof = taxLines(offer, amountHtXof).reduce((sum, line) => sum + line.amountXof, 0);
  const typed = { ...request, offer };

  let created = await createPurchase(deps, typed, amountHtXof, taxXof, true);
  if (typeof created === "string") return { ok: false, error: created };

  // The same order is already pending: pay it again on its transaction while
  // FedaPay still takes payments on it.
  if (created.reused && created.fedapay_transaction_id !== null && created.purchase_id) {
    const existing = await (deps.fedapay?.getTransaction ?? getTransaction)(
      deps.api,
      created.fedapay_transaction_id,
    );
    if (!existing.ok) return { ok: false, error: "unavailable" };
    if (!PAYABLE.has(existing.value.status)) {
      // Paid in the meantime, or expired: apply what FedaPay says.
      const purchase = await loadPurchase(deps.db, created.purchase_id);
      if (purchase) await applyPurchase(deps, purchase, { source: "checkout" });
      if (existing.value.status === "approved" || existing.value.status === "transferred") {
        return {
          ok: true,
          purchaseId: created.purchase_id,
          url: returnUrl(deps.appUrl, request.organizationId, created.purchase_id),
        };
      }
      created = await createPurchase(deps, typed, amountHtXof, taxXof, false);
      if (typeof created === "string") return { ok: false, error: created };
    }
  }

  const purchaseId = created.purchase_id;
  const merchantReference = created.merchant_reference;
  if (!purchaseId || !merchantReference) return { ok: false, error: "unavailable" };

  let transactionId = created.fedapay_transaction_id;
  if (transactionId === null) {
    const transaction = await ensureTransaction(
      deps,
      typed,
      purchaseId,
      merchantReference,
      amountHtXof + taxXof,
    );
    if (!transaction) return { ok: false, error: "unavailable" };
    // Never pay a purchase on a transaction for another amount or reference.
    if (
      transaction.amountXof !== amountHtXof + taxXof ||
      transaction.merchantReference !== merchantReference
    ) {
      log.error("billing: fedapay transaction does not match its purchase", {
        purchaseId,
        fedapayTransactionId: transaction.id,
      });
      return { ok: false, error: "unavailable" };
    }
    const { error } = await deps.db.rpc("billing_set_transaction", {
      p_purchase_id: purchaseId,
      p_transaction_id: transaction.id,
      p_status: transaction.status,
    });
    if (error) {
      log.error("billing: could not link a fedapay transaction", { purchaseId, error: error.message });
      return { ok: false, error: "unavailable" };
    }
    transactionId = transaction.id;
  }

  const url = await paymentPage(deps, purchaseId, transactionId);
  if (!url) return { ok: false, error: "unavailable" };
  log.info("billing: checkout started", {
    purchaseId,
    organizationId: request.organizationId,
    offer,
    quantity: request.quantity,
    amountXof: amountHtXof + taxXof,
    fedapayTransactionId: transactionId,
    reused: created.reused,
  });
  return { ok: true, purchaseId, url };
}
