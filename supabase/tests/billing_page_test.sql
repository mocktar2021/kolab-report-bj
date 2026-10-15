begin;
\ir fixtures.psql
select plan(67);

-- The billing page (KRB-177, ADR 001 sections 3.5 and 9): billing managers
-- edit the buyer details of their organization, column by column; billing
-- readers see the drafts used, the packs left, the purchases and the
-- receipts; members who write read the drafts left of their workspace;
-- receipts stay private to each organization and never change.

-- Billing is on in these tests, whatever the database says.
update private.billing_settings set enforced = true;

-- Terms of src/lib/billing/catalog.ts (offerTerms), as the checkout sends them.
create or replace function pg_temp.terms(p_offer text) returns jsonb
language sql as $$
  select (case p_offer
    when 'independant_1m' then '{"kind": "subscription", "plan": "independant", "months": 1, "monthly_price_ht_xof": 15000,
      "limits": {"max_members": 3, "max_reports": 3, "drafts_per_month": 60, "drafts_total": null, "custom_templates": false}}'
    when 'mission_pass' then '{"kind": "mission", "plan": "mission", "days": 90,
      "limits": {"max_members": 10, "max_reports": 1, "drafts_per_month": null, "drafts_total": 80, "custom_templates": false}}'
    when 'ai_pack_100' then '{"kind": "ai_pack", "drafts": 100, "valid_months": 12, "max_quantity": 10}'
  end)::jsonb;
$$;

create temp sequence transactions start 970000001;

-- A purchase made and paid the way the server does it: the checkout, then
-- what FedaPay answers. Returns the receipt number.
create or replace function pg_temp.buy_and_pay(
  p_org uuid, p_offer text, p_label text, p_amount bigint, p_buyer text, p_ws uuid default null
) returns text
language plpgsql as $$
declare
  v_purchase  uuid;
  v_reference text;
  v_trx       bigint := nextval('transactions');
  v_number    text;
begin
  select c.purchase_id, c.merchant_reference into v_purchase, v_reference
  from public.billing_create_purchase(p_org, p_offer, p_label, 1, 1, pg_temp.terms(p_offer),
    p_amount, 0, 'mock', pg_temp.id(p_buyer), p_ws, false) c;
  perform public.billing_set_transaction(v_purchase, v_trx, 'pending');
  select a.receipt_number into v_number
  from public.billing_apply_transaction(v_purchase, 'webhook', v_trx, 'approved', p_amount, 'mock', 'XOF',
    v_reference, null, 'transaction.approved', 'trx_page', 'momo_test', 270, now()) a;
  return v_number;
end;
$$;

-- What each person reads, kept for the checks below.
create temp table seen (who text primary key, body jsonb);
grant all on seen to authenticated;

-- Billing details: column grant and policy --------------------------------------
select ok(has_column_privilege('authenticated', 'public.organization_billing', 'legal_name', 'update'),
  'signed-in users may update legal_name');
select ok(has_column_privilege('authenticated', 'public.organization_billing', 'address', 'update'),
  'and address');
select ok(has_column_privilege('authenticated', 'public.organization_billing', 'tax_id', 'update'),
  'and tax_id');
select ok(has_column_privilege('authenticated', 'public.organization_billing', 'billing_email', 'update'),
  'and billing_email');
select ok(not has_column_privilege('authenticated', 'public.organization_billing', 'organization_id', 'update'),
  'but not organization_id');
select ok(not has_column_privilege('authenticated', 'public.organization_billing', 'created_at', 'update'),
  'nor created_at');
select ok(not has_column_privilege('authenticated', 'public.organization_billing', 'updated_at', 'update'),
  'nor updated_at');
select is(
  (select coalesce(array_agg(p order by p), '{}')
   from unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('authenticated', 'public.organization_billing', p)),
  '{}'::text[], 'no table-wide write privilege: no insert, delete or whole-row update');
