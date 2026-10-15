begin;
\ir fixtures.psql
select plan(130);

-- Purchases, grants and receipts (ADR 001, sections 6.3, 8 and 9). The
-- server creates a purchase with the amount and terms of the catalogue,
-- re-reads the FedaPay transaction, and applies it with
-- billing_apply_transaction, which grants once whatever calls it and however
-- often. These tests call the functions as the server does, with no
-- signed-in user, and pass what FedaPay would answer. now() is the same
-- for the whole file, so the dates are exact.

-- Terms and prices of src/lib/billing/catalog.ts (offerTerms, OFFERS).
create or replace function pg_temp.terms(p_offer text) returns jsonb
language sql as $$
  select (case p_offer
    when 'independant_1m' then '{"kind": "subscription", "plan": "independant", "months": 1, "monthly_price_ht_xof": 15000,
      "limits": {"max_members": 3, "max_reports": 3, "drafts_per_month": 60, "drafts_total": null, "custom_templates": false}}'
    when 'cabinet_1m' then '{"kind": "subscription", "plan": "cabinet", "months": 1, "monthly_price_ht_xof": 49000,
      "limits": {"max_members": 10, "max_reports": null, "drafts_per_month": 250, "drafts_total": null, "custom_templates": true}}'
    when 'mission_pass' then '{"kind": "mission", "plan": "mission", "days": 90,
      "limits": {"max_members": 10, "max_reports": 1, "drafts_per_month": null, "drafts_total": 80, "custom_templates": false}}'
    when 'ai_pack_100' then '{"kind": "ai_pack", "drafts": 100, "valid_months": 12, "max_quantity": 10}'
  end)::jsonb;
$$;

create or replace function pg_temp.price(p_offer text) returns bigint
language sql as $$
  select case p_offer
    when 'independant_1m' then 15000 when 'cabinet_1m' then 49000
    when 'mission_pass' then 39000 when 'ai_pack_100' then 12000
  end::bigint;
$$;

-- billing_create_purchase as the checkout calls it, for a buyer from the
-- fixtures. p_reuse false: a new purchase every time.
create or replace function pg_temp.checkout(
  p_org uuid, p_offer text, p_buyer text default 'owner', p_ws uuid default null, p_qty int default 1,
  p_reuse boolean default false
) returns table (purchase_id uuid, reused boolean, refusal text)
language sql as $$
  select c.purchase_id, c.reused, c.refusal
  from public.billing_create_purchase(p_org, p_offer, p_offer || ' (test)', 1, p_qty, pg_temp.terms(p_offer),
    pg_temp.price(p_offer) * p_qty, 0, 'mock', pg_temp.id(p_buyer), p_ws, p_reuse) c;
$$;

create or replace function pg_temp.buy(
  p_org uuid, p_offer text, p_buyer text default 'owner', p_ws uuid default null, p_qty int default 1
) returns uuid
language sql as $$
  select purchase_id from pg_temp.checkout(p_org, p_offer, p_buyer, p_ws, p_qty);
$$;

create temp sequence transactions start 900000001;

-- What FedaPay says about a purchase's transaction, read back by the
-- server. Everything matches the purchase unless a test says otherwise.
create or replace function pg_temp.pay(
  p_purchase uuid,
  p_status text default 'approved',
  p_source text default 'webhook',
  p_event text default null,
  p_amount bigint default null,
  p_currency text default 'XOF',
  p_reference text default null,
  p_environment text default 'mock',
  p_transaction bigint default null
) returns table (outcome text, notice text, ends_at timestamptz, receipt_number text)
language plpgsql as $$
declare
  v public.billing_purchases%rowtype;
begin
  select * into v from public.billing_purchases p where p.id = p_purchase;
  if v.fedapay_transaction_id is null and p_transaction is null then
    perform public.billing_set_transaction(p_purchase, nextval('transactions'), 'pending');
    select * into v from public.billing_purchases p where p.id = p_purchase;
  end if;
  return query
  select a.outcome, a.notice, a.ends_at, a.receipt_number
  from public.billing_apply_transaction(
    p_purchase, p_source, coalesce(p_transaction, v.fedapay_transaction_id), p_status,
    coalesce(p_amount, v.amount_xof), p_environment, p_currency, coalesce(p_reference, v.merchant_reference),
    p_event, 'transaction.' || p_status, 'trx_test', 'momo_test', 270, now()
  ) a;
end;
$$;

-- An organization owned by `owner_name` with the given subscription
-- periods in place of its trial: (plan, starts in, ends in, amount).
create or replace function pg_temp.org_with(p_slug text, p_owner text, p_periods jsonb) returns uuid
language plpgsql as $$
declare
  v_org uuid := gen_random_uuid();
  p jsonb;
begin
  insert into public.organizations (id, name, slug, owner_id)
  values (v_org, 'Cabinet ' || p_slug, 'cabinet-' || p_slug, pg_temp.id(p_owner));
  delete from public.billing_entitlements where organization_id = v_org;
  for p in select * from jsonb_array_elements(p_periods) loop
    insert into public.billing_entitlements (
      organization_id, scope, plan, source, starts_at, ends_at, max_members, max_reports, drafts_per_month,
      drafts_total, custom_templates, amount_ht_xof
    ) values (
      v_org, 'subscription', p ->> 'plan', case when p ->> 'plan' = 'trial' then 'trial' else 'purchase' end,
      now() + (p ->> 'from')::interval, now() + (p ->> 'to')::interval,
      3, 3, case when p ->> 'plan' = 'trial' then null else 60 end,
      case when p ->> 'plan' = 'trial' then 20 end, false, (p ->> 'amount')::bigint
    );
  end loop;
  return v_org;
