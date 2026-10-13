begin;
\ir fixtures.psql
select plan(61);

create temp table v (name text primary key, id uuid);
grant all on v to authenticated;

create or replace function pg_temp.v(name text) returns uuid
language sql as $$ select id from v where v.name = $1 $$;

-- Adds a version of a w1 template as the admin and keeps its id.
create or replace function pg_temp.add_version(name text, key text, version integer, status text)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as('admin');
  with added as (
    insert into public.prompt_library (workspace_id, template_key, version, title, template, status, changelog)
    values (pg_temp.id('w1'), key, version, 'Modele ' || version, 'Version ' || version, status::public.prompt_status,
            case when version > 1 then 'Essai ' || version end)
    returning id
  )
  insert into v select name, id from added;
end;
$$;

create or replace function pg_temp.rollout_of(candidate uuid) returns public.prompt_rollouts
language sql as $$
  select * from public.prompt_rollouts where candidate_id = candidate order by created_at desc limit 1
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- published_at ------------------------------------------------------------------
select isnt((select published_at from public.prompt_library where id = pg_temp.id('p_w1')), null,
  'a published version knows when it was published');
select pg_temp.act_as('admin');
select throws_ok(
  $$insert into public.prompt_library (workspace_id, template_key, version, title, template, status, changelog, published_at)
    values (pg_temp.id('w1'), 'modele-a', 2, 'Modele A', 'x', 'draft', 'x', now())$$,
  '42501', null, 'users cannot set published_at');

-- Starting a rollout ------------------------------------------------------------
select pg_temp.add_version('v2', 'modele-a', 2, 'draft');
select pg_temp.act_as('expert');
select throws_ok($$select public.start_prompt_rollout(pg_temp.v('v2'), 20::smallint)$$, '42501', null,
  'an expert cannot roll out a version');
select pg_temp.act_as('admin');
select lives_ok($$select public.start_prompt_rollout(pg_temp.v('v2'), 20::smallint)$$, 'an admin rolls out a draft to 20 %');
select results_eq(
  $$select percent::int, base_id, status, created_by, ended_at is null from public.prompt_rollouts where candidate_id = pg_temp.v('v2')$$,
  $$values (20, pg_temp.id('p_w1'), 'active', pg_temp.id('admin'), true)$$,
  'the rollout keeps the share, the published version it replaces and its author');

select pg_temp.add_version('v3', 'modele-a', 3, 'draft');
select pg_temp.act_as('admin');
select throws_ok($$select public.start_prompt_rollout(pg_temp.v('v3'), 10::smallint)$$, '23505', null,
  'one rollout at a time per template');
select throws_ok($$select public.start_prompt_rollout(pg_temp.id('p_w1'), 10::smallint)$$, 'KR011', null,
  'only a draft can be rolled out');
select throws_ok($$select public.start_prompt_rollout(pg_temp.v('v3'), 0::smallint)$$, '22023', null,
  'a share of 0 % is refused');
select throws_ok($$select public.start_prompt_rollout(pg_temp.v('v3'), 100::smallint)$$, '22023', null,
  'a share of 100 % is a publish, not a rollout');

select pg_temp.add_version('c1', 'modele-c', 1, 'draft');
select pg_temp.act_as('admin');
select throws_ok($$select public.start_prompt_rollout(pg_temp.v('c1'), 10::smallint)$$, 'KR012', null,
  'a template without a published version cannot be rolled out');

reset role;
with added as (
  insert into public.prompt_library (workspace_id, template_key, version, title, template, status, changelog)
  values (null, 'modele-global', 2, 'Modele global', 'Version globale deux', 'draft', 'Essai global')
  returning id
)
insert into v select 'g2', id from added;
select pg_temp.act_as('admin');
select throws_ok($$select public.start_prompt_rollout(pg_temp.v('g2'), 10::smallint)$$, '42501', null,
  'global templates are rolled out by the platform only');

-- Reading and writing rollouts ---------------------------------------------------
reset role;
insert into public.prompt_rollouts (workspace_id, template_key, candidate_id, base_id, percent, target_workspace_id)
values (null, 'modele-global', pg_temp.v('g2'), pg_temp.id('p_global'), 100, pg_temp.id('w2'));