select is(
  (select coalesce(array_agg(p order by p), '{}')
   from unnest(array['select', 'insert', 'update', 'references']) p
   where has_any_column_privilege('anon', 'public.organization_billing', p)),
  '{}'::text[], 'signed-out visitors have no privilege on billing details');
select is(
  (select array_agg(polname::text || ' ' || polcmd::text order by polname)
   from pg_policy where polrelid = 'public.organization_billing'::regclass),
  array['organization_billing: billing managers update w', 'organization_billing: billing readers read r'],
  'billing details have a read policy and an update policy, nothing else');

-- Who edits the billing details ---------------------------------------------------
select pg_temp.act_as('owner');
select is(pg_temp.affected($$
  update public.organization_billing
  set legal_name = 'Cabinet A SARL', address = 'Rue 12, Cotonou', tax_id = '3201912345678',
      billing_email = 'compta@cabinet-a.test'
  where organization_id = pg_temp.id('org_a')$$),
  1, 'the organization owner updates the billing details');
select results_eq(
  $$select legal_name, address, tax_id, billing_email from public.organization_billing
    where organization_id = pg_temp.id('org_a')$$,
  $$values ('Cabinet A SARL', 'Rue 12, Cotonou', '3201912345678', 'compta@cabinet-a.test')$$,
  'and reads them back');
select is(pg_temp.affected($$update public.organization_billing set legal_name = 'Cabinet B pris'
  where organization_id = pg_temp.id('org_b')$$), 0, 'but not those of another organization');
select throws_ok($$update public.organization_billing set created_at = now() - interval '1 year'
  where organization_id = pg_temp.id('org_a')$$, '42501', null, 'nor any other column');
select throws_ok($$update public.organization_billing set billing_email = 'Compta@Cabinet-A.test'
  where organization_id = pg_temp.id('org_a')$$, '23514', null, 'the billing e-mail is stored in lower case');
select throws_ok($$update public.organization_billing set legal_name = 'A'
  where organization_id = pg_temp.id('org_a')$$, '23514', null, 'a legal name has 2 characters at least');

select pg_temp.act_as('admin');
select is(pg_temp.affected($$update public.organization_billing set legal_name = 'Par l''admin'
  where organization_id = pg_temp.id('org_a')$$), 0, 'an admin reads the details but cannot change them');
select pg_temp.act_as('expert');
select is(pg_temp.affected($$update public.organization_billing set legal_name = 'Par l''expert'
  where organization_id = pg_temp.id('org_a')$$), 0, 'nor can an expert');
select pg_temp.act_as('viewer');
select is(pg_temp.affected($$update public.organization_billing set legal_name = 'Par le lecteur'
  where organization_id = pg_temp.id('org_a')$$), 0, 'nor a viewer');
select pg_temp.act_as('stranger');
select is(pg_temp.affected($$update public.organization_billing set legal_name = 'Par un inconnu'
  where organization_id = pg_temp.id('org_a')$$), 0, 'nor a user without workspace');
select pg_temp.act_as('outsider');
select is(pg_temp.affected($$update public.organization_billing set legal_name = 'Cabinet B SA'
  where organization_id = pg_temp.id('org_b')$$), 1, 'the owner of org_b updates its own details');

-- The owner of another workspace of org_a can buy, so edits too.
select pg_temp.act_as_server();
insert into public.workspaces (id, organization_id, name, created_by, billing_mode)
values ('00000000-0000-4000-c000-000000000003', pg_temp.id('org_a'), 'Mission A', pg_temp.id('expert2'), 'mission');
select pg_temp.act_as('expert2');
select is(pg_temp.affected($$update public.organization_billing set address = 'Rue 14, Cotonou'
  where organization_id = pg_temp.id('org_a')$$), 1, 'the owner of any workspace of org_a edits the details');
