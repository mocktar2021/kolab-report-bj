begin;
\ir fixtures.psql
select plan(23);

-- AI token volume (KRB-252). Each pool of AI drafts (trial, month of a plan,
-- pass, Pack IA) has 50,000 tokens per draft it includes. A draft reserves
-- its estimate, counts what its calls used, gives it back when it fails, and
-- is refused with tokenQuotaExceeded when a pool has a draft left but not
-- the tokens.

update private.billing_settings set enforced = true;

-- Starts a draft of s3 in w1 as the app does (service role).
create function pg_temp.start(estimate integer, budget bigint default 1000000000)
returns table (generation_id uuid, refusal text, retry_after integer)
language sql as $$
  select * from public.start_ai_generation(
    pg_temp.id('w1'), pg_temp.id('s3'), pg_temp.id('expert'),
    (select p.id from public.prompt_library p
     where p.workspace_id is null and p.template_key = 'synthese-section' and p.status = 'published'),
    'section_draft', 1::smallint, 'mock', 'mock', '{}', estimate, 1000, budget, null
  );
$$;

-- Ends a generation as the draft route does, with the tokens its calls used.
create function pg_temp.finish(generation uuid, outcome text, tokens_in integer default null, tokens_out integer default null)
returns void
language sql as $$
  update public.ai_generations
  set status = outcome::public.ai_generation_status,
      output = case when outcome = 'succeeded' then '{"title": "Brouillon"}'::jsonb end,
      error_code = case when outcome = 'failed' then 'providerError' end,
      input_tokens = tokens_in,
      output_tokens = tokens_out,
      completed_at = now()
  where id = generation;
$$;

-- n drafts already counted in a pool, with their tokens, without generations.
create function pg_temp.used(p_pool text, entitlement uuid, n integer, each_tokens bigint)
returns void
language sql as $$
  insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id,
    usage_month, status, settled_at, tokens)
  select gen_random_uuid(), pg_temp.id('org_a'), pg_temp.id('w1'), p_pool, entitlement,
    date_trunc('month', now() at time zone 'utc')::date, 'counted', now(), each_tokens
  from generate_series(1, n);
$$;

create function pg_temp.usage(generation uuid) returns public.billing_draft_usage
language sql as $$ select * from public.billing_draft_usage where generation_id = generation $$;

create temp table kept (name text primary key, id uuid);
create function pg_temp.kept_id(name text) returns uuid
language sql as $$ select id from kept where kept.name = $1 $$;

select pg_temp.act_as_server();
insert into kept
select 'trial', id from public.billing_entitlements where organization_id = pg_temp.id('org_a') and plan = 'trial';

select is(private.billing_tokens_per_draft(), 50000::bigint, 'each draft included brings 50,000 tokens');

-- Reserve, count, release ------------------------------------------------------------------
insert into kept select 'big', generation_id from pg_temp.start(300000);
select results_eq($$select status, tokens from public.billing_draft_usage where generation_id = pg_temp.kept_id('big')$$,
  $$values ('reserved', 300000::bigint)$$, 'a draft reserves its estimate');
select pg_temp.finish(pg_temp.kept_id('big'), 'succeeded', 200000, 5000);
select results_eq($$select status, tokens from public.billing_draft_usage where generation_id = pg_temp.kept_id('big')$$,
  $$values ('counted', 205000::bigint)$$, 'and counts what its calls used once it succeeds');

insert into kept select 'failed', generation_id from pg_temp.start(400000);
select pg_temp.finish(pg_temp.kept_id('failed'), 'failed', 400000, 0);
select is((pg_temp.usage(pg_temp.kept_id('failed'))).status, 'released', 'a failed draft gives its tokens back');

insert into kept select 'no_usage', generation_id from pg_temp.start(100000);
select pg_temp.finish(pg_temp.kept_id('no_usage'), 'succeeded');
select is((pg_temp.usage(pg_temp.kept_id('no_usage'))).tokens, 100000::bigint,
  'a success with no usage recorded keeps its estimate');

-- The trial: 20 drafts, 1,000,000 tokens ---------------------------------------------------
-- 305,000 tokens and 2 drafts used so far.
select is(private.billing_tokens_used(pg_temp.id('org_a'), pg_temp.kept_id('trial'), 'trial', false), 305000::bigint,
  'the trial adds up the tokens of its counted drafts');
select results_eq($$select refusal, retry_after from pg_temp.start(700000)$$,
  $$values ('tokenQuotaExceeded', null::integer)$$,
  'a draft past the trial''s tokens is refused, though drafts are left, with no date to wait for');
insert into kept select 'fits', generation_id from pg_temp.start(695000);
select isnt(pg_temp.kept_id('fits'), null, 'one that fills the volume exactly passes');
select pg_temp.finish(pg_temp.kept_id('fits'), 'failed');

-- Pack IA: drafts and tokens ---------------------------------------------------------------
-- The trial's tokens are used up from here on, with drafts left.
select pg_temp.used('trial', pg_temp.kept_id('trial'), 1, 695000);
insert into public.billing_ai_packs (id, organization_id, drafts, expires_at) values
  ('00000000-0000-4000-8000-000000000021', pg_temp.id('org_a'), 1, now() + interval '1 month'),
  ('00000000-0000-4000-8000-000000000022', pg_temp.id('org_a'), 100, now() + interval '12 months');
