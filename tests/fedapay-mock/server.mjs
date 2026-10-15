// FedaPay mock for local work and the end-to-end tests (ADR 001, section 13).
// Only node:http and node:crypto, no package. Playwright starts it as a
// second webServer (playwright.config.ts). By hand:
//   node --env-file=.env.local tests/fedapay-mock/server.mjs
//
// It keeps transactions in memory, serves a payment page, and posts signed
// webhooks to the app the way FedaPay does (X-FEDAPAY-SIGNATURE, see
// src/lib/billing/webhook-signature.ts).
//
// Environment:
//   FEDAPAY_MOCK_PORT         port on 127.0.0.1, 4010 by default
//   FEDAPAY_SECRET_KEY        the Bearer key the app must send (any key when unset)
//   FEDAPAY_WEBHOOK_SECRET    signs the webhooks (wh_mock_local when unset)
//   FEDAPAY_MOCK_WEBHOOK_URL  where webhooks go, by default
//                             <NEXT_PUBLIC_APP_URL>/api/billing/fedapay/webhook
//   FEDAPAY_MOCK_WEBHOOK      default switch: send, skip or twice
//   FEDAPAY_MOCK_AMOUNT       default amount reported once paid (empty: unchanged)
//   FEDAPAY_MOCK_WRAP         "0" answers objects at the top level, otherwise
//                             under "v1/transaction" like the SDK fixtures
//
// Switches for one payment, as query parameters of the payment page (the
// page copies them into its form) or as fields of a direct POST:
//   webhook=send|skip|twice   twice sends the same event again, signed anew
//   amount=<XOF>              the amount FedaPay reports once paid
//
// FedaPay API (Authorization: Bearer <key>):
//   POST /v1/transactions
//   POST /v1/transactions/:id/token
//   GET  /v1/transactions/:id
//   GET  /v1/transactions/merchant/:reference
// Payment page:
//   GET  /pay/:token   buttons Approuver, Refuser and Annuler
//   POST /pay/:token   action=approve|decline|cancel: sends the webhook, then
//                      redirects (303) to callback_url?id=<id>&status=<status>
// Test helpers:
//   GET  /health
//   GET  /__mock/transactions/:id           the transaction and its deliveries
//   POST /__mock/transactions/:id/webhook   a new event for its status; with
//                                           ?replay=1 the last one again ("Re-déclencher")
//   POST /__mock/reset                      forgets every transaction

import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PORT = Number(process.env.FEDAPAY_MOCK_PORT || 4010);
const ORIGIN = `http://${HOST}:${PORT}`;
const SECRET_KEY = process.env.FEDAPAY_SECRET_KEY?.trim() || null;
const WEBHOOK_SECRET = process.env.FEDAPAY_WEBHOOK_SECRET?.trim() || "wh_mock_local";
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const WEBHOOK_URL = process.env.FEDAPAY_MOCK_WEBHOOK_URL || `${APP_URL}/api/billing/fedapay/webhook`;
const DEFAULT_WEBHOOK = process.env.FEDAPAY_MOCK_WEBHOOK || "send";
const DEFAULT_AMOUNT = process.env.FEDAPAY_MOCK_AMOUNT || "";
const WRAP = process.env.FEDAPAY_MOCK_WRAP !== "0";
const MAX_BODY_BYTES = 100_000;

const WEBHOOK_SWITCHES = new Set(["send", "skip", "twice"]);
const ACTIONS = {
  approve: { status: "approved", stamp: "approved_at" },
  decline: { status: "declined", stamp: "declined_at" },
  cancel: { status: "canceled", stamp: "canceled_at" },
};
// FedaPay lets the customer try again until the transaction is paid or expires.
const PAYABLE = new Set(["pending", "declined", "canceled"]);

/** @type {Map<number, any>} */
const transactions = new Map();
/** @type {Map<string, number>} */
const byReference = new Map();
/** @type {Map<string, number>} token to transaction id */
const tokens = new Map();
// Ids start from the clock, so a restarted mock never reuses an id already
// stored on a purchase in the local database.
let nextId = Math.floor(Date.now() / 1000) * 1000;
let nextEventId = 1;

function now() {
  return new Date().toISOString();
}

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const type = typeof body === "string" ? "text/html; charset=utf-8" : "application/json";
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(text);
}

