begin;
\ir fixtures.psql
select plan(40);

-- KRB-179, PR 179-3: the launch (ADR 001, section 10). The migration ran
-- private.billing_launch() on an empty database; this file puts the switch
-- back as it is before the launch, builds one organization per case and runs
-- it again.

update private.billing_settings set enforced = false, launched_at = null;

create temp table kept (name text primary key, id uuid);
create or replace function pg_temp.kept(p_name text) returns uuid
language sql as $$ select id from kept where name = p_name $$;

-- A new organization. Its owner gets the 14-day trial when they never had one.
create or replace function pg_temp.new_org(p_slug text, p_owner text) returns uuid
language plpgsql as $$
declare
  v_org uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name, slug, owner_id)
  values (v_org, 'Lancement ' || p_slug, 'lancement-' || p_slug, pg_temp.id(p_owner));
  return v_org;
end;
$$;

create or replace function pg_temp.trial(p_org uuid) returns uuid
language sql as $$
  select e.id from public.billing_entitlements e
  where e.organization_id = p_org and e.plan = 'trial' order by e.created_at limit 1;
$$;

create or replace function pg_temp.launch_period(p_org uuid) returns uuid
language sql as $$
  select e.id from public.billing_entitlements e
  where e.organization_id = p_org and e.source = 'launch' and e.revoked_at is null;
$$;

-- org_a: a trial that started 3 days ago and is still running.
update public.billing_entitlements set starts_at = now() - interval '3 days', ends_at = now() + interval '11 days'
where id = pg_temp.trial(pg_temp.id('org_a'));

-- org_b: its trial starts at the launch moment (same transaction), as for an
-- organization created while the migration runs.

-- old: created before billing existed, so no entitlement and no claim.
insert into kept values ('old', pg_temp.new_org('old', 'admin'));
update public.billing_entitlements set revoked_at = now(), revoked_reason = 'pgTAP'
where organization_id = pg_temp.kept('old');
delete from private.billing_trial_claims where user_id = pg_temp.id('admin');

-- ended: its trial ended 6 days ago.
insert into kept values ('ended', pg_temp.new_org('ended', 'expert2'));
update public.billing_entitlements set starts_at = now() - interval '20 days', ends_at = now() - interval '6 days'
where id = pg_temp.trial(pg_temp.kept('ended'));

-- paid: on Indépendant, running.
insert into kept values ('paid', pg_temp.new_org('paid', 'stranger'));
insert into kept values ('paid_plan', pg_temp.set_plan(pg_temp.kept('paid'), 'independant'));

-- planned: a trial until an Institution period granted to start in 10 days.
insert into kept values ('planned', pg_temp.new_org('planned', 'viewer'));
update public.billing_entitlements set starts_at = now() - interval '1 day', ends_at = now() + interval '10 days'
where id = pg_temp.trial(pg_temp.kept('planned'));
with planned as (
  insert into public.billing_entitlements (
    organization_id, scope, plan, source, starts_at, ends_at, max_members, max_reports, drafts_per_month, custom_templates
  ) values (
    pg_temp.kept('planned'), 'subscription', 'institution', 'manual',
    now() + interval '10 days', now() + interval '40 days', null, null, 1000, true
  ) returning id
)
insert into kept select 'planned_plan', id from planned;

insert into kept select 'trial_a', pg_temp.trial(pg_temp.id('org_a'));
insert into kept select 'trial_b', pg_temp.trial(pg_temp.id('org_b'));
insert into kept select 'trial_ended', pg_temp.trial(pg_temp.kept('ended'));
insert into kept select 'trial_planned', pg_temp.trial(pg_temp.kept('planned'));

-- 1. Only the migration runs it.
select ok(not has_function_privilege('authenticated', 'private.billing_launch()', 'execute'),
  'launch: refused to authenticated');
select ok(not has_function_privilege('anon', 'private.billing_launch()', 'execute'), 'launch: refused to anon');
select ok(not has_function_privilege('service_role', 'private.billing_launch()', 'execute'),
  'launch: refused to the service role');

-- 2. The terms: Cabinet for 30 days (src/lib/billing/catalog.ts).
select results_eq(
  $$select plan, days, max_members, max_reports, drafts_per_month, drafts_total, custom_templates
    from private.billing_launch_terms()$$,
  $$values ('cabinet'::text, 30, 10, null::integer, 250, null::integer, true)$$,
  'the launch period has the Cabinet limits for 30 days');