end;
$$;

create or replace function pg_temp.entitlement_of(p_purchase uuid) returns table (starts_at timestamptz, ends_at timestamptz)
language sql as $$
  select e.starts_at, e.ends_at from public.billing_entitlements e where e.purchase_id = p_purchase;
$$;

-- A grant that fails after numbering its receipt, then rolls back.
create or replace function pg_temp.grant_then_roll_back(p_purchase uuid) returns text
language plpgsql as $$
declare
  n text;
begin
  begin
    select receipt_number into n from pg_temp.pay(p_purchase);
    raise exception 'roll back';
  exception when raise_exception then
    return n;
  end;
end;
$$;

create temp table kept (name text primary key, id uuid);
create or replace function pg_temp.kept(p_name text) returns uuid
language sql as $$ select id from kept where name = p_name $$;

grant execute on all functions in schema pg_temp to authenticated, anon, service_role;
grant all on kept to authenticated, anon, service_role;
grant usage on sequence transactions to service_role;

-- Receipt numbers this file issues follow the last one already issued this year.
create temp table counter_before as
select coalesce((
  select last_number from private.billing_receipt_counters
  where seller = 'KR:1200900488800'
    and year = extract(year from now() at time zone 'Africa/Porto-Novo')::int
), 0) as last_number;
grant select on counter_before to authenticated;

-- Who may call what -------------------------------------------------------------
select is(
  (select coalesce(array_agg(t || ' ' || p order by t, p), '{}')
   from unnest(array['public.billing_purchases', 'public.billing_receipts', 'public.billing_receipt_lines']) t,
        unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
   where has_table_privilege('authenticated', t, p)),
  array['public.billing_purchases select', 'public.billing_receipt_lines select', 'public.billing_receipts select'],
  'signed-in users only have select on purchases and receipts');
select is(
  (select coalesce(array_agg(t || ' ' || p order by t, p), '{}')
   from unnest(array['public.billing_purchases', 'public.billing_receipts', 'public.billing_receipt_lines']) t,
        unnest(array['insert', 'update']) p
   where has_any_column_privilege('authenticated', t, p)),
  '{}'::text[], 'and no insert or update on any of their columns');
select is(
  (select coalesce(array_agg(t || ' ' || p order by t, p), '{}')
   from unnest(array['public.billing_purchases', 'public.billing_receipts', 'public.billing_receipt_lines']) t,
        unnest(array['select', 'insert', 'update', 'references']) p
   where has_any_column_privilege('anon', t, p)),
  '{}'::text[], 'signed-out visitors have no privilege on them');
select is(
  (select coalesce(array_agg(r || ' ' || t || ' ' || p order by r, t, p), '{}')
   from unnest(array['anon', 'authenticated', 'service_role']) r,
        unnest(array['private.billing_payment_events', 'private.billing_purchase_notices',
                     'private.billing_receipt_counters']) t,
        unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, t, p)),
  '{}'::text[], 'no API role touches payment events, notices or receipt counters');

create temp table server_functions (f text);
insert into server_functions values
  ('public.billing_create_purchase(uuid, text, text, integer, integer, jsonb, bigint, bigint, text, uuid, uuid, boolean)'),
  ('public.billing_set_transaction(uuid, bigint, text)'),
  ('public.billing_apply_transaction(uuid, text, bigint, text, bigint, text, text, text, text, text, text, text, bigint, timestamptz)'),
  ('public.billing_find_purchase(text, bigint, text, text)'),
  ('public.billing_pending_purchases(text, integer, uuid, interval)'),
  ('public.billing_check_pending(uuid)'),
  ('public.billing_claim_notice(uuid, text)'),
  ('public.billing_confirmation_details(uuid)');
