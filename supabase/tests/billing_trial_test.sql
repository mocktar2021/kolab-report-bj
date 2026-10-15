begin;
\ir fixtures.psql
select plan(41);

-- Trials and states (ADR 001, sections 6 and 11). A new organization starts
-- a 14-day trial when its owner never had one, checked by user id and by
-- e-mail hash. The state of a workspace is computed from its entitlements
-- and the time, never stored.

create temp table kept (name text primary key, id uuid);
grant all on kept to authenticated, anon;
create or replace function pg_temp.kept_id(name text) returns uuid
language sql as $$ select id from kept where kept.name = $1 $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- The trial terms ---------------------------------------------------------------
select results_eq('select * from private.billing_trial_terms()', $$values (14, 5, 1, 20, true)$$,
  'the trial terms match src/lib/billing/catalog.ts');

-- A new organization ------------------------------------------------------------
-- The fixtures created org_a, owned by owner, in this transaction.
select results_eq(
  $$select scope, plan, source, ends_at - starts_at, grace_days::int, max_members, max_reports,
           drafts_per_month, drafts_total, custom_templates, amount_ht_xof::int, workspace_id, revoked_at
    from public.billing_entitlements where organization_id = pg_temp.id('org_a')$$,
  $$values ('subscription', 'trial', 'trial', interval '14 days', 7, 5, 1,
            null::integer, 20, true, 0, null::uuid, null::timestamptz)$$,
  'a new organization starts a 14-day trial with 5 members, 1 report and 20 AI drafts');
select is((select starts_at from public.billing_entitlements where organization_id = pg_temp.id('org_a')), now(),
  'the trial starts when the organization is created');
select results_eq(
  $$select organization_id, email_hash = encode(sha256(convert_to('owner@kolabreport.test', 'UTF8')), 'hex')
    from private.billing_trial_claims where user_id = pg_temp.id('owner')$$,
  $$values (pg_temp.id('org_a'), true)$$,
  'the owner''s claim keeps the organization and the hash of the e-mail');
select results_eq(
  $$select kind, (details ->> 'ends_at')::timestamptz = now() + interval '14 days'
    from private.billing_events where organization_id = pg_temp.id('org_a')$$,
  $$values ('trial_started', true)$$, 'the audit log records the trial');
select results_eq(
  $$select legal_name, address, tax_id, billing_email from public.organization_billing
    where organization_id = pg_temp.id('org_a')$$,
  $$values (null::text, null::text, null::text, null::text)$$, 'and its billing details start empty');

-- One trial per customer ----------------------------------------------------------
insert into public.organizations (id, name, slug, owner_id)
values ('00000000-0000-4000-b000-000000000003', 'Cabinet A bis', 'essai-cabinet-a-bis', pg_temp.id('owner'));
select is((select count(*)::int from public.billing_entitlements where organization_id = '00000000-0000-4000-b000-000000000003'),
  0, 'a second organization of the same owner gets no trial');
select is((select count(*)::int from public.organization_billing where organization_id = '00000000-0000-4000-b000-000000000003'),
  1, 'but it has its billing row');
select results_eq($$select organization_id from private.billing_trial_claims where user_id = pg_temp.id('owner')$$,
  array[pg_temp.id('org_a')], 'the owner keeps a single claim, for the first organization');

-- The wizard path: create_workspace_with_owner works as before.
select pg_temp.act_as('stranger');
insert into kept select 'first', organization_id from public.create_workspace_with_owner('Cabinet Inconnu', 'Etude 1', 'Rapport 1');
insert into kept select 'second', organization_id from public.create_workspace_with_owner('Cabinet Inconnu', 'Etude 2', 'Rapport 2');
reset role;
select results_eq($$select plan from public.billing_entitlements where organization_id = pg_temp.kept_id('first')$$,
  array['trial'], 'the wizard''s first organization gets the trial');
select is((select count(*)::int from public.billing_entitlements where organization_id = pg_temp.kept_id('second')),
  0, 'the second one, under another slug, does not');

-- Same e-mail on a new account: a person deletes their account and signs up again.
insert into auth.users (id, email) values ('00000000-0000-4000-a000-000000000008', 'revenant@cabinet-essai.test');
insert into public.organizations (id, name, slug, owner_id)
values ('00000000-0000-4000-b000-000000000004', 'Cabinet Revenant', 'essai-cabinet-revenant', '00000000-0000-4000-a000-000000000008');
select is((select count(*)::int from public.billing_entitlements where organization_id = '00000000-0000-4000-b000-000000000004'),
  1, 'a new person gets a trial');
delete from public.organizations where id = '00000000-0000-4000-b000-000000000004';
delete from auth.users where id = '00000000-0000-4000-a000-000000000008';
select is((select count(*)::int from private.billing_trial_claims where user_id = '00000000-0000-4000-a000-000000000008'),
  1, 'their claim outlives the account');