select pg_temp.act_as('expert');
select is((select count(*)::int from public.prompt_rollouts), 1, 'a member sees the rollouts of their workspace');
select pg_temp.act_as('outsider');
select is((select count(*)::int from public.prompt_rollouts), 1,
  'another workspace sees only the global rollout aimed at it');
select pg_temp.act_as('expert');
select throws_ok(
  $$insert into public.prompt_rollouts (workspace_id, template_key, candidate_id, percent)
    values (pg_temp.id('w1'), 'modele-a', pg_temp.v('v3'), 50)$$,
  '42501', null, 'users cannot insert a rollout directly');
select pg_temp.act_as('admin');
select throws_ok($$update public.prompt_rollouts set percent = 90$$, '42501', null,
  'users cannot update a rollout directly');

select lives_ok($$select public.set_prompt_rollout_percent((pg_temp.rollout_of(pg_temp.v('v2'))).id, 50::smallint)$$,
  'an admin raises the share');
select is((select percent::int from public.prompt_rollouts where candidate_id = pg_temp.v('v2')), 50, 'the share is now 50 %');
select pg_temp.act_as('expert');
select throws_ok($$select public.set_prompt_rollout_percent((pg_temp.rollout_of(pg_temp.v('v2'))).id, 60::smallint)$$,
  '42501', null, 'an expert cannot change the share');

-- Generations under a rollout ----------------------------------------------------
reset role;
insert into v
select 'gen', generation_id from public.start_ai_generation(
  pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.v('v2'), 'section_draft', 1::smallint,
  'mock', 'mock', '{}', 100, 30, 100000, (pg_temp.rollout_of(pg_temp.v('v2'))).id);
select results_eq(
  $$select prompt_version_id, rollout_id from public.ai_generations where id = pg_temp.v('gen')$$,
  $$values (pg_temp.v('v2'), (pg_temp.rollout_of(pg_temp.v('v2'))).id)$$,
  'a generation can use the candidate of an active rollout, and records it');
select results_eq(
  $$select refusal from public.start_ai_generation(
    pg_temp.id('w1'), pg_temp.id('s3'), pg_temp.id('admin'), pg_temp.v('v3'), 'section_draft', 1::smallint,
    'mock', 'mock', '{}', 100, 30, 100000, null)$$,
  $$values ('templateUnavailable')$$, 'a draft outside any rollout is refused');
select results_eq(
  $$select refusal from public.start_ai_generation(
    pg_temp.id('w1'), pg_temp.id('s3'), pg_temp.id('admin'), pg_temp.v('g2'), 'section_draft', 1::smallint,
    'mock', 'mock', '{}', 100, 30, 100000, (pg_temp.rollout_of(pg_temp.v('g2'))).id)$$,
  $$values ('templateUnavailable')$$, 'a rollout aimed at another workspace is refused');
update public.ai_generations
set status = 'succeeded', output = '{}', input_tokens = 900, output_tokens = 300, latency_ms = 2000,
    cost_estimate = 5, completed_at = now(), trace_id = repeat('ab', 16)
where id = pg_temp.v('gen');
select isnt(
  (select generation_id from public.start_ai_generation(
    p_workspace_id => pg_temp.id('w1'), p_section_id => pg_temp.id('s3'), p_user_id => pg_temp.id('admin'),
    p_prompt_version_id => pg_temp.id('p_w1'), p_output_schema => 'section_draft', p_schema_version => 1::smallint,
    p_provider => 'mock', p_model => 'mock', p_params => '{}', p_estimated_tokens => 100, p_rate_limit => 30,
    p_monthly_budget => 100000)),
  null, 'the app version still running calls it without a rollout');

-- Publishing for everyone, rolling back ------------------------------------------
select pg_temp.act_as('admin');
select lives_ok($$select public.end_prompt_rollout((pg_temp.rollout_of(pg_temp.v('v2'))).id, true)$$,
  'an admin publishes the candidate for everyone');