insert into kept select 'pack_big', generation_id from pg_temp.start(60000);
select results_eq($$select pool, pack_id, tokens from public.billing_draft_usage where generation_id = pg_temp.kept_id('pack_big')$$,
  $$values ('pack', '00000000-0000-4000-8000-000000000022'::uuid, 60000::bigint)$$,
  'a pack takes over when the trial lacks the tokens, past a pack too small for this draft');
select pg_temp.finish(pg_temp.kept_id('pack_big'), 'succeeded', 55000, 5000);
insert into kept select 'pack_small', generation_id from pg_temp.start(40000);
select is((pg_temp.usage(pg_temp.kept_id('pack_small'))).pack_id, '00000000-0000-4000-8000-000000000021'::uuid,
  'a smaller draft goes to the pack that expires first');
select pg_temp.finish(pg_temp.kept_id('pack_small'), 'succeeded', 30000, 0);
select is(private.billing_pack_tokens_used('00000000-0000-4000-8000-000000000022'), 60000::bigint,
  'a pack adds up its own tokens');

update public.billing_ai_packs set revoked_at = now() where id = '00000000-0000-4000-8000-000000000022';
select is((select refusal from pg_temp.start(10000)), 'tokenQuotaExceeded',
  'with drafts left but no tokens anywhere, the refusal names the tokens');
select pg_temp.used('trial', pg_temp.kept_id('trial'), 17, 0);
select is((select refusal from pg_temp.start(10000)), 'quotaExceeded',
  'with no draft left anywhere, it stays quotaExceeded');

-- Indépendant: 60 drafts and 3,000,000 tokens a month --------------------------------------
insert into kept select 'independant', pg_temp.set_plan(pg_temp.id('org_a'), 'independant');
select pg_temp.used('subscription', pg_temp.kept_id('independant'), 1, 2900000);
select results_eq(
  $$select refusal, retry_after = ceil(extract(epoch from
      date_trunc('month', now() at time zone 'utc') at time zone 'utc' + interval '1 month' - now()))::integer
    from pg_temp.start(200000)$$,
  $$values ('tokenQuotaExceeded', true)$$, 'a monthly volume comes back next month (UTC)');
insert into kept select 'month_fits', generation_id from pg_temp.start(100000);
select isnt(pg_temp.kept_id('month_fits'), null, 'a draft that fits the month passes');
select pg_temp.finish(pg_temp.kept_id('month_fits'), 'failed');

select results_eq(
  $$select (d ->> 'tokensUsed')::bigint, (d ->> 'tokensAllowance')::bigint
    from private.billing_line_drafts(pg_temp.id('org_a'), false, pg_temp.kept_id('independant'), 'independant', 60, null) d$$,
  $$values (2900000::bigint, 3000000::bigint)$$, 'the billing page reads the tokens of the month and the volume');
select is(
  private.billing_line_drafts(pg_temp.id('org_a'), false, pg_temp.kept_id('independant'), 'institution', null, null)
    ->> 'tokensAllowance',
  null::text, 'a line with no draft limit has no token volume');

update public.billing_entitlements set drafts_per_month = null where id = pg_temp.kept_id('independant');
insert into kept select 'unlimited', generation_id from pg_temp.start(5000000);
select isnt(pg_temp.kept_id('unlimited'), null, 'a plan with no draft limit has no token volume either');
select pg_temp.finish(pg_temp.kept_id('unlimited'), 'failed');

-- The workspace budget only without billing ------------------------------------------------
insert into kept select 'budget_on', generation_id from pg_temp.start(1000, 1);
select isnt(pg_temp.kept_id('budget_on'), null, 'with billing enforced, the workspace budget no longer applies');
select pg_temp.finish(pg_temp.kept_id('budget_on'), 'failed');
update private.billing_settings set enforced = false;
select is((select refusal from pg_temp.start(1000, 1)), 'budgetExceeded', 'without billing, it still does');
update private.billing_settings set enforced = true;

-- The plan reading: no estimate, real tokens once it succeeds ------------------------------
insert into kept values ('plan', gen_random_uuid());
select is((select refusal from private.billing_reserve_draft(pg_temp.id('w1'), pg_temp.kept_id('plan'), null)), null::text,
  'the plan reading reserves a draft with three arguments');
insert into public.plan_import_calls (id, workspace_id, report_id, user_id, provider, model, input_chars, pages)
values (pg_temp.kept_id('plan'), pg_temp.id('w1'), pg_temp.id('r1'), pg_temp.id('owner'), 'mock', 'mock', 100, 1);
update public.plan_import_calls set status = 'succeeded', input_tokens = 1200, output_tokens = 300, completed_at = now()
where id = pg_temp.kept_id('plan');
select results_eq($$select status, tokens from public.billing_draft_usage where generation_id = pg_temp.kept_id('plan')$$,
  $$values ('counted', 1500::bigint)$$, 'and counts its tokens when it succeeds');

-- Privileges -------------------------------------------------------------------------------
select is(
  (select coalesce(array_agg(f order by f), '{}')
   from unnest(array[
     'private.billing_tokens_per_draft()',
     'private.billing_tokens_used(uuid, uuid, text, boolean)',
     'private.billing_pack_tokens_used(uuid)',
     'private.billing_reserve_draft(uuid, uuid, uuid, bigint)']) f
   where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  '{}'::text[], 'nobody signed in calls the token helpers');

select * from finish();
rollback;
