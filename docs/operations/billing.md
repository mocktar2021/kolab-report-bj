# Billing

What to do when a reminder does not arrive, when a workspace stays read-only, or when an organization needs a period by hand (KRB-178). The rules are in [ADR 001](../adr/001-billing-and-fedapay.md). The variables and the daily job are set up in [`docs/deployment.md`](../deployment.md#scheduled-jobs), and what to watch is in [`monitoring.md`](monitoring.md#billing).

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

In read-only, the database refuses every insert and update made in a user's name on reports, sections, files, workspace templates and rollouts, plus new reports, invitations, new workspaces, viewers made experts and AI drafts (error `KR043`). It still allows reading, exports, deletes, leaving, removing members, revoking invitations, notifications, and rating or discarding an AI draft. Writes made with the service role are not checked by the database: the code that writes for a user checks first.

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

4. Check who should have received it: the organization owner and the owners of the workspaces the period covers (every subscription workspace, or the workspace of a pass).

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

On production, use `billing_admin_grant` through `scripts/billing/grant.mjs` once PR 179-2 ships. It asks for an actor and a reason and writes the state before and after in `private.billing_events`. Until then there is no supported way on production: ask the product owner first. If a grant cannot wait, a second person reads this transaction before it runs:

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

> **To fill after PR 176-2 merges.** This section will cover a purchase paid at FedaPay but not granted, a purchase in `review` (amount or reference mismatch), a refund seen at FedaPay, two payments for the same thing, and the reconciliation step of the daily job. Until then, see ADR 001, sections 8.6 and 8.7.