select pg_temp.act_as('admin');
select results_eq(
  $$select legal_name, address from public.organization_billing where organization_id = pg_temp.id('org_a')$$,
  $$values ('Cabinet A SARL', 'Rue 14, Cotonou')$$, 'nothing else changed them');

-- Purchases and receipts ----------------------------------------------------------
-- org_a pays Indépendant during its trial, then a pack and a pass for the
-- mission workspace; org_b pays a pack-less Indépendant.
select pg_temp.act_as_server();
create temp table numbers (what text primary key, number text);
grant all on numbers to authenticated;
insert into numbers values
  ('plan_a', pg_temp.buy_and_pay(pg_temp.id('org_a'), 'independant_1m', 'Indépendant, 1 mois', 15000, 'owner')),
  ('pack_a', pg_temp.buy_and_pay(pg_temp.id('org_a'), 'ai_pack_100', 'Pack IA, 100 brouillons IA', 12000, 'owner')),
  ('pass_a', pg_temp.buy_and_pay(pg_temp.id('org_a'), 'mission_pass', 'Pass Mission, 90 jours', 39000, 'expert2',
     '00000000-0000-4000-c000-000000000003')),
  ('plan_b', pg_temp.buy_and_pay(pg_temp.id('org_b'), 'independant_1m', 'Indépendant, 1 mois', 15000, 'outsider'));
select is((select count(*)::int from numbers where number ~ '^KR-[0-9]{4}-[0-9]{6}$'), 4,
  'each payment got a numbered receipt');

-- The receipt kept the buyer as it was at issue.
update public.organization_billing set legal_name = 'Cabinet A Renomme' where organization_id = pg_temp.id('org_a');
select is(
  (select buyer ->> 'legal_name' from public.billing_receipts where number = (select number from numbers where what = 'plan_a')),
  'Cabinet A SARL', 'a receipt keeps the buyer details of its issue date');
select is(
  (select seller ->> 'ifu' from public.billing_receipts where number = (select number from numbers where what = 'plan_a')),
  (select seller ->> 'ifu' from private.billing_settings), 'and the seller of private.billing_settings');
select throws_ok(
  $$update public.billing_receipts set total_xof = 1 where number = (select number from numbers where what = 'plan_a')$$,
  '42501', null, 'an issued receipt never changes, for the server either');

-- AI drafts of org_a this month: 3 counted and 1 reservation alive count; a
-- released one, a dead reservation and last month's do not. Two from the pack.
insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id, pack_id,
  usage_month, status, created_at, settled_at)
select gen_random_uuid(), pg_temp.id('org_a'), pg_temp.id('w1'), v.pool,
  case when v.pool = 'subscription' then (
    select e.id from public.billing_entitlements e
    where e.organization_id = pg_temp.id('org_a') and e.plan = 'independant' and e.revoked_at is null) end,
  case when v.pool = 'pack' then (select k.id from public.billing_ai_packs k where k.organization_id = pg_temp.id('org_a')) end,
  (date_trunc('month', now() at time zone 'utc') + v.month_shift)::date, v.status, now() - v.age,
  case when v.status <> 'reserved' then now() end
from (values
  ('subscription', interval '0', 'counted', interval '1 hour'),
  ('subscription', interval '0', 'counted', interval '1 hour'),
  ('subscription', interval '0', 'counted', interval '1 hour'),
  ('subscription', interval '0', 'reserved', interval '1 minute'),
  ('subscription', interval '0', 'released', interval '1 hour'),
  ('subscription', interval '0', 'reserved', interval '1 hour'),
  ('subscription', interval '-1 month', 'counted', interval '40 days'),
  ('pack', interval '0', 'counted', interval '1 hour'),
  ('pack', interval '0', 'counted', interval '1 hour')
) as v (pool, month_shift, status, age);
-- org_b paid Indépendant above: two of its drafts count this month.
insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id,
  usage_month, status, settled_at)
select gen_random_uuid(), pg_temp.id('org_b'), pg_temp.id('w2'), 'subscription', e.id,
  date_trunc('month', now() at time zone 'utc')::date, 'counted', now()
