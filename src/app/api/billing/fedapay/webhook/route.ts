import { NextResponse } from "next/server";
import { applyPurchase, loadPurchase } from "@/lib/billing/apply";
import { applyDeps } from "@/lib/billing/server";
import { getBillingSettings } from "@/lib/billing/settings";
import { parseWebhookEvent } from "@/lib/billing/webhook-event";
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from "@/lib/billing/webhook-signature";
import { log, withRequestId } from "@/lib/log";

// FedaPay webhook (ADR 001, section 8.4). The middleware skips /api, so no
// session is involved: the signature is the only proof, and even a valid
// delivery only makes the server re-read the transaction from FedaPay's API
// with its own key. Nothing is granted from the body.
//
// 1. Read the raw body, 100 KB at most, and check X-FEDAPAY-SIGNATURE on it
//    (401 when it fails). Parse the JSON only then (400 when it is not).
// 2. Answer 200 to events about anything but a transaction, to transactions
//    of no purchase of this environment, and to an event already applied.
// 3. Otherwise re-read the transaction and apply it, then answer 200. When
//    FedaPay or the database fails, answer 500: FedaPay retries, and the
//    reconciliation catches what it does not.
// Answers carry a fixed word, never a detail. Logs carry ids, never the body.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 100_000;

function answer(status: number, body: Record<string, string | boolean>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

const RECEIVED = { received: true };

/** The body as text, or null when it is larger than MAX_BODY_BYTES. */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const POST = withRequestId(async (request: Request) => {
  const settings = getBillingSettings();
  // getBillingSettings logs which rule failed.
  if (!settings.webhook) return answer(503, { error: "unavailable" });

  const raw = await readBody(request);
  if (raw === null) {
    log.warn("billing: webhook rejected", { reason: "size" });
    return answer(413, { error: "too large" });
  }
  const signature = verifyWebhookSignature({
    header: request.headers.get(WEBHOOK_SIGNATURE_HEADER),
    rawBody: raw,
    secret: settings.webhook.secret,
  });
  if (!signature.ok) {
    log.warn("billing: webhook rejected", { reason: signature.reason });
    return answer(401, { error: "invalid signature" });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    log.warn("billing: webhook rejected", { reason: "json" });
    return answer(400, { error: "invalid body" });
  }
  const event = parseWebhookEvent(body);
  if (!event.name?.startsWith("transaction.")) {
    log.info("billing: webhook ignored", { eventName: event.name });
    return answer(200, RECEIVED);
  }
  if (event.transactionId === null) {
    log.warn("billing: webhook ignored", { eventName: event.name, reason: "no transaction id" });
    return answer(200, RECEIVED);
  }

  const deps = applyDeps(settings, settings.webhook.api);
  const { data, error } = await deps.db.rpc("billing_find_purchase", {
    p_environment: settings.webhook.api.environment,
    p_transaction_id: event.transactionId,
    p_merchant_reference: event.merchantReference ?? undefined,
    p_event_id: event.id ?? undefined,
  });
  if (error) {
    log.error("billing: webhook could not look up its purchase", {
      fedapayTransactionId: event.transactionId,
      error: error.message,
    });
    return answer(500, { error: "retry" });
  }
  const found = (Array.isArray(data) ? data[0] : data) as
    { purchase_id: string; event_seen: boolean } | undefined | null;
  // The FedaPay account may serve other products: not ours, nothing to do.
  if (!found) {
    log.info("billing: webhook for an unknown transaction", {
      eventName: event.name,
      fedapayTransactionId: event.transactionId,
    });
    return answer(200, RECEIVED);
  }
  if (found.event_seen) {
    log.info("billing: webhook already handled", {
      purchaseId: found.purchase_id,
      eventId: event.id,
      eventName: event.name,
    });
    return answer(200, RECEIVED);
  }

  const purchase = await loadPurchase(deps.db, found.purchase_id);
  if (!purchase) return answer(500, { error: "retry" });
  const result = await applyPurchase(deps, purchase, {
    source: "webhook",
    eventId: event.id,
    eventName: event.name,
  });
  if (!result.ok && (result.reason === "fedapay" || result.reason === "database")) {
    return answer(500, { error: "retry" });
  }
  return answer(200, RECEIVED);
});
