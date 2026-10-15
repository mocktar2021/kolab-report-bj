begin;
\ir fixtures.psql
select plan(47);

-- KRB-179, PR 179-2: the operator functions. They run with the service role
-- only, need an actor and a reason, and write the periods before and after
-- in private.billing_events. A bank transfer becomes a paid purchase granted
-- by the same rules as an online payment, with a receipt.

-- Default Institution limits of src/lib/billing/catalog.ts.
create or replace function pg_temp.institution_limits() returns jsonb
language sql as $$
  select '{"max_members": null, "max_reports": null, "drafts_per_month": 1000, "drafts_total": null, "custom_templates": true}'::jsonb;
$$;

-- A new organization. One trial per customer: an owner who has no
-- organization yet gets the 14-day trial with it.
create or replace function pg_temp.new_org(p_slug text, p_owner text) returns uuid
language plpgsql as $$
declare
  v_org uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name, slug, owner_id)
  values (v_org, 'Institution ' || p_slug, 'institution-' || p_slug, pg_temp.id(p_owner));
  return v_org;
end;
$$;

create or replace function pg_temp.record(
  p_org uuid, p_reference text, p_amount bigint default 1800000, p_months int default 12,
  p_actor text default 'Mocktar', p_reason text default 'Devis D-2026-001 signé', p_test boolean default false
) returns table (purchase_id uuid, entitlement_id uuid, starts_at timestamptz, ends_at timestamptz, receipt_number text)
language sql as $$
  select * from public.billing_admin_record_payment(
    p_org, p_amount, p_months, pg_temp.institution_limits(), p_reference, now() - interval '2 days',
    p_actor, p_reason, null, 1, p_test);
$$;

create temp table kept (name text primary key, id uuid);
create or replace function pg_temp.kept(p_name text) returns uuid
language sql as $$ select id from kept where name = p_name $$;

grant execute on all functions in schema pg_temp to authenticated, anon, service_role;
grant all on kept to authenticated, anon, service_role;

-- 1. Nobody but the service role runs them.
select ok(not has_function_privilege('authenticated',
  'public.billing_admin_record_payment(uuid, bigint, integer, jsonb, text, timestamptz, text, text, text, integer, boolean)',
  'execute'), 'record_payment: refused to authenticated');
select ok(not has_function_privilege('anon',
  'public.billing_admin_record_payment(uuid, bigint, integer, jsonb, text, timestamptz, text, text, text, integer, boolean)',
  'execute'), 'record_payment: refused to anon');
select ok(has_function_privilege('service_role',
  'public.billing_admin_record_payment(uuid, bigint, integer, jsonb, text, timestamptz, text, text, text, integer, boolean)',
  'execute'), 'record_payment: allowed to the service role');
select ok(not has_function_privilege('authenticated',
  'public.billing_admin_grant(uuid, text, interval, jsonb, text, text, timestamptz)', 'execute'),
  'grant: refused to authenticated');
select ok(not has_function_privilege('anon',
  'public.billing_admin_grant(uuid, text, interval, jsonb, text, text, timestamptz)', 'execute'),
  'grant: refused to anon');
select ok(not has_function_privilege('authenticated', 'public.billing_admin_revoke(uuid, text, text)', 'execute'),
  'revoke: refused to authenticated');
select ok(not has_function_privilege('anon', 'public.billing_admin_revoke(uuid, text, text)', 'execute'),
  'revoke: refused to anon');

select pg_temp.act_as('owner');
select throws_ok(
  $$select * from public.billing_admin_revoke(gen_random_uuid(), 'Owner', 'Je me retire mon essai')$$,
  '42501', null, 'a signed-in owner cannot call the revoke function');
select pg_temp.act_as_server();

-- 2. A bank transfer on a trialing organization.
insert into kept values ('org', pg_temp.new_org('a', 'stranger'));
insert into kept select 'trial', e.id from public.billing_entitlements e
  where e.organization_id = pg_temp.kept('org') and e.plan = 'trial';

