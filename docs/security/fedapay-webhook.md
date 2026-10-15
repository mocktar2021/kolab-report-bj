# FedaPay webhook and payment grants

How a FedaPay payment turns into an entitlement, and why a forged, replayed or tampered request cannot grant one. Design: [ADR 001](../adr/001-billing-and-fedapay.md), sections 8 and 11. Code: `src/app/api/billing/fedapay/webhook/route.ts`, `src/lib/billing/apply.ts`, and `public.billing_apply_transaction` in `supabase/migrations/20261015130000_billing_purchases.sql`. Jira KRB-176.

## The rule

Nothing is granted from a request body or a URL. The webhook, the return page and the reconciliation only tell the server which purchase to look at. The server then reads the transaction from FedaPay's API with its own secret key, and `billing_apply_transaction` compares what FedaPay says with the purchase before it grants anything.

## Webhook, step by step

`POST /api/billing/fedapay/webhook`, Node.js runtime. The middleware skips `/api`, so no session is involved.

| Step | Check | Answer when it fails |
| --- | --- | --- |
| 1 | Settings of this deployment pass the fail-closed rules of `src/lib/billing/settings.ts` (live only in production, never a mock or sandbox key there) | 503 |
| 2 | Body read as raw bytes, 100 KB at most | 413 |
| 3 | `X-FEDAPAY-SIGNATURE` (`t=<unix>,s=<hex>`): HMAC-SHA256 of `<t>.<raw body>` with `FEDAPAY_WEBHOOK_SECRET`, compared in constant time, timestamp within 300 seconds either way (`src/lib/billing/webhook-signature.ts`) | 401 |
| 4 | JSON parses | 400 |
| 5 | Event name starts with `transaction.` | 200, ignored |
| 6 | The transaction id (`entity.id`, else `object_id`) belongs to a purchase of this environment, or a purchase not yet linked has the event's merchant reference (`billing_find_purchase`) | 200, ignored: the account may serve other products |
| 7 | The event id was not applied already | 200 right away |
| 8 | `GET /v1/transactions/{id}` with the secret key; the transaction id comes from the purchase row | 500, FedaPay retries |
| 9 | `billing_apply_transaction` in one database transaction | 500, FedaPay retries |
| 10 | Done | 200 |

Answers carry a fixed word (`received`, `invalid signature`, `retry`), never a detail. The logs carry ids and a reason code, never the body, a header value or a secret (`billing: webhook rejected` with `reason`, `billing: purchase granted`, `billing: purchase needs review`).

## What the grant checks

`billing_apply_transaction` locks the purchase row, records the payment event (an event id is recorded once per purchase), then for an `approved` or `transferred` transaction:

- already granted: returns `already_granted`, nothing changes;
- FedaPay's amount, currency, merchant reference or environment differs from the purchase: status `review`, an audit event, an e-mail to `BILLING_ALERT_EMAIL`, no grant;
- otherwise it takes the organization's billing lock, computes the period (ADR 6.3), inserts the entitlement or the pack, marks the purchase paid and numbers the receipt, all in the same transaction.

The entitlement, the pack and the receipt each have a unique index on the purchase, so even a bug in the caller cannot grant twice. Declined and canceled transactions leave the purchase pending, because FedaPay lets the customer try again. A refund marks the purchase refunded and alerts the operator; nothing is revoked on its own.

## Other paths

- **Return page** (`/fr/organisations/<id>/abonnement/retour/<purchase>`): reads the purchase with the user's rights (RLS), ignores `id` and `status` in the URL except to pick the first message, and re-reads the purchase's own transaction at most every 10 seconds. A URL carrying another approved transaction pays for nothing (end-to-end test `a return URL carrying another paid transaction pays nothing`).
- **Checkout** (`startCheckout`): the form sends an offer code, never an amount. `billing_create_purchase` runs with the service role and checks that the buyer owns the organization or one of its workspaces (`private.billing_user_can_manage`).
- **Reconciliation** (`src/lib/billing/reconcile.ts`): the same re-read and apply for pending purchases, from the billing page and, with KRB-178, the daily cron.

## Environments

Purchases record their FedaPay environment (`sandbox`, `live`, `mock`). A deployment only reads and applies purchases of its own environment, the webhook looks purchases up by environment and transaction id, and the grant refuses an environment that differs. Staging and PR previews use the sandbox account and the staging database; production uses the live account and its own database.

## Not covered on purpose

- **IP filtering.** FedaPay does not publish its webhook addresses. The signature and the re-read are enough.
- **Answering before processing.** FedaPay suggests answering 2xx first. We process first (one API call and one database transaction) because a Vercel function may stop once it has answered.

## What a real sandbox payment must confirm

The code reads the likely shapes; one sandbox payment on staging has to confirm them (ADR 001, section 13, items 1 to 9):

1. The webhook body: event name under `name` or `type`, event id under `id`, the transaction under `entity` (or `object_id`). Check one delivery in the FedaPay logs.
2. The currency on `GET /v1/transactions/{id}`: a `currency` object with `iso`, or only `currency_id`. The code takes `currency_id` 1 as XOF (`FEDAPAY_XOF_CURRENCY_ID` in `src/lib/billing/apply.ts`). If XOF has another id, every payment goes to review until the constant is fixed.
3. The answer to a second `POST /v1/transactions` with a merchant reference already used (the code treats any 4xx as "look it up by reference").
4. The shape of `GET /v1/transactions/merchant/{reference}`: one transaction, wrapped or not, or a list.
5. The webhook secret prefix (`wh_sandbox...` and `wh_live...`), checked by `src/lib/billing/settings.ts`.
6. The host of the payment page behind `token.url`, in case a browser ever needs it in `form-action` (not needed today: the redirect after the server action is a client-side navigation).
7. Whether FedaPay's `amount` is what the customer was asked for or includes fees: the grant compares it with the purchase amount.
