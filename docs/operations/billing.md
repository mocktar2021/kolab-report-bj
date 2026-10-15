# Billing

What to do when a reminder does not arrive, when a workspace stays read-only, when an organization needs a period by hand (KRB-178), and when a payment is stuck or refunded (KRB-176). Who sees the billing page and its receipts, and how to read a customer's receipts (KRB-177). The rules are in [ADR 001](../adr/001-billing-and-fedapay.md). The variables and the daily job are set up in [`docs/deployment.md`](../deployment.md#scheduled-jobs), and what to watch is in [`monitoring.md`](monitoring.md#billing).

Every query below runs in the SQL editor of the Supabase dashboard, with the rights of the database owner. Read before you write: every `update`, `insert` or `delete` here says which environment it is for.

## How access is decided

Nothing about access is stored. Each time the app or the database reads the state of a workspace, `private.workspace_access` computes it from the entitlements of its line (the organization's subscription, or the passes of a mission workspace) and the time:

| State | When |
| --- | --- |
| `trialing` | The trial entitlement covers now |
| `active` | Another entitlement covers now |
| `grace` | Nothing covers now, and the last one ended less than `grace_days` (7) ago |
| `read_only` | Anything else, including an organization that never had an entitlement |

While `private.billing_settings.enforced` is false, every workspace reads as active with no limit and no reminder is due.

In read-only, the database refuses every insert and update made in a user's name on reports, sections, files, workspace templates and rollouts, plus new reports, invitations, new workspaces, viewers made experts and AI drafts (error `KR043`). It still allows reading, exports, deletes, leaving, removing members, revoking invitations, notifications, and rating or discarding an AI draft. Tidying up templates stays open too, like deleting (product owner, 2026-10-15): archiving a version, and ending a rollout without publishing its candidate. Publishing a version, rolling back, starting a rollout and changing its share are refused. Writes made with the service role are not checked by the database: the code that writes for a user checks first.

## Billing page and receipts

The billing page is `/fr/organisations/<organization id>/abonnement`, for the organization's owner and the owners and admins of its workspaces. Experts, viewers and everyone else get a 404. Owners pay and edit the billing details; admins only read. A pass or a payment names its workspace for the organization owner and for members of that workspace; other readers see "Espace Pass Mission". The history leaves out expired and canceled checkouts.

The "Abonnement" link of the sidebar follows the same readers, the organization owner included whatever their workspace roles, and only shows once billing is enforced (`private.billing_settings.enforced`, KRB-179). Before the launch the page stays reachable by its address, for tests on staging.

Receipts need no setup: no bucket, no job. `GET /api/billing/receipts/<id>` draws the PDF on each download from the stored receipt and its lines, read with the user's own client (RLS), and answers 404 to anyone who is not a billing reader of that organization. It answers JSON with the file name and the PDF in base64, and the "Télécharger" button builds the file in the browser (KRB-189): a PDF sent as raw bytes by a Vercel function reached the browser changed, and Chrome refused it with `ERR_INVALID_RESPONSE`. Opening the route's address shows that JSON, not a PDF. A receipt never changes once issued, so:

- The seller on the receipts is `private.billing_settings.seller` at the time of the payment. To change it (new address, for example), update that row in the SQL editor of each Supabase project. Only the next receipts change.
- The buyer is the organization's billing details at the time of the payment. A customer who wants another name on a receipt already issued needs a credit note (`AV-` numbers, not built yet, ADR 001 question A3).
- Receipts paid on staging (FedaPay sandbox) and locally (mock) say "Reçu de test, sans valeur comptable".
- The e-MECeF number goes in `external_invoice_number`, the only column besides `external_invoice_data` that may change. The PDF shows "non émise" until it is set.
- The payment confirmation e-mail links to the receipts of the billing page (`/fr/organisations/<id>/abonnement#recus`), not to the PDF route as ADR 001, section 9 suggests: a reader who is signed out gets a bare 401 from the route, while the page sends them to the sign-in first.

To read a customer's receipts as the operator, in the SQL editor:

```sql
select r.number, r.issued_at, r.total_xof, r.environment, r.buyer ->> 'legal_name' as buyer
from public.billing_receipts r
where r.organization_id = '<organization id>'
order by r.issued_at desc;
```

When the organization was deleted (KRB-180), its receipts stay with `organization_id` set to null and only the service role reads them. Find them by the copy of the buyer:

```sql
select r.number, r.issued_at, r.total_xof, r.buyer ->> 'legal_name' as buyer
from public.billing_receipts r
where r.organization_id is null and r.buyer ->> 'organization_id' = '<organization id>'
order by r.issued_at desc;
```

## Move dates on staging to test

Staging only. On production, dates change through a purchase or the operator functions of PR 179-2, never by hand.

1. Find the organization and its entitlements:

   ```sql
   select o.id as organization_id, o.name, e.id as entitlement_id, e.scope, e.plan, e.source,
          e.starts_at, e.ends_at, e.grace_days, e.revoked_at
   from public.organizations o
   join public.billing_entitlements e on e.organization_id = o.id
   where o.name = 'Cabinet Exemple'
   order by e.starts_at;
   ```

2. Move the running entitlement. Keep `starts_at` before `ends_at`, and do not overlap another live period of the same line (the insert or update fails with `23P01`):

   ```sql
   -- Staging only.
   update public.billing_entitlements
   set starts_at = now() - interval '20 days', ends_at = now() + interval '5 days'
   where id = '<entitlement_id>';
   ```

   | `ends_at` | State | Reminder the next run sends |
   | --- | --- | --- |
   | `now() + interval '5 days'` | active or trialing | `d7` (from 00:00 in Cotonou, 7 days before the end day) |
   | tomorrow at noon in Cotonou | active or trialing | `d1` |
   | `now() - interval '1 day'` | grace | `ended` |
   | `now() - interval '8 days'` | read-only | `read_only` |

3. Run the job by hand (`$CRON_SECRET` of staging):

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://kolabreport.mocktar.com/api/cron/billing
   ```

4. A reminder goes once per entitlement and kind. To send the same one again while testing, delete its claim, then run the job again:

   ```sql
   -- Staging only.
   delete from private.billing_notices where entitlement_id = '<entitlement_id>' and kind = 'd7';
   ```

   The in-app notification is not written twice: one per person, entitlement and kind.

5. Put the dates back when you are done.

## A reminder was not sent

1. Check that billing is on: `select enforced from private.billing_settings;`. Off means no reminder at all.
2. Check that the job ran: Vercel dashboard, **Settings > Cron Jobs > View Logs**. A 401 means `CRON_SECRET` is missing or wrong on that environment.
3. Look for the claim:

   ```sql
   select kind, claimed_at, emailed_at, emails_sent, emails_failed
   from private.billing_notices
   where entitlement_id = '<entitlement_id>';
   ```

   - **No row**: the reminder was not due. A renewal that starts at the end of the period, or a payment made since, means nothing ends, so nothing is sent. A revoked entitlement gets nothing. After a missed day, only the reminder that is still true goes out (no late `d7` after the end). A `read_only` reminder is not sent more than 7 days after the workspace turned read-only.
   - **`emailed_at` is null**: the run stopped after the claim. Look for `billing: cron step failed` or `billing: could not record a reminder` in the logs of that run.
   - **`emails_failed` above 0**: the provider refused some e-mails. Look for `sendEmail failed` or `sendEmail skipped` in the same run, then check `EMAIL_PROVIDER`, `EMAIL_FROM` and the provider key.

4. Check who should have received it (product owner, 2026-10-15). A subscription reminder goes to the organization owner and the owners of every workspace it covers: all the workspaces of the organization except the mission workspaces, which follow their own passes. A pass reminder goes to the organization owner and the owners of the pass's workspace. For a pass, replace `w.billing_mode = 'subscription'` with `w.id = '<workspace_id>'`.

   ```sql
   select p.id, p.email
   from public.profiles p
   where p.id in (
     select o.owner_id from public.organizations o where o.id = '<organization_id>'
     union
     select m.user_id
     from public.workspace_members m
     join public.workspaces w on w.id = m.workspace_id
     where w.organization_id = '<organization_id>' and w.billing_mode = 'subscription' and m.role = 'owner'
   );
   ```

5. To send it again once the cause is fixed, delete the claim as in step 4 of the previous section and run the job by hand. Every recipient of that reminder gets the e-mail again, and only while it is still due.

## A workspace is stuck in read-only

1. See what the database sees:

   ```sql
   select * from private.workspace_access('<workspace_id>');
   ```

   It gives the mode of the workspace, the state, the entitlement that applies and its dates.

2. Find the cause:

   | What you see | Why | What to do |
   | --- | --- | --- |
   | `state = read_only`, `ends_at` plus 7 days is past | The period ended and nobody renewed | Nothing is wrong: an owner renews from the billing page |
   | `entitlement_id` is null | The organization never had an entitlement: the second organization of someone who already used their trial (ADR 001, Q9) | A purchase, or a manual grant below |
   | A payment was made but no new entitlement shows | The purchase was not granted | See [Stuck purchases and refunds](#stuck-purchases-and-refunds) |
   | The entitlement has `revoked_at` | An operator revoked it (refund, fraud) | Read the reason in `private.billing_events` (`manual_revoke`, `refund_seen`) before changing anything |
   | `billing_mode = mission` | A mission workspace follows its own passes, not the organization's plan | A Pass Mission for that workspace |

3. The banner and the disabled buttons follow the state when the page loads. Ask the person to reload the page after the fix.

## Manual grant

A manual grant gives an organization a period without a payment: an Institution deal paid by bank transfer, a goodwill extension, or a fix after an incident.

Once KRB-179 ships, use `billing_admin_grant` through `scripts/billing/grant.mjs`. It asks for an actor and a reason and writes the state before and after in `private.billing_events`.

Until then, the transaction below is the emergency way. It runs on production only with the product owner's written OK: keep their message with the reason. A second person reads it before it runs.

```sql
begin;

-- Cabinet for 30 days from now. Limits from src/lib/billing/catalog.ts.
-- If a subscription period is still running, start at its end instead of
-- now(), or the insert fails with 23P01.
insert into public.billing_entitlements (
  organization_id, scope, plan, source, starts_at, ends_at,
  max_members, max_reports, drafts_per_month, custom_templates, note
) values (
  '<organization_id>', 'subscription', 'cabinet', 'manual', now(), now() + interval '30 days',
  10, null, 250, true, '<reason>'
)
returning id;

insert into private.billing_events (organization_id, kind, actor, reason, details)
values ('<organization_id>', 'manual_grant', '<your name>', '<reason>',
        jsonb_build_object('entitlement_id', '<id returned above>', 'plan', 'cabinet', 'ends_at', now() + interval '30 days'));

commit;
```

| Plan | `max_members` | `max_reports` | `drafts_per_month` | `drafts_total` | `custom_templates` |
| --- | --- | --- | --- | --- | --- |
| `independant` | 3 | 3 | 60 | null | false |
| `cabinet` | 10 | null | 250 | null | true |
| `institution` | null | null | 1000, or the contract | null | true |

Null means no limit. The reminders of the new period go out on their own: 7 days before its end, the day before, and so on.

## Stuck purchases and refunds

A purchase starts `pending` when an owner leaves for FedaPay's payment page (KRB-176). It becomes `paid` once granted, `review` when FedaPay's answer does not match it, `expired` when nothing came after 48 hours, and `refunded` when FedaPay reports a refund. The webhook, the return page, the billing page and the daily job all read the transaction again from FedaPay and apply it through `billing_apply_transaction`, which grants a purchase once at most. Why that is safe: [`docs/security/fedapay-webhook.md`](../security/fedapay-webhook.md). The log lines and the alerts are in [`monitoring.md`](monitoring.md#purchases).

To see one purchase and what FedaPay said about it:

```sql
select id, organization_id, offer, status, review_reason, amount_xof, fedapay_transaction_id,
       fedapay_status, created_at, paid_at, granted_at, last_checked_at
from public.billing_purchases
where id = '<purchase_id>';

select source, event_name, fedapay_status, amount_xof, received_at
from private.billing_payment_events
where purchase_id = '<purchase_id>'
order by received_at;
```

### Paid at FedaPay, still pending here

1. Wait for the next check, or trigger one: the owner opens the billing page (once a minute per purchase), or you run the daily job by hand (`docs/deployment.md`). The job reads up to 25 pending purchases younger than 3 days, oldest check first.
2. Still pending: search the logs for the purchase id.
   - `billing: fedapay request failed` with status 401: the secret key of that environment is wrong. Check `FEDAPAY_SECRET_KEY` and `FEDAPAY_ENVIRONMENT`, then redeploy.
   - The same line with status 404 on `GET /v1/transactions/<id>`: FedaPay does not know a transaction it created for this purchase, so the secret key may belong to another FedaPay account. Look for the transaction in the FedaPay dashboard. This one fails the daily job; a purchase that never got a transaction does not.
   - `billing: could not apply a transaction`: the grant failed in the database. Sentry has the error, tagged with the purchase id.
   - `billing: purchase of another environment`: a sandbox payment met production, or the reverse. It never grants. Refund it.
   - After 15 minutes, the alert `paiement approuvé non accordé` says the same.
3. A purchase older than 3 days is no longer read by the job, and an expired one never is. If the FedaPay dashboard shows its payment approved, open the transaction's webhook in FedaPay's logs and use **Re-déclencher**: a payment received always grants, after the expiry too, and only once.

### A purchase in review

FedaPay says paid, but `review_reason` names what does not match: `amount`, `currency`, `merchant_reference`, `environment`, `organization_deleted` or `workspace_deleted`. Nothing was granted, and the organization cannot start another payment while one of its purchases is in `review`. Every review ends by closing it, as paid or as refunded.

1. Open the transaction in the FedaPay dashboard (`fedapay_transaction_id`) and compare it with the purchase. Note when it was approved: closing asks for it.
2. `currency` on every payment: FedaPay may report XOF with another id than the one in `src/lib/billing/apply.ts` (item 2 of the checklist in `docs/security/fedapay-webhook.md`). Fix the constant first.
3. The customer paid the full price of the offer to this FedaPay account: close the review as paid (below).
4. Anything else (the wrong amount, another merchant reference, another environment, an organization or workspace deleted since): refund the payment in full (Refunds, below). A refund through FedaPay closes the review on its own: the webhook marks the purchase `refunded`. A refund by transfer does not: once the money is back with the customer, close the review as refunded.

### Close a review

Until KRB-179 ships the operator functions, closing a review is SQL under the rule of the manual grant: it runs on production only with the product owner's written OK, kept with the reason, and a second person reads it before it runs. Each block stops when the purchase is not in the status it expects. It records the operator, the reason and the cause of the review in `private.billing_events`, next to the `review` event written when the purchase went to review. If a block stops with an error, nothing changed: run `rollback;`.

**As paid.** The purchase gets what a payment gives, through the function the webhook calls (`private.billing_grant`): the period rules of ADR 001, 6.3, its own entitlement or pack, a numbered receipt and the `granted` event. It ends `paid`, and any later answer from FedaPay for it gives `already_granted`. No e-mail goes out: tell the customer.

```sql
begin;

do $$
declare
  v public.billing_purchases%rowtype;
begin
  select * into v from public.billing_purchases p where p.id = '<purchase_id>' for update;
  if v.status is distinct from 'review' then
    raise exception 'Not in review: %', v.status;
  end if;
  if v.review_reason in ('environment', 'organization_deleted', 'workspace_deleted') then
    raise exception 'A % review never grants: refund it', v.review_reason;
  end if;
  -- The lock every grant takes, then the purchase's own grant, as the webhook does it.
  perform private.billing_lock_org(v.organization_id);
  update public.billing_purchases p set status = 'pending', review_reason = null where p.id = v.id;
  perform private.billing_grant(v.id, least('<approved_at>'::timestamptz, now()));
  insert into private.billing_events (organization_id, kind, actor, reason, details)
  values (v.organization_id, 'manual_grant', '<your name>', '<reason>', jsonb_build_object(
    'purchase_id', v.id,
    'review_reason', v.review_reason,
    'fedapay_transaction_id', v.fedapay_transaction_id));
end;
$$;

-- Run up to here, read this, then run the commit: paid, granted, its period or pack, its receipt.
select p.status, p.paid_at, p.granted_at, e.plan, e.starts_at, e.ends_at, k.drafts, r.number as receipt
from public.billing_purchases p
left join public.billing_entitlements e on e.purchase_id = p.id
left join public.billing_ai_packs k on k.purchase_id = p.id
left join public.billing_receipts r on r.purchase_id = p.id and r.kind = 'receipt'
where p.id = '<purchase_id>';

commit;
```

**As refunded.** The purchase ends `refunded`, with a `refund_seen` event like the one FedaPay's webhook writes. The block also takes a `paid` purchase refunded by transfer: revoke its entitlement after (Refunds, step 3).

```sql
begin;

do $$
declare
  v public.billing_purchases%rowtype;
begin
  select * into v from public.billing_purchases p where p.id = '<purchase_id>' for update;
  if v.status not in ('review', 'paid') then
    raise exception 'Not in review or paid: %', v.status;
  end if;
  update public.billing_purchases p
  set status = 'refunded', review_reason = null,
      paid_at = coalesce(p.paid_at, least('<approved_at>'::timestamptz, now()))
  where p.id = v.id;
  insert into private.billing_events (organization_id, kind, actor, reason, details)
  values (v.organization_id, 'refund_seen', '<your name>', '<reason>', jsonb_build_object(
    'purchase_id', v.id,
    'fedapay_transaction_id', v.fedapay_transaction_id,
    'was', v.status,
    'review_reason', v.review_reason,
    'method', 'transfer'));
end;
$$;

commit;
```

### Refunds

The rules, decided by the product owner (ADR 001, Q10): no refund of a started period, since the trial lets customers try first; a payment made by mistake (twice, or the wrong amount) is refunded in full. The terms of sale say the same (`/fr/cgv#remboursement`).

1. Refund in the FedaPay dashboard. FedaPay refunds only MTN Mobile Money payments; any other one is refunded outside FedaPay, by transfer.
2. FedaPay's webhook marks the purchase `refunded`, from `paid` or `review`, writes a `refund_seen` audit event and sends the alert `remboursement constaté`. Nothing is revoked on its own. A refund by transfer changes nothing here: mark the purchase refunded by hand (Close a review, as refunded).
3. If the refund cancels the period, revoke its entitlement. Until KRB-179 ships `billing_admin_revoke`, this follows the same rule as a manual grant:

   ```sql
   begin;

   update public.billing_entitlements
   set revoked_at = now(), revoked_reason = '<reason>'
   where purchase_id = '<purchase_id>' and revoked_at is null
   returning id, organization_id, plan, starts_at, ends_at;

   insert into private.billing_events (organization_id, kind, actor, reason, details)
   values ('<organization_id>', 'manual_revoke', '<your name>', '<reason>',
           jsonb_build_object('purchase_id', '<purchase_id>', 'entitlement_id', '<id returned above>'));

   commit;
   ```

   A refunded Pack IA: `update public.billing_ai_packs set revoked_at = now() where purchase_id = '<purchase_id>';`, with the same audit event.
4. The receipt stays as it is: receipts never change. Credit notes wait for the accountant (ADR 001, A3).

### Two payments for the same offer

The alert `deux paiements pour la même offre` means the organization paid the same offer twice within 24 hours. Both were granted and the second period follows the first. Ask the customer: if the second was a mistake, refund it and revoke its entitlement as above.

### A payment after the purchase expired

The alert `paiement reçu après expiration` means FedaPay approved a payment after its purchase expired. It was granted anyway: money received always grants. Check that the customer did not pay again in the meantime, which would make it a double payment.