-- The trial's end before the payment: its days left are added.
create temp table trial_end as
  select e.ends_at from public.billing_entitlements e where e.id = pg_temp.kept('trial');
insert into kept select 'purchase', purchase_id from pg_temp.record(pg_temp.kept('org'), 'VIR-0001');

select results_eq(
  $$select status, method, environment, offer, amount_ht_xof, amount_xof, transfer_reference, offer_label
    from public.billing_purchases where id = pg_temp.kept('purchase')$$,
  $$values ('paid'::text, 'bank_transfer'::text, 'manual'::text, 'institution'::text, 1800000::bigint, 1800000::bigint,
    'VIR-0001'::text, 'Institution, 12 mois'::text)$$,
  'the transfer is a paid Institution purchase by bank transfer');
select is((select paid_at from public.billing_purchases where id = pg_temp.kept('purchase')),
  now() - interval '2 days', 'paid on the date of the transfer');
select results_eq(
  $$select plan, source, starts_at, ends_at, max_members, max_reports, drafts_per_month, custom_templates, amount_ht_xof
    from public.billing_entitlements where purchase_id = pg_temp.kept('purchase')$$,
  $$values ('institution'::text, 'purchase'::text, now(), now() + interval '12 months'
    + ((select ends_at from trial_end) - now()),
    null::integer, null::integer, 1000, true, 1800000::bigint)$$,
  'Institution from now for 12 months, plus the trial days left, with the given limits');
select ok((select revoked_at is not null or ends_at <= now() from public.billing_entitlements
  where id = pg_temp.kept('trial')), 'the trial ends at the payment');
select is(
  (select terms ->> 'monthly_price_ht_xof' from public.billing_purchases where id = pg_temp.kept('purchase')),
  '150000', 'the monthly price for a later conversion is the amount over the months');

select is((select count(*)::int from public.billing_receipts where purchase_id = pg_temp.kept('purchase')), 1,
  'one receipt is issued');
select matches((select number from public.billing_receipts where purchase_id = pg_temp.kept('purchase')),
  '^KR-[0-9]{4}-[0-9]{6}$', 'with a KR number');
select results_eq(
  $$select environment, payment ->> 'method', payment ->> 'transfer_reference', total_xof
    from public.billing_receipts where purchase_id = pg_temp.kept('purchase')$$,
  $$values ('manual'::text, 'bank_transfer'::text, 'VIR-0001'::text, 1800000::bigint)$$,
  'the receipt shows the method and the transfer reference');
select results_eq(
  $$select label, quantity, amount_ht_xof from public.billing_receipt_lines r
    join public.billing_receipts b on b.id = r.receipt_id where b.purchase_id = pg_temp.kept('purchase')$$,
  $$values ('Institution, 12 mois'::text, 1, 1800000::bigint)$$,
  'one receipt line with the label');

select results_eq(
  $$select actor, reason, details ->> 'transfer_reference', details ->> 'purchase_id'
    from private.billing_events where organization_id = pg_temp.kept('org') and kind = 'manual_payment'$$,
  $$values ('Mocktar'::text, 'Devis D-2026-001 signé'::text, 'VIR-0001'::text, pg_temp.kept('purchase')::text)$$,
  'the audit log keeps who recorded the transfer and why');
select is(
  (select jsonb_array_length(details -> 'before') from private.billing_events
   where organization_id = pg_temp.kept('org') and kind = 'manual_payment'),
  1, 'before: the trial');
select is(
  (select details -> 'after' -> 0 ->> 'plan' from private.billing_events
   where organization_id = pg_temp.kept('org') and kind = 'manual_payment'),
  'institution', 'after: the Institution period');
select is(
  (select count(*)::int from private.billing_events
   where organization_id = pg_temp.kept('org') and kind = 'granted'
     and details ->> 'purchase_id' = pg_temp.kept('purchase')::text),
  1, 'the grant itself is logged like an online payment');