-- 3. Before the launch nothing is enforced.
select is((select state from private.billing_access(pg_temp.kept('old'), null, now())), 'active',
  'before the launch, an organization with no entitlement is active');

create temp table launch as select * from private.billing_launch();

select is((select enforced from private.billing_settings), true, 'billing is enforced');
select is((select launched_at from private.billing_settings), now(), 'the launch moment is recorded');
select ok((select launch_periods >= 5 and organizations >= 6 and trials_ended >= 2 from launch),
  'the function counts what it did');

-- 4. A running trial ends where the launch period starts.
select is((select ends_at from public.billing_entitlements where id = pg_temp.kept('trial_a')), now(),
  'org_a: the running trial ends at the launch');
select is((select revoked_at from public.billing_entitlements where id = pg_temp.kept('trial_a')), null,
  'org_a: the trial is ended, not revoked');
select results_eq(
  $$select plan, source, starts_at, ends_at, max_members, max_reports, drafts_per_month, drafts_total,
      custom_templates, amount_ht_xof, note
    from public.billing_entitlements where id = pg_temp.launch_period(pg_temp.id('org_a'))$$,
  $$values ('cabinet'::text, 'launch'::text, now(), now() + interval '30 days', 10, null::integer, 250,
    null::integer, true, 0::bigint, 'Période de lancement'::text)$$,
  'org_a: 30 days of Cabinet from the launch, worth nothing');
select results_eq(
  $$select state, plan, source from private.billing_access(pg_temp.id('org_a'), null, now())$$,
  $$values ('active'::text, 'cabinet'::text, 'launch'::text)$$,
  'org_a: active on the launch period');

-- 5. A trial that starts at the launch moment is revoked.
select is((select revoked_reason from public.billing_entitlements where id = pg_temp.kept('trial_b')),
  'Essai remplacé par la période de lancement', 'org_b: the trial that starts now is revoked');
select isnt(pg_temp.launch_period(pg_temp.id('org_b')), null, 'org_b: gets a launch period');

-- 6. An organization from before billing.
select results_eq(
  $$select starts_at, ends_at from public.billing_entitlements where id = pg_temp.launch_period(pg_temp.kept('old'))$$,
  $$values (now(), now() + interval '30 days')$$,
  'old: gets 30 days from the launch');
select is((select state from private.billing_access(pg_temp.kept('old'), null, now())), 'active',
  'old: active');

-- 7. An ended trial stays as it was.
select results_eq(
  $$select starts_at, ends_at, revoked_at from public.billing_entitlements where id = pg_temp.kept('trial_ended')$$,
  $$values (now() - interval '20 days', now() - interval '6 days', null::timestamptz)$$,
  'ended: the old trial is untouched');
select results_eq(
  $$select starts_at, ends_at from public.billing_entitlements where id = pg_temp.launch_period(pg_temp.kept('ended'))$$,
  $$values (now(), now() + interval '30 days')$$,
  'ended: gets 30 days from the launch');

-- 8. A paid or manual period running: nothing changes.
select is(pg_temp.launch_period(pg_temp.kept('paid')), null, 'paid: no launch period');
select results_eq(
  $$select plan, source, revoked_at from public.billing_entitlements where id = pg_temp.kept('paid_plan')$$,
  $$values ('independant'::text, 'manual'::text, null::timestamptz)$$,
  'paid: its plan is untouched');
select is((select count(*)::integer from private.billing_events
  where organization_id = pg_temp.kept('paid') and kind = 'launch_period'), 0, 'paid: no launch event');

-- 9. A period planned later: the launch period stops where it starts.
select is((select ends_at from public.billing_entitlements where id = pg_temp.kept('trial_planned')), now(),
  'planned: the trial ends at the launch');
select results_eq(
  $$select starts_at, ends_at from public.billing_entitlements where id = pg_temp.launch_period(pg_temp.kept('planned'))$$,
  $$values (now(), now() + interval '10 days')$$,
  'planned: the launch period ends where the planned one starts');
select results_eq(
  $$select starts_at, ends_at, revoked_at from public.billing_entitlements where id = pg_temp.kept('planned_plan')$$,
  $$values (now() + interval '10 days', now() + interval '40 days', null::timestamptz)$$,
  'planned: the planned period is untouched');