select results_eq(
  $$select status::text from public.prompt_library where id in (pg_temp.v('v2'), pg_temp.id('p_w1')) order by version$$,
  $$values ('archived'), ('published')$$, 'the candidate is published and the version before is archived');
select results_eq(
  $$select status, ended_at is not null from public.prompt_rollouts where candidate_id = pg_temp.v('v2')$$,
  $$values ('promoted', true)$$, 'the rollout is marked as promoted');
select throws_ok($$select public.set_prompt_rollout_percent((pg_temp.rollout_of(pg_temp.v('v2'))).id, 30::smallint)$$,
  'KR010', null, 'a finished rollout cannot change');

select pg_temp.act_as('expert');
select throws_ok($$select public.rollback_prompt_publish(pg_temp.v('v2'))$$, '42501', null,
  'an expert cannot roll back');
select pg_temp.act_as('admin');
select throws_ok($$select public.rollback_prompt_publish(pg_temp.v('v3'))$$, 'KR012', null,
  'only the published version rolls back');
select is((select public.rollback_prompt_publish(pg_temp.v('v2'))), pg_temp.id('p_w1'),
  'rolling back puts back the version published before, in one call');
select results_eq(
  $$select status::text from public.prompt_library where id in (pg_temp.v('v2'), pg_temp.id('p_w1')) order by version$$,
  $$values ('published'), ('archived')$$, 'version 1 is published again and version 2 archived');

select pg_temp.act_as('outsider');
select throws_ok($$select public.rollback_prompt_publish(pg_temp.id('p_w2'))$$, 'KR013', null,
  'a version with nothing published before it cannot roll back');

-- A rollout ends with its candidate ----------------------------------------------
select pg_temp.act_as('admin');
select lives_ok($$select public.start_prompt_rollout(pg_temp.v('v3'), 10::smallint)$$, 'a new rollout starts once the last ended');
update public.prompt_library set status = 'archived' where id = pg_temp.v('v3');
select is((select status from public.prompt_rollouts where candidate_id = pg_temp.v('v3')), 'cancelled',
  'archiving the candidate cancels its rollout');

select pg_temp.add_version('v4', 'modele-a', 4, 'draft');
select pg_temp.act_as('admin');
select lives_ok($$select public.start_prompt_rollout(pg_temp.v('v4'), 10::smallint)$$, 'version 4 is rolled out');
update public.prompt_library set status = 'published' where id = pg_temp.v('v4');
select is((select status from public.prompt_rollouts where candidate_id = pg_temp.v('v4')), 'promoted',
  'publishing the candidate the usual way promotes its rollout');

select pg_temp.add_version('v5', 'modele-a', 5, 'draft');
select pg_temp.act_as('admin');
select lives_ok($$select public.start_prompt_rollout(pg_temp.v('v5'), 10::smallint)$$, 'version 5 is rolled out');
select lives_ok($$select public.end_prompt_rollout((pg_temp.rollout_of(pg_temp.v('v5'))).id, false)$$,
  'an admin stops the rollout');
select results_eq(
  $$select r.status, p.status::text from public.prompt_rollouts r join public.prompt_library p on p.id = r.candidate_id
    where r.candidate_id = pg_temp.v('v5')$$,
  $$values ('cancelled', 'draft')$$, 'a stopped rollout leaves its candidate a draft');

-- Publishing another version ends the rollout ---------------------------------------
select pg_temp.add_version('v6', 'modele-a', 6, 'draft');
select pg_temp.add_version('v7', 'modele-a', 7, 'draft');
select pg_temp.act_as('admin');
select lives_ok($$select public.start_prompt_rollout(pg_temp.v('v6'), 30::smallint)$$, 'version 6 is rolled out');
update public.prompt_library set status = 'published' where id = pg_temp.v('v7');
select is((select status from public.prompt_rollouts where candidate_id = pg_temp.v('v6')), 'cancelled',
  'publishing another version cancels the rollout');
reset role;
select results_eq(
  $$select refusal from public.start_ai_generation(
    pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.v('v6'), 'section_draft', 1::smallint,
    'mock', 'mock', '{}', 100, 30, 100000, (pg_temp.rollout_of(pg_temp.v('v6'))).id)$$,
  $$values ('templateUnavailable')$$, 'the cancelled rollout no longer serves its candidate');