insert into auth.users (id, email) values ('00000000-0000-4000-a000-000000000009', 'Revenant@Cabinet-Essai.test');
insert into public.organizations (id, name, slug, owner_id)
values ('00000000-0000-4000-b000-000000000005', 'Cabinet Revenant 2', 'essai-cabinet-revenant-2', '00000000-0000-4000-a000-000000000009');
select is((select count(*)::int from public.billing_entitlements where organization_id = '00000000-0000-4000-b000-000000000005'),
  0, 'the same e-mail on a new account gets no new trial, whatever its case');
select is((select count(*)::int from private.billing_trial_claims where user_id = '00000000-0000-4000-a000-000000000009'),
  0, 'and no claim of its own');

-- Organizations that existed before billing ------------------------------------------
select is(
  (select count(*)::int from public.organizations o
   where not exists (select 1 from public.organization_billing b where b.organization_id = o.id)),
  0, 'every organization has its billing row');
-- The backfill wrote their row after them, in another transaction. On a new
-- database (CI) there are none; on an older one they are all checked.
select is(
  (select count(*)::int from public.organizations o
   join public.organization_billing b on b.organization_id = o.id
   where b.created_at > o.created_at
     and exists (select 1 from public.billing_entitlements e where e.organization_id = o.id)),
  0, 'organizations from before billing have no entitlement: the launch gives them their period');
select is(
  (select count(*)::int from public.organizations o
   join public.organization_billing b on b.organization_id = o.id
   where b.created_at > o.created_at
     and exists (select 1 from private.billing_trial_claims c where c.organization_id = o.id)),
  0, 'and their owners no trial claim');

-- Nothing changes while billing is not enforced ---------------------------------------
update private.billing_settings set enforced = false;
select pg_temp.act_as('owner');
select results_eq(
  $$select state, plan, ends_at, max_members, max_reports, drafts_total, custom_templates
    from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('active', null::text, null::timestamptz, null::integer, null::integer, null::integer, true)$$,
  'while billing is off, a workspace is active with no limit');
reset role;
select results_eq($$select state, max_members from private.workspace_access(pg_temp.id('w1'), now() + interval '1 year')$$,
  $$values ('active', null::integer)$$, 'even long after its trial');

-- States computed from dates ---------------------------------------------------------
update private.billing_settings set enforced = true;

select pg_temp.act_as('owner');
select results_eq(
  $$select state, plan, ends_at, grace_ends_at from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('trialing', 'trial', now() + interval '14 days', now() + interval '21 days')$$,
  'w1 is trialing until the end of the trial, with 7 days of grace after it');

-- The trial ended 2 days ago.
reset role;
update public.billing_entitlements set starts_at = now() - interval '16 days', ends_at = now() - interval '2 days'
where organization_id = pg_temp.id('org_a');
select pg_temp.act_as('expert');
select results_eq(
  $$select state, plan, max_members, drafts_total from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('grace', 'trial', 5, 20)$$, 'two days after the trial, w1 is in grace with the trial limits');
select is((select grace_ends_at from public.workspace_billing_state(pg_temp.id('w1'))), now() + interval '5 days',
  'and the grace ends 7 days after the trial');

-- The trial ended 8 days ago.
reset role;
update public.billing_entitlements set starts_at = now() - interval '22 days', ends_at = now() - interval '8 days'
where organization_id = pg_temp.id('org_a');
select pg_temp.act_as('viewer');
select results_eq($$select state, plan from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('read_only', 'trial')$$, 'after the grace, w1 is read-only');

-- The same rows, read at other times.
reset role;
select results_eq(
  $$select a.state from (values (now() - interval '15 days'), (now() - interval '8 days' - interval '1 second'),
                               (now() - interval '8 days'), (now() - interval '1 day' - interval '1 second'),
                               (now() - interval '1 day'), (now() - interval '23 days')) t (at)
    cross join lateral private.workspace_access(pg_temp.id('w1'), t.at) a$$,
  $$values ('active'), ('active'), ('grace'), ('grace'), ('read_only'), ('read_only')$$,
  'the state follows the time: active until the end, grace for 7 days, then read-only, and nothing before the start');

-- A paid period that starts later takes over from then on, not before.
insert into public.billing_entitlements (organization_id, scope, plan, source, starts_at, ends_at,
  max_members, drafts_per_month, custom_templates)
values (pg_temp.id('org_a'), 'subscription', 'cabinet', 'manual', now() - interval '1 hour', now() + interval '1 month',
  10, 250, true);
select results_eq(
  $$select state, plan, max_members, max_reports, drafts_per_month from private.workspace_access(pg_temp.id('w1'))$$,
  $$values ('active', 'cabinet', 10, null::integer, 250)$$, 'a Cabinet period makes w1 active with its limits');
select results_eq($$select state, plan from private.workspace_access(pg_temp.id('w1'), now() - interval '2 hours')$$,
  $$values ('read_only', 'trial')$$, 'and changes nothing about the hours before it');
select pg_temp.act_as('owner');
select results_eq($$select state from public.workspace_billing_state(pg_temp.id('w1'))$$, array['active'],
  'a paid period reads as active, not trialing');