from public.billing_entitlements e, generate_series(1, 2)
where e.organization_id = pg_temp.id('org_b') and e.plan = 'independant' and e.revoked_at is null;

-- billing_overview: what billing readers see --------------------------------------
select pg_temp.act_as('owner');
insert into seen values ('owner', public.billing_overview(pg_temp.id('org_a')));
select is((select body -> 'subscription' -> 'drafts' from seen where who = 'owner'),
  '{"used": 4, "allowance": 60, "period": "month"}'::jsonb,
  'the overview counts the drafts of the month like the reservation does');
select is(
  (select jsonb_build_object('drafts', p -> 'drafts', 'used', p -> 'used')
   from seen, jsonb_array_elements(body -> 'packs') p where who = 'owner'),
  '{"drafts": 100, "used": 2}'::jsonb, 'and the drafts taken from the pack');
select is(
  (select jsonb_build_object('name', p -> 'workspace_name', 'drafts', p -> 'drafts')
   from seen, jsonb_array_elements(body -> 'passes') p where who = 'owner'),
  '{"name": "Mission A", "drafts": {"used": 0, "allowance": 80, "period": "total"}}'::jsonb,
  'a pass names its workspace and has its own allowance');
select is(
  (select array_agg(p ->> 'offer_label' || ' ' || (p ->> 'status') || ' ' || (p ->> 'amount_xof') order by p ->> 'offer_label')
   from seen, jsonb_array_elements(body -> 'purchases') p where who = 'owner'),
  array['Indépendant, 1 mois paid 15000', 'Pack IA, 100 brouillons IA paid 12000', 'Pass Mission, 90 jours paid 39000'],
  'the purchases of org_a with their status and amount');
select is(
  (select p ->> 'workspace_name' from seen, jsonb_array_elements(body -> 'purchases') p
   where who = 'owner' and p ->> 'offer' = 'mission_pass'),
  'Mission A', 'a pass purchase names its workspace');
select is(
  (select array_agg(p ->> 'receipt_number' order by p ->> 'receipt_number')
   from seen, jsonb_array_elements(body -> 'purchases') p where who = 'owner'),
  (select array_agg(number order by number) from numbers where what like '%\_a'),
  'each paid purchase links to its receipt');
select is(
  (select array_agg((r ->> 'number') || ' ' || (r ->> 'label') || ' ' || (r ->> 'total_xof') order by r ->> 'number')
   from seen, jsonb_array_elements(body -> 'receipts') r where who = 'owner'),
  (select array_agg(n.number || ' ' || l.label || ' ' || r.total_xof order by n.number)
   from numbers n join public.billing_receipts r on r.number = n.number
   join public.billing_receipt_lines l on l.receipt_id = r.id
   where n.what like '%\_a'),
  'the receipts of org_a with their label and total, none of org_b');
select is(
  (select jsonb_build_object('purchases', body -> 'purchases_total', 'receipts', body -> 'receipts_total')
   from seen where who = 'owner'),
  '{"purchases": 3, "receipts": 3}'::jsonb, 'with their totals');
select ok(
  (select body::text !~ '(@|Owner|Admin|Expert|Viewer|Outsider|Stranger)' from seen where who = 'owner'),
  'still no e-mail and no person''s name, only workspace names');

select is(
  (select array_agg(w ->> 'name' order by w ->> 'name') from seen, jsonb_array_elements(body -> 'workspaces') w
   where who = 'owner'),
  array['Etude A', 'Mission A'],
  'the organization owner may buy a pass for every workspace, members or not');

select pg_temp.act_as('admin');
insert into seen values ('admin', public.billing_overview(pg_temp.id('org_a')));
select is(
  (select jsonb_array_length(body -> 'receipts') from seen where who = 'admin'), 3,
  'an admin reads the same receipts');