function wrapped(transaction) {
  return WRAP ? { "v1/transaction": transaction } : transaction;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function authorized(req) {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  return SECRET_KEY === null || match[1] === SECRET_KEY;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function createTransaction(input) {
  const errors = {};
  if (typeof input?.description !== "string" || !input.description.trim()) errors.description = ["required"];
  if (!Number.isInteger(input?.amount) || input.amount <= 0) errors.amount = ["must be a positive integer"];
  if (input?.currency?.iso !== "XOF") errors.currency = ["only XOF"];
  if (!isHttpUrl(input?.callback_url)) errors.callback_url = ["must be a URL"];
  if (typeof input?.merchant_reference !== "string" || !input.merchant_reference) {
    errors.merchant_reference = ["required"];
  }
  if (typeof input?.customer?.email !== "string") errors.customer = ["email required"];
  if (Object.keys(errors).length > 0) return { status: 422, body: { message: "Invalid data", errors } };
  if (byReference.has(input.merchant_reference)) {
    return {
      status: 400,
      body: { message: "Transaction creation failed", errors: { merchant_reference: ["already used"] } },
    };
  }

  const id = nextId++;
  const transaction = {
    id,
    reference: `trx_mock_${id}`,
    description: input.description,
    callback_url: input.callback_url,
    amount: input.amount,
    status: "pending",
    mode: null,
    fees: null,
    commission: null,
    amount_debited: null,
    amount_transferred: null,
    merchant_reference: input.merchant_reference,
    custom_metadata: input.custom_metadata ?? {},
    customer_id: 1,
    currency_id: 1,
    last_error_code: null,
    receipt_url: null,
    created_at: now(),
    updated_at: now(),
    approved_at: null,
    declined_at: null,
    canceled_at: null,
    refunded_at: null,
    transferred_at: null,
  };
  transactions.set(id, { transaction, deliveries: [], lastEvent: null });
  byReference.set(input.merchant_reference, id);
  return { status: 201, body: wrapped(transaction) };
}

/** Posts one event to the app, signed like FedaPay: t=<unix>,s=<HMAC-SHA256 of "<t>.<body>">. */
async function deliver(record, event) {
  const { body } = event;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
  let status;
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-FEDAPAY-SIGNATURE": `t=${timestamp},s=${signature}` },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = response.status;
    await response.body?.cancel();
  } catch (error) {
    status = `error: ${error.name}`;
  }
  record.deliveries.push({ eventId: event.id, name: event.name, status, at: now() });
  if (typeof status !== "number" || status >= 300) {
    console.error(`fedapay mock: webhook ${event.name} for ${record.transaction.id} got ${status}`);
  }
}

/** A new event for the transaction's current status, sent once, twice or not at all. */
async function sendWebhook(record, mode) {
  if (mode === "skip") {
    record.deliveries.push({ eventId: null, name: null, status: "skipped", at: now() });
    return;
  }
  const id = nextEventId++;
  const name = `transaction.${record.transaction.status}`;
  const body = JSON.stringify({
    id,
    name,
    object: "transaction",
    object_id: record.transaction.id,
    entity: record.transaction,
    created_at: now(),
  });
  record.lastEvent = { id, name, body };
  await deliver(record, record.lastEvent);
  // A duplicate delivery keeps the event id and body; FedaPay signs each retry again.
  if (mode === "twice") await deliver(record, record.lastEvent);
}

function paymentPage(token, record, switches) {
  const { transaction } = record;
  const hidden = Object.entries(switches)
    .filter(([, value]) => value)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("");
  const button = (action, label) =>
    `<form method="post" action="/pay/${escapeHtml(token)}">${hidden}` +
    `<input type="hidden" name="action" value="${action}"><button type="submit">${label}</button></form>`;
  return `<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8"><title>FedaPay (mock)</title></head>
  <body>
    <h1>Paiement FedaPay (mock)</h1>
    <p>${escapeHtml(transaction.description)}</p>
    <p>Montant : <strong>${transaction.amount} FCFA</strong></p>
    ${button("approve", "Approuver")}
    ${button("decline", "Refuser")}
    ${button("cancel", "Annuler")}
  </body>
</html>`;
}

function switchesFrom(params) {
  const webhook = params.get("webhook") || DEFAULT_WEBHOOK;
  const amount = params.get("amount") || DEFAULT_AMOUNT;
  return {
    webhook: WEBHOOK_SWITCHES.has(webhook) ? webhook : "send",
    amount: /^\d+$/.test(amount) ? amount : "",
  };
}

async function pay(req, res, token, url) {
  const id = tokens.get(token);
  const record = id === undefined ? undefined : transactions.get(id);
  if (!record) return send(res, 404, "<p>Lien de paiement inconnu ou déjà utilisé.</p>");
  if (!PAYABLE.has(record.transaction.status)) {
    return send(res, 409, "<p>Cette transaction est déjà traitée.</p>");
  }

  if (req.method === "GET") return send(res, 200, paymentPage(token, record, switchesFrom(url.searchParams)));

  const form = new URLSearchParams(await readBody(req));
  const action = ACTIONS[form.get("action")];
  if (!action) return send(res, 400, "<p>Action inconnue.</p>");
  const switches = switchesFrom(form);

  // A token pays once; "Réessayer" asks a new one.
  tokens.delete(token);
  const { transaction } = record;
  transaction.status = action.status;
  transaction[action.stamp] = now();
  transaction.updated_at = now();
  if (action.status !== "canceled") transaction.mode = "momo_test";
  if (action.status === "approved") {
    if (switches.amount) transaction.amount = Number(switches.amount);
    transaction.fees = Math.round(transaction.amount * 0.018);
    transaction.amount_debited = transaction.amount;
    transaction.amount_transferred = transaction.amount - transaction.fees;
    transaction.receipt_url = `${ORIGIN}/receipts/${transaction.reference}`;
  } else {
    transaction.last_error_code = action.status === "declined" ? "insufficient_funds" : null;
  }

  await sendWebhook(record, switches.webhook);

  const back = new URL(transaction.callback_url);
  back.searchParams.set("id", String(transaction.id));
  back.searchParams.set("status", transaction.status);
  res.writeHead(303, { Location: back.toString(), "Cache-Control": "no-store" });
  res.end();
}

async function api(req, res, path) {
  if (!authorized(req)) return send(res, 401, { message: "Unauthenticated." });

  if (req.method === "POST" && path === "/v1/transactions") {
    let input;
    try {
      input = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { message: "Invalid JSON" });
    }
    const { status, body } = createTransaction(input);
    return send(res, status, body);
  }

  const merchant = /^\/v1\/transactions\/merchant\/([^/]+)$/.exec(path);
  if (req.method === "GET" && merchant) {
    const id = byReference.get(decodeURIComponent(merchant[1]));
    const record = id === undefined ? undefined : transactions.get(id);
    return record
      ? send(res, 200, wrapped(record.transaction))
      : send(res, 404, { message: "Transaction not found" });
  }

  const token = /^\/v1\/transactions\/(\d+)\/token$/.exec(path);
  if (req.method === "POST" && token) {
    const record = transactions.get(Number(token[1]));
    if (!record) return send(res, 404, { message: "Transaction not found" });
    if (!PAYABLE.has(record.transaction.status)) {
      return send(res, 400, { message: "Transaction can no longer be paid" });
    }
    const value = randomBytes(16).toString("hex");
    tokens.set(value, record.transaction.id);
    return send(res, 200, { token: value, url: `${ORIGIN}/pay/${value}` });
  }

  const one = /^\/v1\/transactions\/(\d+)$/.exec(path);
  if (req.method === "GET" && one) {
    const record = transactions.get(Number(one[1]));
    return record
      ? send(res, 200, wrapped(record.transaction))
      : send(res, 404, { message: "Transaction not found" });
  }

  return send(res, 404, { message: "Not found" });
}