-- An organization that never had an entitlement is read-only.
reset role;
insert into public.workspaces (id, organization_id, name, created_by)
values ('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-b000-000000000003', 'Etude A bis', pg_temp.id('owner'));
select pg_temp.act_as('owner');
select results_eq(
  $$select state, plan, ends_at, grace_ends_at from public.workspace_billing_state('00000000-0000-4000-c000-000000000004')$$,
  $$values ('read_only', null::text, null::timestamptz, null::timestamptz)$$,
  'the second organization of the owner is read-only until a purchase');

-- A mission workspace follows its own passes, not the subscription.
reset role;
insert into public.workspaces (id, organization_id, name, created_by, billing_mode)
values ('00000000-0000-4000-c000-000000000005', pg_temp.id('org_a'), 'Mission A', pg_temp.id('owner'), 'mission');
select results_eq($$select state from private.workspace_access('00000000-0000-4000-c000-000000000005')$$,
  array['read_only'], 'a mission workspace without a pass is read-only, even under an active plan');
insert into public.billing_entitlements (organization_id, workspace_id, scope, plan, source, starts_at, ends_at,
  max_members, max_reports, drafts_total, amount_ht_xof)
values (pg_temp.id('org_a'), '00000000-0000-4000-c000-000000000005', 'mission', 'mission', 'purchase',
  now(), now() + interval '90 days', 10, 1, 80, 39000);
select results_eq(
  $$select billing_mode, state, plan, max_members, max_reports, drafts_total, custom_templates
    from private.workspace_access('00000000-0000-4000-c000-000000000005')$$,
  $$values ('mission', 'active', 'mission', 10, 1, 80, false)$$, 'its pass makes it active with the pass limits');
select results_eq($$select state, plan from private.workspace_access(pg_temp.id('w1'))$$,
  $$values ('active', 'cabinet')$$, 'and the subscription workspaces keep their plan');

-- Periods never overlap -----------------------------------------------------------------
select throws_ok(
  $$insert into public.billing_entitlements (organization_id, scope, plan, source, starts_at, ends_at)
    values (pg_temp.id('org_a'), 'subscription', 'independant', 'manual', now() + interval '1 day', now() + interval '2 months')$$,
  '23P01', null, 'two live subscription periods of an organization cannot overlap');
select lives_ok(
  $$insert into public.billing_entitlements (organization_id, scope, plan, source, starts_at, ends_at, revoked_at, revoked_reason)
    values (pg_temp.id('org_a'), 'subscription', 'independant', 'manual', now() + interval '1 day', now() + interval '2 months',
      now(), 'Erreur de saisie')$$,
  'a revoked period does not count');
select lives_ok(
  $$insert into public.billing_entitlements (organization_id, scope, plan, source, starts_at, ends_at)
    values (pg_temp.id('org_a'), 'subscription', 'cabinet', 'manual',
      (select max(ends_at) from public.billing_entitlements where organization_id = pg_temp.id('org_a') and scope = 'subscription' and revoked_at is null),
      now() + interval '2 months')$$,
  'a period can start right where the previous one ends');
select throws_ok(
  $$insert into public.billing_entitlements (organization_id, workspace_id, scope, plan, source, starts_at, ends_at)
    values (pg_temp.id('org_a'), '00000000-0000-4000-c000-000000000005', 'mission', 'mission', 'manual',
      now() + interval '89 days', now() + interval '179 days')$$,
  '23P01', null, 'two live passes of a workspace cannot overlap');
select throws_ok(
  $$insert into public.billing_entitlements (organization_id, workspace_id, scope, plan, source, starts_at, ends_at)
    values (pg_temp.id('org_a'), pg_temp.id('w2'), 'mission', 'mission', 'manual', now(), now() + interval '90 days')$$,
  '23503', null, 'a pass names a workspace of its own organization');
select throws_ok(
  $$insert into public.billing_entitlements (organization_id, workspace_id, scope, plan, source, starts_at, ends_at)
    values (pg_temp.id('org_a'), pg_temp.id('w1'), 'subscription', 'cabinet', 'manual', now(), now() + interval '1 month')$$,
  '23514', null, 'a subscription period names no workspace');
select throws_ok(
  $$insert into public.billing_entitlements (organization_id, scope, plan, source, starts_at, ends_at)
    values (pg_temp.id('org_a'), 'subscription', 'cabinet', 'trial', now() + interval '3 months', now() + interval '4 months')$$,
  '23514', null, 'only the trial comes from the trial source');
select throws_ok(
  $$insert into public.billing_entitlements (organization_id, scope, plan, source, starts_at, ends_at)
    values (pg_temp.id('org_a'), 'subscription', 'cabinet', 'manual', now() + interval '3 months', now() + interval '3 months')$$,
  '23514', null, 'a period ends after it starts');

-- Deleting a workspace takes its passes with it.
delete from public.workspaces where id = '00000000-0000-4000-c000-000000000005';
select is((select count(*)::int from public.billing_entitlements where workspace_id = '00000000-0000-4000-c000-000000000005'),
  0, 'deleting a mission workspace deletes its passes');

select * from finish();
rollback;