select is(
  (select jsonb_build_object('id', p -> 'workspace_id', 'name', p -> 'workspace_name')
   from seen, jsonb_array_elements(body -> 'passes') p where who = 'admin'),
  '{"id": "00000000-0000-4000-c000-000000000003", "name": null}'::jsonb,
  'but not the name of a mission workspace the admin is not a member of');
select is(
  (select p -> 'workspace_name' from seen, jsonb_array_elements(body -> 'purchases') p
   where who = 'admin' and p ->> 'offer' = 'mission_pass'),
  'null'::jsonb, 'nor in the purchase history');
select is(
  (select array_agg(w ->> 'name') from seen, jsonb_array_elements(body -> 'workspaces') w where who = 'admin'),
  array['Etude A'], 'and a pass can only be bought for the workspaces the admin belongs to');
select ok(
  (select body::text !~ 'Mission A' from seen where who = 'admin'), 'the name appears nowhere in the overview');

select pg_temp.act_as('expert2');
select is(
  (select p ->> 'workspace_name' from jsonb_array_elements(public.billing_overview(pg_temp.id('org_a')) -> 'passes') p),
  'Mission A', 'the owner of the mission workspace, a member of it, reads its name');
select pg_temp.act_as('expert');
select is(public.billing_overview(pg_temp.id('org_a')), null, 'an expert gets no overview');
select pg_temp.act_as('outsider');
select is(
  (select array_agg(r ->> 'number') from jsonb_array_elements(public.billing_overview(pg_temp.id('org_b')) -> 'receipts') r),
  (select array_agg(number) from numbers where what = 'plan_b'), 'the owner of org_b reads only its own receipt');
select is((public.billing_overview(pg_temp.id('org_b')) -> 'subscription' -> 'drafts' ->> 'used')::int, 2,
  'and only its own drafts');

-- Receipts through RLS: what the download route reads -----------------------------
create or replace function pg_temp.receipt_rows(p_what text) returns integer
language sql as $$
  select (select count(*) from public.billing_receipts r
          where r.number = (select number from numbers where what = p_what))::int
       + (select count(*) from public.billing_receipt_lines l
          join public.billing_receipts r on r.id = l.receipt_id
          where r.number = (select number from numbers where what = p_what))::int;
$$;
grant execute on function pg_temp.receipt_rows(text) to authenticated;

select pg_temp.act_as('owner');
select is(pg_temp.receipt_rows('plan_a'), 2, 'the owner reads a receipt of org_a and its line');
select is(pg_temp.receipt_rows('plan_b'), 0, 'but nothing of a receipt of org_b');
select pg_temp.act_as('admin');
select is(pg_temp.receipt_rows('plan_a'), 2, 'an admin reads a receipt of org_a');
select pg_temp.act_as('expert2');
select is(pg_temp.receipt_rows('pass_a'), 2, 'the owner of the mission workspace reads the receipt of its pass');
select pg_temp.act_as('expert');
select is(pg_temp.receipt_rows('plan_a'), 0, 'an expert reads no receipt');
select pg_temp.act_as('viewer');
select is(pg_temp.receipt_rows('plan_a'), 0, 'nor does a viewer');
select pg_temp.act_as('stranger');
select is(pg_temp.receipt_rows('plan_a'), 0, 'nor a user without workspace');
select pg_temp.act_as('outsider');
select is(pg_temp.receipt_rows('plan_a'), 0, 'nor the owner of another organization');
select pg_temp.act_as_anon();
select throws_ok('select count(*) from public.billing_receipts', '42501', null,
  'signed-out visitors cannot read receipts at all');

-- workspace_billing_usage: the hints ----------------------------------------------
select pg_temp.act_as('owner');
select results_eq(
  $$select billing_mode, state, plan, members, invitations, max_members, reports, max_reports,
           drafts_used, drafts_allowance, drafts_period, pack_drafts_left
    from public.workspace_billing_usage(pg_temp.id('w1'))$$,
  $$values ('subscription', 'active', 'independant', 4, 0, 3, 1, 3, 4, 60, 'month', 98)$$,
  'the owner reads members, reports and drafts left of w1');