-- 3. Twice the same transfer: refused, nothing granted twice.
select throws_ok($$select * from pg_temp.record(pg_temp.kept('org'), 'VIR-0001')$$,
  '23505', null, 'the same transfer reference is refused');
select is((select count(*)::int from public.billing_purchases where organization_id = pg_temp.kept('org')), 1,
  'still one purchase');

-- 4. Renewal: a second transfer stacks after the running period.
insert into kept select 'renewal', purchase_id from pg_temp.record(pg_temp.kept('org'), 'VIR-0002');
select is(
  (select starts_at from public.billing_entitlements where purchase_id = pg_temp.kept('renewal')),
  (select ends_at from public.billing_entitlements where purchase_id = pg_temp.kept('purchase')),
  'the renewal starts when the paid period ends');

-- 5. Checks on the arguments.
select throws_ok($$select * from pg_temp.record(pg_temp.kept('org'), 'VIR-0003', p_actor => '')$$,
  '22023', 'An actor (2 to 200 characters) is required', 'an actor is required');
select throws_ok($$select * from pg_temp.record(pg_temp.kept('org'), 'VIR-0003', p_reason => ' ')$$,
  '22023', 'A reason (3 to 500 characters) is required', 'a reason is required');
select throws_ok($$select * from pg_temp.record(pg_temp.kept('org'), 'VIR-0003', p_amount => 0)$$,
  '22023', null, 'the amount must be positive');
select throws_ok($$select * from pg_temp.record(pg_temp.kept('org'), 'VIR-0003', p_months => 0)$$,
  '22023', null, 'the length must be at least a month');
select throws_ok($$select * from pg_temp.record(pg_temp.kept('org'), '  ')$$,
  '22023', null, 'the transfer reference is required');
select throws_ok(
  $$select * from public.billing_admin_record_payment(pg_temp.kept('org'), 100000, 12,
    '{"max_members": 0, "max_reports": null, "drafts_per_month": 10, "drafts_total": null, "custom_templates": true}',
    'VIR-0004', now(), 'Mocktar', 'Limites fausses')$$,
  '22023', 'Invalid limits', 'limits are checked');
select throws_ok(
  $$select * from public.billing_admin_record_payment(pg_temp.kept('org'), 100000, 12, pg_temp.institution_limits(),
    'VIR-0004', now() - interval '2 years', 'Mocktar', 'Virement ancien')$$,
  '22023', null, 'a transfer older than a year is refused');
select throws_ok(
  $$select * from public.billing_admin_record_payment(gen_random_uuid(), 100000, 12, pg_temp.institution_limits(),
    'VIR-0004', now(), 'Mocktar', 'Organisation inconnue')$$,
  '22023', 'Unknown organization', 'an unknown organization is refused');

-- 6. A test transfer on staging gets a test receipt.
insert into kept values ('org_test', pg_temp.new_org('test', 'expert2'));
insert into kept select 'test_purchase', purchase_id from pg_temp.record(pg_temp.kept('org_test'), 'VIR-T1', p_test => true);
select is((select environment from public.billing_receipts where purchase_id = pg_temp.kept('test_purchase')),
  'sandbox', 'a test transfer gets a test receipt');

-- 7. A manual grant on a trialing organization.
insert into kept values ('org_grant', pg_temp.new_org('grant', 'viewer'));
insert into kept select 'grant', entitlement_id from public.billing_admin_grant(
  pg_temp.kept('org_grant'), 'institution', interval '12 months', pg_temp.institution_limits(),
  'Mocktar', 'Organisation du propriétaire');
select results_eq(
  $$select plan, source, starts_at, ends_at, amount_ht_xof, purchase_id, note
    from public.billing_entitlements where id = pg_temp.kept('grant')$$,
  $$values ('institution'::text, 'manual'::text, now(), now() + interval '12 months', 0::bigint, null::uuid,
    'Organisation du propriétaire'::text)$$,
  'Institution from now for 12 months, with no payment and the reason as a note');