select pg_temp.add_version('v8', 'modele-a', 8, 'draft');
select pg_temp.act_as('admin');
select lives_ok($$select public.start_prompt_rollout(pg_temp.v('v8'), 10::smallint)$$, 'version 8 is rolled out');
select lives_ok($$select public.rollback_prompt_publish(pg_temp.v('v7'))$$, 'an admin rolls version 7 back');
select is((select status from public.prompt_rollouts where candidate_id = pg_temp.v('v8')), 'cancelled',
  'rolling back cancels the rollout too');

select pg_temp.add_version('v9', 'modele-a', 9, 'draft');
select pg_temp.act_as('admin');
select lives_ok($$select public.start_prompt_rollout(pg_temp.v('v9'), 10::smallint)$$, 'version 9 is rolled out');
select pg_temp.add_version('v10', 'modele-a', 10, 'published');
select is((select status from public.prompt_rollouts where candidate_id = pg_temp.v('v9')), 'cancelled',
  'a version saved as published cancels the rollout');

-- Rollout rows match their template -----------------------------------------------------
select pg_temp.add_version('v11', 'modele-a', 11, 'draft');
reset role;
select throws_ok(
  $$insert into public.prompt_rollouts (workspace_id, template_key, candidate_id, percent)
    values (null, 'modele-a', pg_temp.v('v11'), 10)$$,
  '22023', null, 'a global rollout cannot serve a workspace version');
select throws_ok(
  $$insert into public.prompt_rollouts (workspace_id, template_key, candidate_id, percent)
    values (pg_temp.id('w1'), 'modele-a', pg_temp.id('p_w1'), 10)$$,
  'KR011', null, 'a rollout row needs a draft candidate');
select throws_ok(
  $$insert into public.prompt_rollouts (workspace_id, template_key, candidate_id, base_id, percent)
    values (pg_temp.id('w1'), 'modele-a', pg_temp.v('v11'), pg_temp.id('p_w2'), 10)$$,
  '22023', null, 'the base must be a version of the same template');

-- Dashboard figures ---------------------------------------------------------------
select pg_temp.act_as('admin');
select results_eq(
  $$select generations::int, succeeded::int, failure_rate, from_rollout::int, total_tokens::int, cost, p50_latency_ms, p95_latency_ms
    from public.ai_prompt_metrics(pg_temp.id('w1'), now() - interval '1 day') where prompt_version_id = pg_temp.v('v2')$$,
  $$values (1, 1, 0.0000, 1, 1200, 5.000000, 2000, 2000)$$,
  'the metrics give counts, rates, tokens, cost and latency per prompt version');
select is((select count(*)::int from public.ai_prompt_metrics(pg_temp.id('w1'), now() + interval '1 day')), 0,
  'the period filters generations');
select pg_temp.act_as('outsider');
select is((select count(*)::int from public.ai_prompt_metrics(pg_temp.id('w1'), null)), 0,
  'another workspace gets no figures (RLS)');

-- Daily cost alert --------------------------------------------------------------------
select pg_temp.act_as('admin');
select throws_ok($$select public.claim_ai_cost_alert(1)$$, '42501', null, 'users cannot claim the cost alert');
select throws_ok($$select * from public.ai_cost_alerts$$, '42501', null, 'users cannot read the cost alerts');
select throws_ok($$select public.release_ai_cost_alert()$$, '42501', null, 'users cannot release the cost alert');
reset role;
select is(public.claim_ai_cost_alert(100), null, 'below the threshold, no alert');
select is(public.claim_ai_cost_alert(1), 5.000000::numeric, 'past the threshold, the day is claimed with the spend');
select is(public.claim_ai_cost_alert(1), null, 'only once a day');
select lives_ok($$select public.release_ai_cost_alert()$$, 'a failed e-mail gives the day back');
select is(public.claim_ai_cost_alert(1), 5.000000::numeric, 'the next generation claims it again');
select has_index('public', 'ai_generations', 'ai_generations_created_idx', 'the daily sum reads an index');

select * from finish();
rollback;