select pg_temp.act_as('admin');
select results_eq(
  $$select members, reports, drafts_used from public.workspace_billing_usage(pg_temp.id('w1'))$$,
  $$values (4, 1, 4)$$, 'so does an admin');
select pg_temp.act_as('expert');
select results_eq(
  $$select members, invitations, reports, max_members, drafts_used, drafts_allowance, pack_drafts_left
    from public.workspace_billing_usage(pg_temp.id('w1'))$$,
  $$values (null::int, null::int, null::int, 3, 4, 60, 98)$$,
  'an expert reads the drafts left, not the member and report counts');
select pg_temp.act_as('viewer');
select is((select count(*)::int from public.workspace_billing_usage(pg_temp.id('w1'))), 0,
  'a viewer gets nothing');
select pg_temp.act_as('outsider');
select is((select count(*)::int from public.workspace_billing_usage(pg_temp.id('w1'))), 0,
  'nor the owner of another organization');
select pg_temp.act_as('stranger');
select is((select count(*)::int from public.workspace_billing_usage(pg_temp.id('w1'))), 0,
  'nor a user without workspace');
select is((select count(*)::int from public.workspace_billing_usage(gen_random_uuid())), 0,
  'nor anyone for an unknown workspace');
select pg_temp.act_as('expert2');
select results_eq(
  $$select billing_mode, plan, members, max_members, reports, max_reports, drafts_used, drafts_allowance, drafts_period
    from public.workspace_billing_usage('00000000-0000-4000-c000-000000000003')$$,
  $$values ('mission', 'mission', 1, 10, 0, 1, 0, 80, 'total')$$,
  'a mission workspace reads its own pass');

-- org_b's trial line before it paid: the trial allowance, counted per
-- entitlement. Moved back by the server for this check only.
select pg_temp.act_as_server();
update public.billing_entitlements set revoked_at = now(), revoked_reason = 'pgTAP'
where organization_id = pg_temp.id('org_b') and plan = 'independant';
update public.billing_entitlements set revoked_at = null, revoked_reason = null, ends_at = now() + interval '7 days'
where organization_id = pg_temp.id('org_b') and plan = 'trial';
insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id,
  usage_month, status, settled_at)
select gen_random_uuid(), pg_temp.id('org_b'), pg_temp.id('w2'), 'trial', e.id,
  date_trunc('month', now() at time zone 'utc')::date, 'counted', now()
from public.billing_entitlements e
where e.organization_id = pg_temp.id('org_b') and e.plan = 'trial';
select pg_temp.act_as('outsider');
select results_eq(
  $$select state, drafts_used, drafts_allowance, drafts_period from public.workspace_billing_usage(pg_temp.id('w2'))$$,
  $$values ('trialing', 1, 20, 'total')$$, 'the trial counts its drafts for the whole trial');

-- Privileges -----------------------------------------------------------------------
reset role;
select ok(
  has_function_privilege('authenticated', 'public.workspace_billing_usage(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.workspace_billing_usage(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.billing_overview(uuid)', 'execute'),
  'signed-in users call workspace_billing_usage, visitors call neither function');
select is(
  (select coalesce(array_agg(f order by f), '{}')
   from unnest(array[
     'private.billing_drafts_used(uuid, uuid, text, boolean)',
     'private.billing_line_drafts(uuid, boolean, uuid, text, integer, integer)',
     'private.billing_pack_used(uuid)']) f
   where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  '{}'::text[], 'nobody signed in calls the new private helpers');
select ok(
  pg_get_function_result('public.workspace_billing_usage(uuid)'::regprocedure) !~* '(amount|price|xof|email|name)',
  'workspace_billing_usage returns no amount, name or e-mail');

select * from finish();
rollback;