select is(
  (select count(*)::int from public.billing_entitlements
   where organization_id = pg_temp.kept('org_grant') and plan = 'trial' and ends_at > now() and revoked_at is null),
  0, 'the trial gives way to the grant');
select is((select count(*)::int from public.billing_purchases where organization_id = pg_temp.kept('org_grant')), 0,
  'no purchase and no receipt for a grant');
select results_eq(
  $$select actor, reason, details ->> 'plan', jsonb_array_length(details -> 'after')
    from private.billing_events where organization_id = pg_temp.kept('org_grant') and kind = 'manual_grant'$$,
  $$values ('Mocktar'::text, 'Organisation du propriétaire'::text, 'institution'::text, 1)$$,
  'the audit log keeps who granted it and why');

-- A second grant without a start stacks after the first.
insert into kept select 'grant2', entitlement_id from public.billing_admin_grant(
  pg_temp.kept('org_grant'), 'institution', interval '30 days', pg_temp.institution_limits(),
  'Mocktar', 'Geste commercial');
select is((select starts_at from public.billing_entitlements where id = pg_temp.kept('grant2')),
  now() + interval '12 months', 'a second grant starts after the first');

-- A start inside a covered period is refused with a clear message.
select throws_ok(
  $$select * from public.billing_admin_grant(pg_temp.kept('org_grant'), 'cabinet', interval '30 days',
    '{"max_members": 10, "max_reports": null, "drafts_per_month": 250, "drafts_total": null, "custom_templates": true}',
    'Mocktar', 'Chevauchement', now() + interval '1 month')$$,
  '23P01', null, 'an overlapping start is refused');
select throws_ok(
  $$select * from public.billing_admin_grant(pg_temp.kept('org_grant'), 'trial', interval '30 days',
    pg_temp.institution_limits(), 'Mocktar', 'Plan interdit')$$,
  '22023', null, 'the trial cannot be granted by hand');
select throws_ok(
  $$select * from public.billing_admin_grant(pg_temp.kept('org_grant'), 'cabinet', interval '4 years',
    pg_temp.institution_limits(), 'Mocktar', 'Trop long')$$,
  '22023', null, 'a grant lasts 3 years at most');

-- 8. Revoke.
select results_eq(
  $$select entitlement_id, plan from public.billing_admin_revoke(pg_temp.kept('grant2'), 'Mocktar', 'Erreur de saisie')$$,
  $$values (pg_temp.kept('grant2'), 'institution'::text)$$,
  'revoke answers the entitlement');
select results_eq(
  $$select revoked_at, revoked_reason from public.billing_entitlements where id = pg_temp.kept('grant2')$$,
  $$values (now(), 'Erreur de saisie'::text)$$,
  'the entitlement is revoked now, with the reason');
select results_eq(
  $$select actor, reason, jsonb_array_length(details -> 'before'), jsonb_array_length(details -> 'after')
    from private.billing_events where organization_id = pg_temp.kept('org_grant') and kind = 'manual_revoke'$$,
  $$values ('Mocktar'::text, 'Erreur de saisie'::text, 2, 1)$$,
  'the audit log keeps the periods before and after the revoke');
select throws_ok($$select * from public.billing_admin_revoke(pg_temp.kept('grant2'), 'Mocktar', 'Encore')$$,
  '22023', null, 'an entitlement is revoked once');
select throws_ok($$select * from public.billing_admin_revoke(gen_random_uuid(), 'Mocktar', 'Inconnu')$$,
  '22023', 'Unknown entitlement', 'an unknown entitlement is refused');

-- 9. The transfer reference goes with bank transfers, and only with them.
select throws_ok(
  $$update public.billing_purchases set transfer_reference = null where id = pg_temp.kept('purchase')$$,
  '23514', null, 'a bank transfer keeps its reference');

select * from finish();
rollback;
