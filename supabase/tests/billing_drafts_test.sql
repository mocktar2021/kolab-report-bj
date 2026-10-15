begin;
\ir fixtures.psql
select plan(42);

-- AI drafts (ADR 001, section 3.4). start_ai_generation reserves one draft
-- before its insert, from the allowance of the entitlement that covers the
-- workspace, then from a Pack IA. The reservation counts when the generation
-- succeeds and is released when it fails. The ledger is kept per
-- organization and outlives the workspace.

update private.billing_settings set enforced = true;

-- Starts a generation as the app does (service role), for the expert, from
-- a global template unless told otherwise.
create function pg_temp.start(ws uuid, section uuid, prompt uuid default null)
returns table (generation_id uuid, refusal text, retry_after integer)
language sql as $$
  select * from public.start_ai_generation(
    ws, section, pg_temp.id('expert'),
    coalesce(prompt, (select p.id from public.prompt_library p
                      where p.workspace_id is null and p.template_key = 'synthese-section' and p.status = 'published')),
    'section_draft', 1::smallint, 'mock', 'mock', '{}', 1000, 1000, 1000000000, null
  );
$$;

-- Records how a generation ended, as the draft route does.
create function pg_temp.finish(generation uuid, outcome text) returns void
language sql as $$
  update public.ai_generations
  set status = outcome::public.ai_generation_status,
      output = case when outcome = 'succeeded' then '{"title": "Brouillon"}'::jsonb end,
      error_code = case when outcome = 'failed' then 'providerError' end,
      completed_at = now()
  where id = generation;
$$;

-- A draft of s3 in w1, started and finished: its generation id, or the refusal.
create function pg_temp.draft(outcome text default 'succeeded', prompt uuid default null) returns text
language plpgsql as $$
declare
  started record;
begin
  select * into started from pg_temp.start(pg_temp.id('w1'), pg_temp.id('s3'), prompt);
  if started.generation_id is null then
    return started.refusal;
  end if;
  perform pg_temp.finish(started.generation_id, outcome);
  return started.generation_id::text;
end;
$$;

-- n drafts already counted, without their generations.
create function pg_temp.used(org uuid, ws uuid, p_pool text, entitlement uuid, n integer, month date default null)
returns void
language sql as $$
  insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id,
    usage_month, status, settled_at)
  select gen_random_uuid(), org, ws, p_pool, entitlement,
    coalesce(month, date_trunc('month', now() at time zone 'utc')::date), 'counted', now()
  from generate_series(1, n);
$$;

create function pg_temp.usage(generation uuid) returns public.billing_draft_usage
language sql as $$ select * from public.billing_draft_usage where generation_id = generation $$;

create temp table kept (name text primary key, id uuid);
grant all on kept to authenticated;
create function pg_temp.kept_id(name text) returns uuid
language sql as $$ select id from kept where kept.name = $1 $$;

grant execute on all functions in schema pg_temp to authenticated, anon;

select pg_temp.act_as_server();
insert into kept
select 'trial', id from public.billing_entitlements where organization_id = pg_temp.id('org_a') and plan = 'trial';

-- Reserve, count, release ---------------------------------------------------------
insert into kept select 'first', generation_id from pg_temp.start(pg_temp.id('w1'), pg_temp.id('s1'));
select results_eq(
  $$select pool, status, entitlement_id, workspace_id, usage_month, settled_at
    from public.billing_draft_usage where generation_id = pg_temp.kept_id('first')$$,
  $$values ('trial', 'reserved', pg_temp.kept_id('trial'), pg_temp.id('w1'),
            date_trunc('month', now() at time zone 'utc')::date, null::timestamptz)$$,
  'starting a draft on the trial reserves one from it');
select pg_temp.finish(pg_temp.kept_id('first'), 'succeeded');
select results_eq($$select status, settled_at is not null from public.billing_draft_usage
                    where generation_id = pg_temp.kept_id('first')$$,
  $$values ('counted', true)$$, 'it counts when the draft succeeds');

insert into kept select 'failed', pg_temp.draft('failed')::uuid;
select is((pg_temp.usage(pg_temp.kept_id('failed'))).status, 'released', 'and is released when it fails');