async function helpers(req, res, path, url) {
  if (req.method === "POST" && path === "/__mock/reset") {
    transactions.clear();
    byReference.clear();
    tokens.clear();
    return send(res, 200, { ok: true });
  }
  const match = /^\/__mock\/transactions\/(\d+)(\/webhook)?$/.exec(path);
  const record = match ? transactions.get(Number(match[1])) : undefined;
  if (!record) return send(res, 404, { message: "Not found" });
  if (req.method === "GET" && !match[2]) return send(res, 200, record);
  if (req.method === "POST" && match[2]) {
    // ?replay=1 sends the last event again, same id and body, like
    // "Re-déclencher" in FedaPay's logs. Otherwise a new event.
    if (url.searchParams.get("replay") === "1" && record.lastEvent) await deliver(record, record.lastEvent);
    else await sendWebhook(record, "send");
    return send(res, 200, record);
  }
  return send(res, 405, { message: "Method not allowed" });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", ORIGIN);
    const path = url.pathname;
    if (req.method === "GET" && path === "/health") return send(res, 200, { status: "ok" });
    if (path.startsWith("/v1/")) return await api(req, res, path);
    const page = /^\/pay\/([0-9a-f]+)$/.exec(path);
    if (page && (req.method === "GET" || req.method === "POST")) return await pay(req, res, page[1], url);
    if (path.startsWith("/__mock/")) return await helpers(req, res, path, url);
    return send(res, 404, { message: "Not found" });
  } catch (error) {
    console.error(`fedapay mock: ${error.message}`);
    if (!res.headersSent) send(res, 500, { message: "Mock error" });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`fedapay mock: listening on ${ORIGIN}, webhooks to ${WEBHOOK_URL}`);
});

// State lives in memory only, so there is nothing to flush.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => process.exit(0));
}