select results_eq(
  $$select state, source from private.billing_access(pg_temp.kept('planned'), null, now() + interval '15 days')$$,
  $$values ('active'::text, 'manual'::text)$$,
  'planned: the planned period applies once it starts');

-- 10. One launch_period event per organization, with the line before and after.
select is((select count(*)::integer from private.billing_events
  where organization_id = pg_temp.id('org_a') and kind = 'launch_period'), 1, 'org_a: one launch event');
select results_eq(
  $$select actor, (details ->> 'entitlement_id')::uuid, (details ->> 'trial_ended')::uuid, details ->> 'plan',
      jsonb_array_length(details -> 'before'), details -> 'before' -> 0 ->> 'plan',
      jsonb_array_length(details -> 'after'), details -> 'after' -> 0 ->> 'source'
    from private.billing_events where organization_id = pg_temp.id('org_a') and kind = 'launch_period'$$,
  $$values (null::text, pg_temp.launch_period(pg_temp.id('org_a')), pg_temp.kept('trial_a'), 'cabinet'::text,
    1, 'trial'::text, 1, 'launch'::text)$$,
  'org_a: the event names the period, the ended trial, and the line before and after');
select is((select details -> 'trial_ended' from private.billing_events
  where organization_id = pg_temp.kept('old') and kind = 'launch_period'), 'null'::jsonb,
  'old: no trial ended');
select is((select count(*)::integer from public.billing_entitlements b
  where b.source = 'launch' and (
    select count(*) from private.billing_events e
    where e.kind = 'launch_period' and (e.details ->> 'entitlement_id')::uuid = b.id) <> 1), 0,
  'every launch period has exactly one event');

-- 11. Every owner counts as having had a trial.
select results_eq(
  $$select organization_id, email_hash from private.billing_trial_claims where user_id = pg_temp.id('admin')$$,
  $$values (pg_temp.kept('old'), encode(sha256(convert_to('admin@kolabreport.test', 'UTF8')), 'hex'))$$,
  'old: its owner gets a claim with the e-mail hash');
select is((select count(*)::integer from private.billing_trial_claims
  where user_id in (pg_temp.id('owner'), pg_temp.id('outsider'), pg_temp.id('admin'), pg_temp.id('expert2'),
                    pg_temp.id('stranger'), pg_temp.id('viewer'))), 6,
  'every owner has a claim');
select is((select count(*)::integer from public.organizations o
  join auth.users u on u.id = o.owner_id
  where not exists (
    select 1 from private.billing_trial_claims c
    where c.user_id = o.owner_id
       or c.email_hash = encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex'))), 0,
  'no owner is left without a claim, by account or by e-mail');
select is((select organization_id from private.billing_trial_claims where user_id = pg_temp.id('owner')),
  pg_temp.id('org_a'), 'an owner who had a claim keeps it');

-- 12. After the launch: no second trial for an owner, a trial for a newcomer.
insert into kept values ('admin_again', pg_temp.new_org('admin-again', 'admin'));
select is(pg_temp.trial(pg_temp.kept('admin_again')), null, 'an owner from before the launch gets no new trial');
select is((select state from private.billing_access(pg_temp.kept('admin_again'), null, now())), 'read_only',
  'their new organization is read-only until a purchase');

insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-a000-0000000000aa', 'nouveau@kolabreport.test', '{"full_name": "Nouveau"}');
insert into kept values ('newcomer', gen_random_uuid());
insert into public.organizations (id, name, slug, owner_id)
values (pg_temp.kept('newcomer'), 'Nouveau', 'lancement-nouveau', '00000000-0000-4000-a000-0000000000aa');
select results_eq(
  $$select plan, source, ends_at from public.billing_entitlements where organization_id = pg_temp.kept('newcomer')$$,
  $$values ('trial'::text, 'trial'::text, now() + interval '14 days')$$,
  'a newcomer after the launch gets the 14-day trial');
select is(pg_temp.launch_period(pg_temp.kept('newcomer')), null, 'and no launch period');

-- 13. Once only.
create temp table launch_rows as
  select count(*)::integer as n from public.billing_entitlements where source = 'launch';
select throws_ok($$select * from private.billing_launch()$$, '55000', null, 'the launch cannot run twice');
select is((select count(*)::integer from public.billing_entitlements where source = 'launch'),
  (select n from launch_rows), 'the refused second run added nothing');
select is((select launched_at from private.billing_settings), now(), 'the launch moment stays');

select * from finish();
rollback;