insert into kept select 'stale', generation_id from pg_temp.start(pg_temp.id('w1'), pg_temp.id('s2'));
update public.ai_generations set created_at = now() - interval '11 minutes' where id = pg_temp.kept_id('stale');
insert into kept select 'after_stale', generation_id from pg_temp.start(pg_temp.id('w1'), pg_temp.id('s2'));
select is((pg_temp.usage(pg_temp.kept_id('stale'))).status, 'released', 'a draft found stale gives its unit back');
select is((pg_temp.usage(pg_temp.kept_id('after_stale'))).status, 'reserved', 'to the next one');
select pg_temp.finish(pg_temp.kept_id('after_stale'), 'succeeded');

select pg_temp.act_as('expert');
select lives_ok($$select public.discard_ai_generation(pg_temp.kept_id('first'))$$, 'the expert discards a proposal');
select pg_temp.act_as_server();
select is((pg_temp.usage(pg_temp.kept_id('first'))).status, 'counted', 'which still counts');

-- The trial: 20 drafts in all -----------------------------------------------------------
-- A request that dies without saying how it ended keeps its reservation.
-- With 2 counted, 17 more fill the trial.
insert into kept select 'dead', generation_id from pg_temp.start(pg_temp.id('w1'), pg_temp.id('s1'));
select pg_temp.used(pg_temp.id('org_a'), pg_temp.id('w1'), 'trial', pg_temp.kept_id('trial'), 17);
select results_eq($$select refusal, retry_after from pg_temp.start(pg_temp.id('w1'), pg_temp.id('s3'))$$,
  $$values ('quotaExceeded', null::integer)$$, 'the 21st draft of the trial is refused, with no date to wait for');
select results_eq(
  $$select id from public.ai_generations where workspace_id = pg_temp.id('w1') and status = 'running'$$,
  $$select pg_temp.kept_id('dead')$$, 'nothing is recorded for it');
select results_eq(
  $$select generation_id from public.billing_draft_usage
    where organization_id = pg_temp.id('org_a') and status = 'reserved'$$,
  $$select pg_temp.kept_id('dead')$$, 'nor reserved');
update public.ai_generations set created_at = now() - interval '11 minutes' where id = pg_temp.kept_id('dead');
update public.billing_draft_usage set created_at = now() - interval '11 minutes' where generation_id = pg_temp.kept_id('dead');
select isnt(pg_temp.draft(), 'quotaExceeded', 'after 10 minutes, the reservation of a dead request no longer counts');
select is(pg_temp.draft(), 'quotaExceeded', 'and the trial is full again');

-- Pack IA: the one that expires first ------------------------------------------------------
insert into public.billing_ai_packs (id, organization_id, drafts, expires_at, revoked_at) values
  ('00000000-0000-4000-8000-000000000011', pg_temp.id('org_a'), 5, now() + interval '12 months', null),
  ('00000000-0000-4000-8000-000000000012', pg_temp.id('org_a'), 1, now() + interval '1 month', null),
  ('00000000-0000-4000-8000-000000000013', pg_temp.id('org_a'), 10, now() - interval '1 day', null),
  ('00000000-0000-4000-8000-000000000014', pg_temp.id('org_a'), 10, now() + interval '1 day', now()),
  ('00000000-0000-4000-8000-000000000015', pg_temp.id('org_b'), 10, now() + interval '1 day', null);
insert into kept select 'pack_1', pg_temp.draft()::uuid;
select results_eq($$select pool, pack_id, entitlement_id from public.billing_draft_usage
                    where generation_id = pg_temp.kept_id('pack_1')$$,
  $$values ('pack', '00000000-0000-4000-8000-000000000012'::uuid, null::uuid)$$,
  'with the trial used up, the pack that expires first takes over, expired, revoked and foreign ones left out');
insert into kept select 'pack_2', pg_temp.draft()::uuid;
select is((pg_temp.usage(pg_temp.kept_id('pack_2'))).pack_id, '00000000-0000-4000-8000-000000000011'::uuid,
  'then the next one');
select pg_temp.draft('failed');
select is((select count(*)::int from public.billing_draft_usage
           where pack_id = '00000000-0000-4000-8000-000000000011' and status <> 'released'),
  1, 'a failed draft gives its unit back to the pack');

-- Custom templates on Indépendant ------------------------------------------------------
-- No pack from here on, until one is bought again below.
update public.billing_ai_packs set revoked_at = now() where organization_id = pg_temp.id('org_a') and revoked_at is null;
select pg_temp.set_plan(pg_temp.id('org_a'), 'independant');
select is(pg_temp.draft('succeeded', pg_temp.id('p_w1')), 'templateNotIncluded',
  'a draft from a custom template is refused on Indépendant');