select is(
  (select coalesce(array_agg(f order by f), '{}') from server_functions
   where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  '{}'::text[], 'nobody signed in calls the purchase functions');
select is(
  (select count(*)::int from server_functions where has_function_privilege('service_role', f, 'execute')),
  8, 'the service role calls all of them');
select is(
  (select coalesce(array_agg(f order by f), '{}')
   from unnest(array[
     'private.billing_user_can_manage(uuid, uuid)', 'private.billing_terms_valid(text, jsonb)',
     'private.billing_next_receipt_number(text, text, integer)', 'private.billing_issue_receipt(uuid)',
     'private.billing_grant(uuid, timestamptz)', 'private.billing_plan_rank(text)']) f
   where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
      or has_function_privilege('service_role', f, 'execute')),
  '{}'::text[], 'the private helpers are for the billing functions only');

select pg_temp.act_as('owner');
select throws_ok($$select * from pg_temp.checkout(pg_temp.id('org_a'), 'independant_1m')$$, '42501', null,
  'the organization owner cannot create a purchase with an amount of their choice');
select throws_ok(
  $$select * from public.billing_apply_transaction(gen_random_uuid(), 'webhook', 1, 'approved', 1, 'mock')$$,
  '42501', null, 'nor apply a transaction');

-- Creating a purchase ------------------------------------------------------------
select pg_temp.act_as_server();
select results_eq($$select reused, refusal from pg_temp.checkout(pg_temp.id('org_a'), 'independant_1m', 'admin')$$,
  $$values (false, 'forbidden')$$, 'an admin of the organization cannot buy');
select results_eq($$select reused, refusal from pg_temp.checkout(pg_temp.id('org_a'), 'independant_1m', 'expert')$$,
  $$values (false, 'forbidden')$$, 'nor can an expert');
select results_eq($$select reused, refusal from pg_temp.checkout(pg_temp.id('org_a'), 'independant_1m', 'outsider')$$,
  $$values (false, 'forbidden')$$, 'nor the owner of another organization');
select throws_ok(
  $$select * from public.billing_create_purchase(pg_temp.id('org_a'), 'independant_1m', 'Indépendant, 1 mois', 1, 1,
      pg_temp.terms('cabinet_1m'), 15000, 0, 'mock', pg_temp.id('owner'))$$,
  '22023', null, 'terms that do not match the offer are refused');
select throws_ok(
  $$select * from public.billing_create_purchase(pg_temp.id('org_a'), 'independant_1m', 'Indépendant, 1 mois', 1, 2,
      pg_temp.terms('independant_1m'), 30000, 0, 'mock', pg_temp.id('owner'))$$,
  '22023', null, 'only packs take a quantity');
select throws_ok(
  $$select * from public.billing_create_purchase(pg_temp.id('org_a'), 'independant_1m', 'Indépendant, 1 mois', 1, 1,
      pg_temp.terms('independant_1m'), 15000, 0, 'prod', pg_temp.id('owner'))$$,
  '22023', null, 'and an unknown FedaPay environment');

insert into kept select 'indep', pg_temp.buy(pg_temp.id('org_a'), 'independant_1m');
select results_eq(
  $$select status, amount_ht_xof, tax_xof, amount_xof, currency, environment, method, merchant_reference = 'KR-' || id,
           created_by, fedapay_transaction_id
    from public.billing_purchases where id = pg_temp.kept('indep')$$,
  $$values ('pending', 15000::bigint, 0::bigint, 15000::bigint, 'XOF', 'mock', 'fedapay', true, pg_temp.id('owner'), null::bigint)$$,
  'the owner gets a pending purchase with the catalogue amount and KR- plus its id as reference');
select results_eq(
  $$select purchase_id, reused, refusal from pg_temp.checkout(pg_temp.id('org_a'), 'independant_1m', p_reuse => true)$$,
  $$select pg_temp.kept('indep'), true, null::text$$,
  'the same order within 24 hours gets the same purchase back, so two tabs never pay twice');
select results_eq(
  $$select reused, refusal from pg_temp.checkout(pg_temp.id('org_a'), 'mission_pass', p_ws => pg_temp.id('w2'))$$,
  $$values (false, 'missionWorkspace')$$, 'a pass only covers a workspace of the organization');
select results_eq($$select reused, refusal from pg_temp.checkout(pg_temp.id('org_a'), 'ai_pack_100')$$,
  $$values (false, 'packNeedsPlan')$$, 'no Pack IA during the trial');

-- Grant once, during the trial --------------------------------------------------
select lives_ok($$select public.billing_set_transaction(pg_temp.kept('indep'), 900000000, 'pending')$$,
  'the checkout links the FedaPay transaction');
select lives_ok($$select public.billing_set_transaction(pg_temp.kept('indep'), 900000000, 'pending')$$,
  'linking the same one again does nothing');
select throws_ok($$select public.billing_set_transaction(pg_temp.kept('indep'), 900000999)$$, '23505', null,
  'another transaction is refused');

select results_eq(
  $$select outcome, notice, ends_at from pg_temp.pay(pg_temp.kept('indep'), p_event => 'evt-1')$$,
  $$values ('granted', null::text, now() + interval '1 month' + interval '14 days')$$,
  'the approved payment grants Indépendant for a month, plus the 14 days left of the trial');
select results_eq(
  $$select outcome from pg_temp.pay(pg_temp.kept('indep'), p_event => 'evt-1')$$,
  $$values ('already_granted')$$, 'the same webhook delivered again grants nothing more');
select results_eq(
  $$select outcome from pg_temp.pay(pg_temp.kept('indep'), p_source => 'return')$$,
  $$values ('already_granted')$$, 'nor does the return page');
select results_eq(
  $$select outcome from pg_temp.pay(pg_temp.kept('indep'), p_source => 'reconcile', p_amount => 1)$$,
  $$values ('already_granted')$$, 'and a granted purchase never goes back to review');
select is((select count(*)::int from public.billing_entitlements where purchase_id = pg_temp.kept('indep')), 1,
  'one entitlement');
select is((select count(*)::int from public.billing_receipts where purchase_id = pg_temp.kept('indep')), 1,
  'one receipt');
select results_eq(
  $$select source, count(*)::int from private.billing_payment_events
    where purchase_id = pg_temp.kept('indep') group by source order by source$$,
  $$values ('checkout', 1), ('reconcile', 1), ('return', 1), ('webhook', 1)$$,
  'the webhook event is recorded once, the other checks each time');
select results_eq(
  $$select status, paid_at, granted_at, fedapay_status, fedapay_mode, fedapay_fees_xof, fedapay_reference
    from public.billing_purchases where id = pg_temp.kept('indep')$$,
  $$values ('paid', now(), now(), 'approved', 'momo_test', 270::bigint, 'trx_test')$$,
  'the purchase is paid and keeps FedaPay''s status, method, fees and reference');
select results_eq(
  $$select plan, scope, source, starts_at, max_members, max_reports, drafts_per_month, drafts_total, custom_templates,
           amount_ht_xof
    from public.billing_entitlements where purchase_id = pg_temp.kept('indep')$$,
  $$values ('independant', 'subscription', 'purchase', now(), 3, 3, 60, null::integer, false, 15000::bigint)$$,
  'the entitlement starts now with the limits frozen in the purchase');
select results_eq(
  $$select revoked_reason is not null from public.billing_entitlements
    where organization_id = pg_temp.id('org_a') and plan = 'trial'$$,
  $$values (true)$$, 'the trial, started in this same instant, is replaced');
select results_eq(
  $$select array_agg(kind order by id) from private.billing_events
    where organization_id = pg_temp.id('org_a') and kind <> 'trial_started'$$,
  $$values (array['granted'])$$, 'the audit log records the grant');

-- The receipt ----------------------------------------------------------------------
select results_eq(
  $$select number, kind, environment, total_ht_xof, total_tax_xof, total_xof, currency,
           external_invoice_number, external_invoice_data
    from public.billing_receipts where purchase_id = pg_temp.kept('indep')$$,
  $$select 'KR-' || extract(year from now() at time zone 'Africa/Porto-Novo')::text || '-'
             || lpad((last_number + 1)::text, 6, '0'),
           'receipt', 'mock', 15000::bigint, 0::bigint, 15000::bigint, 'XOF', null::text, null::jsonb
    from counter_before$$,
  'the receipt takes the next number of the year, with no tax and an empty slot for the e-MECeF number');
select results_eq(
  $$select seller ->> 'name', seller ->> 'ifu', buyer ->> 'name', buyer ->> 'legal_name', payment ->> 'mode',
           (payment ->> 'fedapay_transaction_id')::bigint, payment ->> 'merchant_reference'
    from public.billing_receipts where purchase_id = pg_temp.kept('indep')$$,
  $$values ('Mocktar Technologies', '1200900488800', 'Cabinet A', 'Cabinet A', 'momo_test', 900000000::bigint,
            'KR-' || pg_temp.kept('indep'))$$,
  'it freezes the seller, the buyer and the payment');
select results_eq(
  $$select l.position::int, l.label, l.period_start, l.period_end, l.quantity, l.unit_price_ht_xof, l.amount_ht_xof,
           l.tax_code, l.tax_rate, l.tax_xof
    from public.billing_receipt_lines l join public.billing_receipts r on r.id = l.receipt_id
    where r.purchase_id = pg_temp.kept('indep')$$,
  $$values (1, 'independant_1m (test)', (now() at time zone 'Africa/Porto-Novo')::date,
            ((now() + interval '1 month 14 days') at time zone 'Africa/Porto-Novo')::date,
            1, 15000::bigint, 15000::bigint, null::text, null::numeric, 0::bigint)$$,
  'one line with the period and the tax columns at zero');

-- Issued receipts never change ---------------------------------------------------
select throws_ok(
  $$update public.billing_receipts set total_xof = 1, total_ht_xof = 1 where purchase_id = pg_temp.kept('indep')$$,
  '42501', null, 'an issued receipt cannot be changed');
select throws_ok(
  $$update public.billing_receipts set buyer = '{}' where purchase_id = pg_temp.kept('indep')$$,
  '42501', null, 'not even its buyer');
select throws_ok($$delete from public.billing_receipts where purchase_id = pg_temp.kept('indep')$$,
  '42501', null, 'nor deleted');
select throws_ok($$truncate public.billing_receipts, public.billing_receipt_lines$$, '42501', null, 'nor truncated');
select throws_ok(
  $$update public.billing_receipt_lines set amount_ht_xof = 1, unit_price_ht_xof = 1
    where receipt_id = (select id from public.billing_receipts where purchase_id = pg_temp.kept('indep'))$$,
  '42501', null, 'its lines cannot change');
select throws_ok(
  $$delete from public.billing_receipt_lines
    where receipt_id = (select id from public.billing_receipts where purchase_id = pg_temp.kept('indep'))$$,
  '42501', null, 'nor go');
reset role;
set local role service_role;
select throws_ok(
  $$update public.billing_receipts set total_xof = 1, total_ht_xof = 1 where purchase_id = pg_temp.kept('indep')$$,
  '42501', null, 'the service role cannot change one either');
select throws_ok($$delete from public.billing_receipts where purchase_id = pg_temp.kept('indep')$$,
  '42501', null, 'nor delete one');
select lives_ok(
  $$update public.billing_receipts set external_invoice_number = 'MECEF-TEST-1', external_invoice_data = '{"qr": "x"}'
    where purchase_id = pg_temp.kept('indep')$$,
  'the external invoice number and data can be filled in later');
select pg_temp.act_as_server();

-- Amounts are checked --------------------------------------------------------------
-- Four purchases of org_b first: an organization with a purchase in review
-- cannot start another one.
insert into kept select 'b_amount', pg_temp.buy(pg_temp.id('org_b'), 'cabinet_1m', 'outsider');
insert into kept select 'b_currency', pg_temp.buy(pg_temp.id('org_b'), 'cabinet_1m', 'outsider');
insert into kept select 'b_reference', pg_temp.buy(pg_temp.id('org_b'), 'cabinet_1m', 'outsider');
insert into kept select 'b_environment', pg_temp.buy(pg_temp.id('org_b'), 'cabinet_1m', 'outsider');

select results_eq($$select outcome, notice from pg_temp.pay(pg_temp.kept('b_amount'), p_amount => 1000)$$,
  $$values ('review', 'amount')$$, 'FedaPay reporting another amount puts the purchase in review');
select results_eq($$select outcome, notice from pg_temp.pay(pg_temp.kept('b_currency'), p_currency => 'EUR')$$,
  $$values ('review', 'currency')$$, 'another currency too');
select results_eq($$select outcome, notice from pg_temp.pay(pg_temp.kept('b_currency'))$$,
  $$values ('review', 'currency')$$, 'and a later matching answer does not grant it: the operator decides');
select results_eq(
  $$select outcome, notice from pg_temp.pay(pg_temp.kept('b_reference'), p_reference => 'KR-' || gen_random_uuid())$$,
  $$values ('review', 'merchant_reference')$$, 'another merchant reference too');
select results_eq($$select outcome, notice from pg_temp.pay(pg_temp.kept('b_environment'), p_environment => 'sandbox')$$,
  $$values ('review', 'environment')$$, 'and another environment: a sandbox payment never pays a mock or live purchase');
select is(
  (select count(*)::int from public.billing_entitlements where organization_id = pg_temp.id('org_b') and plan <> 'trial'),
  0, 'nothing is granted');
select results_eq(
  $$select status, review_reason from public.billing_purchases where id = pg_temp.kept('b_amount')$$,
  $$values ('review', 'amount')$$, 'the purchase says why');
select is(
  (select count(*)::int from private.billing_events where organization_id = pg_temp.id('org_b') and kind = 'review'),
  4, 'and the audit log has one event per purchase in review');
select results_eq($$select reused, refusal from pg_temp.checkout(pg_temp.id('org_b'), 'cabinet_1m', 'outsider')$$,
  $$values (false, 'review')$$, 'the organization cannot buy until the operator has looked');
select results_eq(
  $$select outcome from pg_temp.pay(pg_temp.kept('b_amount'), p_transaction => 123)$$,
  $$values ('ignored')$$, 'a transaction that is not the purchase''s own is ignored');

-- Statuses that do not grant -----------------------------------------------------
insert into kept select 'declined', pg_temp.buy(pg_temp.id('org_a'), 'cabinet_1m');
select results_eq($$select outcome from pg_temp.pay(pg_temp.kept('declined'), 'declined')$$,
  $$values ('not_paid')$$, 'a declined payment grants nothing');
select results_eq($$select outcome from pg_temp.pay(pg_temp.kept('declined'), 'canceled')$$,
  $$values ('not_paid')$$, 'nor does a canceled one');
select results_eq($$select status, fedapay_status from public.billing_purchases where id = pg_temp.kept('declined')$$,
  $$values ('pending', 'canceled')$$, 'the purchase stays pending: the customer can try again');
select results_eq($$select outcome from pg_temp.pay(pg_temp.kept('declined'), 'pending')$$,
  $$values ('pending')$$, 'pending stays pending');
select results_eq($$select outcome from pg_temp.pay(pg_temp.kept('declined'), 'expired')$$,
  $$values ('expired')$$, 'an expired transaction expires the purchase');
select results_eq($$select outcome, notice from pg_temp.pay(pg_temp.kept('declined'))$$,
  $$values ('granted', 'paid_after_expiry')$$, 'money received after that still grants, with an alert');

-- Period rules (ADR 6.3) ------------------------------------------------------------
-- Upgrade, the example of 6.3: Indépendant bought 10 days ago for 15 000 FCFA,
-- 20 of its 30 days unused, worth 10 000 FCFA; Cabinet costs 49 000 a month,
-- so 6 extra days.
insert into kept select 'org_up', pg_temp.org_with('up', 'stranger',
  '[{"plan": "independant", "from": "-10 days", "to": "20 days", "amount": 15000}]');
insert into kept select 'up', pg_temp.buy(pg_temp.kept('org_up'), 'cabinet_1m', 'stranger');
select results_eq($$select outcome, ends_at from pg_temp.pay(pg_temp.kept('up'))$$,
  $$values ('granted', now() + interval '1 month' + interval '6 days')$$,
  'an upgrade starts now and converts the unused days: a month plus 6 days of Cabinet');
select results_eq(
  $$select plan, ends_at, revoked_at from public.billing_entitlements
    where organization_id = pg_temp.kept('org_up') order by starts_at$$,
  $$values ('independant', now(), null::timestamptz), ('cabinet', now() + interval '1 month 6 days', null)$$,
  'the Indépendant period ends at the payment');
select results_eq(
  $$select (details ->> 'credit_xof')::int, (details ->> 'extra_days')::int from private.billing_events
    where organization_id = pg_temp.kept('org_up') and kind = 'converted'$$,
  $$values (10000, 6)$$, 'the audit log keeps the credit and the extra days');

-- Renewal before the end: after the last period. Then a downgrade, also after it.
insert into kept select 'org_renew', pg_temp.org_with('renew', 'stranger',
  '[{"plan": "independant", "from": "-10 days", "to": "20 days", "amount": 15000}]');
insert into kept select 'renew', pg_temp.buy(pg_temp.kept('org_renew'), 'independant_1m', 'stranger');
select results_eq($$select outcome from pg_temp.pay(pg_temp.kept('renew'))$$, $$values ('granted')$$,
  'an early renewal is granted');
select results_eq($$select * from pg_temp.entitlement_of(pg_temp.kept('renew'))$$,
  $$values (now() + interval '20 days', now() + interval '20 days' + interval '1 month')$$,
  'and starts at the end of the period in progress');
insert into kept select 'renew2', pg_temp.buy(pg_temp.kept('org_renew'), 'independant_1m', 'stranger');
select lives_ok($$select * from pg_temp.pay(pg_temp.kept('renew2'))$$, 'a second renewal');
select results_eq($$select * from pg_temp.entitlement_of(pg_temp.kept('renew2'))$$,
  $$values (now() + interval '20 days' + interval '1 month',
            now() + interval '20 days' + interval '1 month' + interval '1 month')$$,
  'stacks after the last stacked period');

insert into kept select 'org_down', pg_temp.org_with('down', 'stranger',
  '[{"plan": "cabinet", "from": "-5 days", "to": "25 days", "amount": 49000}]');
insert into kept select 'down', pg_temp.buy(pg_temp.kept('org_down'), 'independant_1m', 'stranger');
select lives_ok($$select * from pg_temp.pay(pg_temp.kept('down'))$$, 'a downgrade is granted');
select results_eq($$select * from pg_temp.entitlement_of(pg_temp.kept('down'))$$,
  $$values (now() + interval '25 days', now() + interval '25 days' + interval '1 month')$$,
  'and starts at the end of the Cabinet period');

-- In grace: from the old end, the grace days are not free.
insert into kept select 'org_grace', pg_temp.org_with('grace', 'stranger',
  '[{"plan": "independant", "from": "-35 days", "to": "-5 days", "amount": 15000}]');
insert into kept select 'grace', pg_temp.buy(pg_temp.kept('org_grace'), 'independant_1m', 'stranger');
select lives_ok($$select * from pg_temp.pay(pg_temp.kept('grace'))$$, 'a renewal in grace is granted');
select results_eq($$select * from pg_temp.entitlement_of(pg_temp.kept('grace'))$$,
  $$values (now() - interval '5 days', now() - interval '5 days' + interval '1 month')$$,
  'and starts at the end of the period that ended');

-- After the grace, read-only: from now.
insert into kept select 'org_late', pg_temp.org_with('late', 'stranger',
  '[{"plan": "independant", "from": "-60 days", "to": "-30 days", "amount": 15000}]');
insert into kept select 'late', pg_temp.buy(pg_temp.kept('org_late'), 'independant_1m', 'stranger');
select lives_ok($$select * from pg_temp.pay(pg_temp.kept('late'))$$, 'a payment after read-only is granted');
select results_eq($$select * from pg_temp.entitlement_of(pg_temp.kept('late'))$$,
  $$values (now(), now() + interval '1 month')$$, 'and starts now');

-- During a trial started 4 days ago: the 10 days left are added.
insert into kept select 'org_trial', pg_temp.org_with('trial', 'stranger',
  '[{"plan": "trial", "from": "-4 days", "to": "10 days", "amount": 0}]');
insert into kept select 'trial', pg_temp.buy(pg_temp.kept('org_trial'), 'independant_1m', 'stranger');
select lives_ok($$select * from pg_temp.pay(pg_temp.kept('trial'))$$, 'a payment during the trial is granted');
select results_eq($$select * from pg_temp.entitlement_of(pg_temp.kept('trial'))$$,
  $$values (now(), now() + interval '1 month' + interval '10 days')$$,
  'it starts now with the trial''s remaining days added');
select results_eq(
  $$select ends_at, revoked_at from public.billing_entitlements
    where organization_id = pg_temp.kept('org_trial') and plan = 'trial'$$,
  $$values (now(), null::timestamptz)$$, 'and the trial ends at the payment');

-- Pass Mission and Pack IA ------------------------------------------------------------
select is((select billing_mode from public.workspaces where id = pg_temp.id('w1')), 'subscription',
  'w1 is covered by the subscription');
insert into kept select 'pass', pg_temp.buy(pg_temp.id('org_a'), 'mission_pass', p_ws => pg_temp.id('w1'));
select results_eq($$select outcome, ends_at from pg_temp.pay(pg_temp.kept('pass'))$$,
  $$values ('granted', now() + interval '90 days')$$, 'a Pass Mission for a workspace with one report runs 90 days');
select results_eq(
  $$select scope, plan, workspace_id, max_members, max_reports, drafts_total, custom_templates
    from public.billing_entitlements where purchase_id = pg_temp.kept('pass')$$,
  $$values ('mission', 'mission', pg_temp.id('w1'), 10, 1, 80, false)$$, 'with the limits of a pass');
select is((select billing_mode from public.workspaces where id = pg_temp.id('w1')), 'mission',
  'and the workspace now follows its passes');
insert into kept select 'pass2', pg_temp.buy(pg_temp.id('org_a'), 'mission_pass', p_ws => pg_temp.id('w1'));
select lives_ok($$select * from pg_temp.pay(pg_temp.kept('pass2'))$$, 'a second pass for the same workspace');
select results_eq($$select * from pg_temp.entitlement_of(pg_temp.kept('pass2'))$$,
  $$values (now() + interval '90 days', now() + interval '180 days')$$, 'stacks after the first one');

insert into kept select 'pack', pg_temp.buy(pg_temp.id('org_a'), 'ai_pack_100', p_qty => 3);
select results_eq($$select outcome, ends_at from pg_temp.pay(pg_temp.kept('pack'))$$,
  $$values ('granted', now() + interval '12 months')$$, 'three Packs IA on top of a paid plan, valid 12 months');
select results_eq(
  $$select drafts, expires_at from public.billing_ai_packs where purchase_id = pg_temp.kept('pack')$$,
  $$values (300, now() + interval '12 months')$$, 'make 300 AI drafts');
select results_eq(
  $$select l.quantity, l.unit_price_ht_xof, l.amount_ht_xof, r.total_xof
    from public.billing_receipt_lines l join public.billing_receipts r on r.id = l.receipt_id
    where r.purchase_id = pg_temp.kept('pack')$$,
  $$values (3, 12000::bigint, 36000::bigint, 36000::bigint)$$, 'one receipt line for the three packs');
select results_eq($$select reused, refusal from pg_temp.checkout(pg_temp.id('org_a'), 'ai_pack_100', p_qty => 8)$$,
  $$values (false, 'packLimit')$$, 'no more than 10 packs running at once');

-- Refund ------------------------------------------------------------------------------
select results_eq($$select outcome from pg_temp.pay(pg_temp.kept('pack'), 'refunded')$$,
  $$values ('refunded')$$, 'a refund seen at FedaPay is recorded');
select results_eq(
  $$select p.status, k.revoked_at from public.billing_purchases p
    join public.billing_ai_packs k on k.purchase_id = p.id where p.id = pg_temp.kept('pack')$$,
  $$values ('refunded', null::timestamptz)$$, 'the purchase is refunded and the operator decides what to revoke');
select results_eq($$select outcome from pg_temp.pay(pg_temp.kept('pack'), 'approved_partially_refunded')$$,
  $$values ('unchanged')$$, 'seen again, it changes nothing');
select is(
  (select count(*)::int from private.billing_events where organization_id = pg_temp.id('org_a') and kind = 'refund_seen'),
  1, 'the audit log has the refund once');

-- Receipt numbers ------------------------------------------------------------------------
-- A grant that rolls back gives its number back: the next grant takes it.
insert into kept select 'rollback', pg_temp.buy(pg_temp.kept('org_late'), 'independant_1m', 'stranger');
create temp table rolled_back as select pg_temp.grant_then_roll_back(pg_temp.kept('rollback')) as number;
select results_eq($$select status, granted_at from public.billing_purchases where id = pg_temp.kept('rollback')$$,
  $$values ('pending', null::timestamptz)$$, 'the rolled back grant left the purchase pending');
select results_eq($$select receipt_number from pg_temp.pay(pg_temp.kept('rollback'))$$,
  $$select number from rolled_back$$, 'the next grant takes the number the rolled back one had');
select is(
  (select array_agg(substr(number, 9)::int order by number) from public.billing_receipts
   where purchase_id in (select id from kept)),
  (select array_agg(n) from counter_before, generate_series(last_number + 1, last_number + 13) n),
  'the 13 receipts of this file are numbered one after the other, with no gap');
select is(
  (select last_number from private.billing_receipt_counters
   where seller = 'KR:1200900488800' and year = extract(year from now() at time zone 'Africa/Porto-Novo')::int),
  (select last_number + 13 from counter_before), 'and the counter of the year is at the last one');

-- Webhook lookups, reconciliation and notices -------------------------------------------
insert into kept select 'loose', pg_temp.buy(pg_temp.id('org_a'), 'cabinet_1m');
select results_eq(
  $$select purchase_id, status, event_seen from public.billing_find_purchase('mock', 900000000, null, 'evt-1')$$,
  $$select pg_temp.kept('indep'), 'paid', true$$, 'a webhook finds its purchase by transaction id and sees a duplicate event');
select results_eq(
  $$select event_seen from public.billing_find_purchase('mock', 900000000, null, 'evt-2')$$,
  $$values (false)$$, 'a new event is not one');
select is(
  (select count(*)::int from public.billing_find_purchase('sandbox', 900000000, null, 'evt-1')), 0,
  'the same transaction id in another environment finds nothing');
select results_eq(
  $$select purchase_id from public.billing_find_purchase('mock', 1, 'KR-' || pg_temp.kept('loose'), null)$$,
  $$select pg_temp.kept('loose')$$, 'a purchase whose transaction was never linked is found by merchant reference');
select results_eq(
  $$select outcome from pg_temp.pay(pg_temp.kept('loose'), 'pending', p_transaction => 900000500)$$,
  $$values ('pending')$$, 'and the transaction FedaPay gave that reference gets linked');
select is((select fedapay_transaction_id from public.billing_purchases where id = pg_temp.kept('loose')),
  900000500::bigint, 'to it');

insert into kept select 'stale', pg_temp.buy(pg_temp.id('org_a'), 'independant_1m');
insert into kept select 'old', pg_temp.buy(pg_temp.id('org_a'), 'independant_1m');
update public.billing_purchases set created_at = now() - interval '49 hours' where id = pg_temp.kept('stale');
update public.billing_purchases set created_at = now() - interval '4 days' where id = pg_temp.kept('old');
select results_eq(
  $$select purchase_id from public.billing_pending_purchases('mock', 50, pg_temp.id('org_a')) order by created_at$$,
  $$select pg_temp.kept('stale')$$,
  'the reconciliation takes pending purchases younger than 3 days and not checked in the last 10 minutes');
select is((select count(*)::int from public.billing_pending_purchases('sandbox', 50, pg_temp.id('org_a'))), 0,
  'of its own environment only');
select is(public.billing_check_pending(pg_temp.kept('stale')), 'expired',
  'a purchase still pending after 48 hours expires');
select is(public.billing_check_pending(pg_temp.kept('loose')), 'pending', 'a younger one stays pending');

select is(public.billing_claim_notice(pg_temp.kept('indep'), 'confirmation'), true, 'the confirmation is claimed once');
select is(public.billing_claim_notice(pg_temp.kept('indep'), 'confirmation'), false, 'and only once');
select isnt((select confirmation_sent_at from public.billing_purchases where id = pg_temp.kept('indep')), null,
  'the purchase records it');
select results_eq(
  $$select organization_name, buyer_email, plan, ends_at, receipt_number is not null
    from public.billing_confirmation_details(pg_temp.kept('indep'))$$,
  $$values ('Cabinet A', 'owner@kolabreport.test', 'independant', now() + interval '1 month 14 days', true)$$,
  'the confirmation e-mail gets the buyer, the plan and the receipt');

-- Who reads purchases and receipts ------------------------------------------------------
create or replace function pg_temp.visible(p_org uuid) returns int[]
language sql as $$
  select array[
    (select count(*)::int from public.billing_purchases where organization_id = p_org),
    (select count(*)::int from public.billing_receipts where organization_id = p_org),
    (select count(*)::int from public.billing_receipt_lines l
     join public.billing_receipts r on r.id = l.receipt_id where r.organization_id = p_org)
  ];
$$;
grant execute on function pg_temp.visible(uuid) to authenticated;

create temp table org_a_rows as select pg_temp.visible(pg_temp.id('org_a')) as counts;
grant select on org_a_rows to authenticated;
select ok((select counts[1] > 0 and counts[2] > 0 and counts[2] = counts[3] from org_a_rows),
  'org_a has purchases, receipts and their lines');

select pg_temp.act_as('owner');
select is(pg_temp.visible(pg_temp.id('org_a')), (select counts from org_a_rows),
  'the organization owner reads all of them');
select is(pg_temp.visible(pg_temp.id('org_b')), array[0, 0, 0], 'and nothing of org_b');
select throws_ok($$update public.billing_purchases set status = 'paid' where organization_id = pg_temp.id('org_b')$$,
  '42501', null, 'the owner cannot mark a purchase paid');
select throws_ok(
  $$insert into public.billing_purchases (organization_id, offer, offer_label, catalog_version, terms, amount_ht_xof,
      amount_xof, environment, merchant_reference)
    values (pg_temp.id('org_a'), 'cabinet_1m', 'Cabinet', 1, '{}', 1, 1, 'mock', 'KR-x')$$,
  '42501', null, 'nor insert one');
select throws_ok($$delete from public.billing_purchases where organization_id = pg_temp.id('org_a')$$,
  '42501', null, 'nor delete one');
select throws_ok(
  $$insert into public.billing_receipts (number, purchase_id, organization_id, environment, seller, buyer, payment,
      total_ht_xof, total_xof)
    values ('KR-2026-999999', pg_temp.kept('declined'), pg_temp.id('org_a'), 'mock', '{}', '{}', '{}', 0, 0)$$,
  '42501', null, 'nor issue a receipt');
select throws_ok('select * from private.billing_payment_events', '42501', null, 'payment events are unreachable');
select throws_ok('select * from private.billing_receipt_counters', '42501', null, 'receipt counters too');
select throws_ok('select * from private.billing_purchase_notices', '42501', null, 'and notices');

select pg_temp.act_as('admin');
select is(pg_temp.visible(pg_temp.id('org_a')), (select counts from org_a_rows),
  'an admin of the organization reads them too');
select pg_temp.act_as('expert');
select is(pg_temp.visible(pg_temp.id('org_a')), array[0, 0, 0], 'an expert reads none');
select pg_temp.act_as('viewer');
select is(pg_temp.visible(pg_temp.id('org_a')), array[0, 0, 0], 'nor does a viewer');
select pg_temp.act_as('outsider');
select is(pg_temp.visible(pg_temp.id('org_a')), array[0, 0, 0], 'nor the owner of another organization');
select ok((pg_temp.visible(pg_temp.id('org_b')))[1] = 4, 'who reads the purchases of their own');
select pg_temp.act_as_anon();
select throws_ok('select * from public.billing_purchases', '42501', null, 'visitors read nothing');

-- Accounting records outlive the organization --------------------------------------
select pg_temp.act_as('stranger');
select ok((pg_temp.visible(pg_temp.kept('org_late')))[2] = 2, 'the owner of org_late reads its two receipts');
select pg_temp.act_as_server();
delete from public.organizations where id = pg_temp.kept('org_late');
select results_eq(
  $$select count(*)::int, count(organization_id)::int from public.billing_receipts
    where purchase_id in (pg_temp.kept('late'), pg_temp.kept('rollback'))$$,
  $$values (2, 0)$$, 'deleting the organization keeps its receipts, without the link');
select results_eq(
  $$select count(*)::int, count(organization_id)::int from public.billing_purchases
    where id in (pg_temp.kept('late'), pg_temp.kept('rollback'))$$,
  $$values (2, 0)$$, 'and its purchases');
select is((select buyer ->> 'name' from public.billing_receipts where purchase_id = pg_temp.kept('late')),
  'Cabinet late', 'the receipt still names the buyer');
select pg_temp.act_as('stranger');
select is((select count(*)::int from public.billing_receipts where purchase_id = pg_temp.kept('late')), 0,
  'and nobody signed in reads it any more');

select * from finish();
rollback;