select isnt(pg_temp.draft(), 'templateNotIncluded', 'a global template works');

-- Indépendant: 60 drafts a month for the organization ------------------------------------
-- 1 so far this month. Trial and pack drafts are other pools, and drafts of
-- last month do not count. Drafts of this month under an earlier
-- entitlement do: a new period gives no second allowance.
select pg_temp.used(pg_temp.id('org_a'), pg_temp.id('w1'), 'subscription', null, 40,
  (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date);
select pg_temp.used(pg_temp.id('org_a'), null, 'subscription', pg_temp.kept_id('trial'), 58);
select isnt(pg_temp.draft(), 'quotaExceeded', 'the 60th draft of the month passes');
select results_eq(
  $$select refusal, retry_after = ceil(extract(epoch from
      date_trunc('month', now() at time zone 'utc') at time zone 'utc' + interval '1 month' - now()))::integer
    from pg_temp.start(pg_temp.id('w1'), pg_temp.id('s3'))$$,
  $$values ('quotaExceeded', true)$$, 'the 61st is refused until the next month (UTC)');
select results_eq(
  $$select pool, count(*)::int from public.billing_draft_usage
    where organization_id = pg_temp.id('org_a') and pool in ('subscription', 'pack')
      and usage_month = date_trunc('month', now() at time zone 'utc')::date and status <> 'released'
    group by pool order by pool$$,
  $$values ('pack', 2), ('subscription', 60)$$,
  'the ledger keeps the month and the packs apart');

insert into public.billing_ai_packs (organization_id, drafts, expires_at)
values (pg_temp.id('org_a'), 100, now() + interval '11 months');
select isnt(pg_temp.draft(), 'quotaExceeded', 'a Pack IA takes over from the month');

-- Read-only first ---------------------------------------------------------------------------
update public.billing_entitlements set starts_at = now() - interval '40 days', ends_at = now() - interval '8 days'
where organization_id = pg_temp.id('org_a') and scope = 'subscription' and revoked_at is null;
select results_eq($$select refusal, retry_after from pg_temp.start(pg_temp.id('w1'), pg_temp.id('s3'))$$,
  $$values ('readOnly', null::integer)$$, 'a read-only workspace gets no draft, packs or not');
update public.billing_entitlements set ends_at = now() - interval '2 days'
where organization_id = pg_temp.id('org_a') and scope = 'subscription' and revoked_at is null;
select isnt(pg_temp.draft(), 'readOnly', 'in grace, drafts still work');

-- A pass: 80 drafts, apart from the subscription --------------------------------------------
insert into public.workspaces (id, organization_id, name, created_by, billing_mode)
values ('00000000-0000-4000-c000-000000000004', pg_temp.id('org_a'), 'Mission A', pg_temp.id('owner'), 'mission');
insert into public.reports (id, workspace_id, title, created_by)
values ('00000000-0000-4000-d000-000000000004', '00000000-0000-4000-c000-000000000004', 'Mission', pg_temp.id('owner'));
insert into public.report_sections (id, workspace_id, report_id, title)
values ('00000000-0000-4000-e000-000000000014', '00000000-0000-4000-c000-000000000004',
        '00000000-0000-4000-d000-000000000004', 'Terrain');
select results_eq(
  $$select refusal from pg_temp.start('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-e000-000000000014')$$,
  $$values ('readOnly')$$, 'a mission workspace without a pass is read-only, whatever the subscription');

insert into public.billing_entitlements (id, organization_id, workspace_id, scope, plan, source, starts_at, ends_at,
  max_members, max_reports, drafts_total)
values ('00000000-0000-4000-8000-000000000021', pg_temp.id('org_a'), '00000000-0000-4000-c000-000000000004',
  'mission', 'mission', 'manual', now() - interval '1 day', now() + interval '89 days', 10, 1, 80);
insert into kept
select 'mission', generation_id
from pg_temp.start('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-e000-000000000014');
select results_eq($$select pool, entitlement_id, workspace_id from public.billing_draft_usage
                    where generation_id = pg_temp.kept_id('mission')$$,
  $$values ('mission', '00000000-0000-4000-8000-000000000021'::uuid, '00000000-0000-4000-c000-000000000004'::uuid)$$,
  'with a pass, its drafts come from the pass');
select pg_temp.finish(pg_temp.kept_id('mission'), 'succeeded');
select pg_temp.used(pg_temp.id('org_a'), '00000000-0000-4000-c000-000000000004', 'mission',
  '00000000-0000-4000-8000-000000000021', 79);
insert into kept
select 'mission_pack', generation_id
from pg_temp.start('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-e000-000000000014');
select is((pg_temp.usage(pg_temp.kept_id('mission_pack'))).pool, 'pack',
  'past its 80 drafts, the packs of the organization take over');
update public.billing_ai_packs set revoked_at = now() where organization_id = pg_temp.id('org_a');
select results_eq(
  $$select refusal, retry_after from pg_temp.start('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-e000-000000000014')$$,
  $$values ('busy', null::integer)$$, 'the checks from before come first: one draft at a time per section');
select pg_temp.finish(pg_temp.kept_id('mission_pack'), 'failed');
select results_eq(
  $$select refusal, retry_after from pg_temp.start('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-e000-000000000014')$$,
  $$values ('quotaExceeded', null::integer)$$, 'with no pack left, the pass refuses with no date');

-- The ledger outlives the workspace ----------------------------------------------------
insert into public.billing_ai_packs (organization_id, drafts, expires_at)
values (pg_temp.id('org_a'), 10, now() + interval '12 months');
insert into kept select 'running', generation_id from pg_temp.start(pg_temp.id('w1'), pg_temp.id('s1'));
select is((pg_temp.usage(pg_temp.kept_id('dead'))).status, 'released',
  'the dead request is found stale and released');
select is((pg_temp.usage(pg_temp.kept_id('running'))).status, 'reserved', 'while a new draft runs in w1');
delete from public.workspaces where id = '00000000-0000-4000-c000-000000000004';
select is((select count(*)::int from public.billing_entitlements where id = '00000000-0000-4000-8000-000000000021'),
  0, 'deleting the mission workspace deletes its pass');
select is((select count(*)::int from public.billing_draft_usage
           where organization_id = pg_temp.id('org_a') and workspace_id is null and pool = 'mission'
             and status = 'counted'),
  80, 'but its drafts stay in the ledger');
delete from public.workspaces where id = pg_temp.id('w1');
select is((pg_temp.usage(pg_temp.kept_id('running'))).status, 'released',
  'a draft running when its workspace goes is released');
select is((select count(*)::int from public.billing_draft_usage
           where organization_id = pg_temp.id('org_a') and status = 'counted' and pool = 'subscription'
             and usage_month = date_trunc('month', now() at time zone 'utc')::date),
  60, 'and the drafts of the month still count');

-- Nothing is reserved while billing is not enforced ------------------------------------
update private.billing_settings set enforced = false;
insert into kept select 'off', generation_id from pg_temp.start(pg_temp.id('w2'), pg_temp.id('s4'));
select isnt(pg_temp.kept_id('off'), null, 'without enforcement, drafts start');
select is((select count(*)::int from public.billing_draft_usage where generation_id = pg_temp.kept_id('off')),
  0, 'and nothing is reserved');
update private.billing_settings set enforced = true;
select pg_temp.finish(pg_temp.kept_id('off'), 'succeeded');
select is((select count(*)::int from public.billing_draft_usage where organization_id = pg_temp.id('org_b')),
  0, 'finishing it records nothing either');

-- Who reads the ledger ------------------------------------------------------------------
select pg_temp.used(pg_temp.id('org_b'), pg_temp.id('w2'), 'trial', null, 1);
select pg_temp.act_as('outsider');
select is((select count(*)::int from public.billing_draft_usage), 1, 'the owner of org_b reads its ledger only');
select pg_temp.act_as('owner');
select ok((select count(*) > 0 and bool_and(organization_id = pg_temp.id('org_a')) from public.billing_draft_usage),
  'the owner of org_a reads its own');
select pg_temp.act_as('stranger');
select is((select count(*)::int from public.billing_draft_usage), 0, 'someone outside reads none');
select throws_ok($$insert into public.billing_draft_usage (generation_id, organization_id, pool, usage_month)
  values (gen_random_uuid(), pg_temp.id('org_a'), 'trial', date_trunc('month', now())::date)$$,
  '42501', null, 'and nobody signed in writes it');
select is(
  (select coalesce(array_agg(r || ' ' || p order by r, p), '{}')
   from unnest(array['anon', 'authenticated']) r,
        unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, 'public.billing_draft_usage', p)),
  array['authenticated select'], 'signed-in users only read the ledger, visitors nothing');

select * from finish();
rollback;
