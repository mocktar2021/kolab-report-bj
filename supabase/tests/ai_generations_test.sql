begin;
\ir fixtures.psql
select plan(51);

-- Starts a generation as the app does (service role).
create or replace function pg_temp.start(
  section text, requester text, prompt uuid,
  rate_limit integer, budget bigint, estimate integer, output_schema text, workspace text
) returns table (generation_id uuid, refusal text, retry_after integer)
language sql as $$
  select * from public.start_ai_generation(
    pg_temp.id(workspace), pg_temp.id(section), pg_temp.id(requester), prompt, output_schema, 1::smallint,
    'mock', 'mock', '{"temperature": 0.3}', estimate, rate_limit, budget, null
  );
$$;

create or replace function pg_temp.template(key text) returns uuid
language sql as $$
  select id from public.prompt_library where workspace_id is null and template_key = key and status = 'published';
$$;

create or replace function pg_temp.succeed(generation uuid, tokens_in integer, tokens_out integer) returns void
language sql as $$
  update public.ai_generations
  set status = 'succeeded', output = '{"title": "Brouillon"}', raw_output = '{"title": "Brouillon"}',
      input_tokens = tokens_in, output_tokens = tokens_out, latency_ms = 1200, draft_words = 100,
      completed_at = now()
  where id = generation;
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- Starting: only the app, with a published template the workspace can use -------
select pg_temp.act_as('expert');
select throws_ok(
  $$select * from public.start_ai_generation(pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'),
    pg_temp.template('synthese-section'), 'section_draft', 1::smallint, 'mock', 'mock', '{}', 10, 30, 100000, null)$$,
  '42501', null, 'users cannot start a generation themselves');

reset role;
create temp table run (name text primary key, id uuid);
grant all on run to authenticated;

insert into run
select 'first', generation_id from pg_temp.start('s1', 'expert', pg_temp.template('synthese-section'), 30, 100000, 1000, 'section_draft', 'w1');
select isnt((select id from run where name = 'first'), null, 'the app starts a generation for s1');
select results_eq(
  $$select status::text, requested_by, estimated_tokens, total_tokens from public.ai_generations where id = (select id from run where name = 'first')$$,
  $$values ('running', pg_temp.id('expert'), 1000, 0)$$,
  'the new generation runs, with its requester and estimate');

select results_eq(
  $$select refusal from pg_temp.start('s1', 'admin', pg_temp.template('synthese-section'), 30, 100000, 1000, 'section_draft', 'w1')$$,
  $$values ('busy')$$, 'a second draft of the same section waits for the first');
select results_eq(
  $$select refusal from pg_temp.start('s1', 'expert', pg_temp.id('p_w2'), 30, 100000, 1000, 'section_draft', 'w1')$$,
  $$values ('templateUnavailable')$$, 'a template of another workspace is refused');
select results_eq(
  $$select refusal from pg_temp.start('s1', 'expert', pg_temp.template('resume-executif'), 30, 100000, 1000, 'section_draft', 'w1')$$,
  $$values ('templateUnavailable')$$, 'a template is refused when the output schema does not match');

update public.prompt_library set status = 'archived' where id = pg_temp.id('p_w1');
select results_eq(
  $$select refusal from pg_temp.start('s3', 'admin', pg_temp.id('p_w1'), 30, 100000, 1000, 'section_draft', 'w1')$$,
  $$values ('templateUnavailable')$$, 'an unpublished template is refused');
update public.prompt_library set status = 'published' where id = pg_temp.id('p_w1');

-- Hourly limit per user ---------------------------------------------------------
select results_eq(
  $$select refusal from pg_temp.start('s3', 'expert', pg_temp.template('synthese-section'), 1, 100000, 1000, 'section_draft', 'w1')$$,
  $$values ('rateLimited')$$, 'past the hourly limit, the request is refused');
select ok(
  (select retry_after between 3500 and 3600 from pg_temp.start('s3', 'expert', pg_temp.template('synthese-section'), 1, 100000, 1000, 'section_draft', 'w1')),
  'and told to wait until the oldest request leaves the hour');
select is(
  (select count(*)::int from public.ai_generations where requested_by = pg_temp.id('expert')), 1,
  'a refused request leaves no row');

update public.ai_generations set created_at = now() - interval '61 minutes'
where id = (select id from run where name = 'first');
select results_eq(
  $$select refusal from pg_temp.start('s3', 'expert', pg_temp.template('synthese-section'), 1, 100000, 1000, 'section_draft', 'w1')$$,
  $$values (null::text)$$, 'requests older than an hour no longer count');
delete from public.ai_generations where section_id = pg_temp.id('s3');

-- A running draft past 10 minutes is taken for dead ---------------------------
select results_eq(
  $$select refusal from pg_temp.start('s1', 'expert', pg_temp.template('synthese-section'), 30, 100000, 1000, 'section_draft', 'w1')$$,
  $$values (null::text)$$, 'a draft stuck for more than 10 minutes does not block the section');
select results_eq(
  $$select status::text, error_code from public.ai_generations where id = (select id from run where name = 'first')$$,
  $$values ('failed', 'stale')$$, 'the stuck draft is marked as failed');
delete from public.ai_generations where section_id = pg_temp.id('s1') and status = 'running';

-- Monthly budget per workspace -------------------------------------------------
insert into run
select 'second', generation_id from pg_temp.start('s1', 'expert', pg_temp.template('synthese-section'), 30, 100000, 1000, 'section_draft', 'w1');
select pg_temp.succeed((select id from run where name = 'second'), 1000, 500);
select is((select total_tokens from public.ai_generations where id = (select id from run where name = 'second')), 1500,
  'total tokens add input and output');
select results_eq(
  $$select refusal from pg_temp.start('s3', 'admin', pg_temp.template('synthese-section'), 30, 1600, 200, 'section_draft', 'w1')$$,
  $$values ('budgetExceeded')$$, 'a request that would pass the monthly budget is refused');
select ok(
  (select retry_after > 0 from pg_temp.start('s3', 'admin', pg_temp.template('synthese-section'), 30, 1600, 200, 'section_draft', 'w1')),
  'and told to wait for the next month');
select results_eq(
  $$select refusal from pg_temp.start('s4', 'outsider', pg_temp.template('synthese-section'), 30, 1600, 200, 'section_draft', 'w2')$$,
  $$values (null::text)$$, 'another workspace has its own budget');

-- Reading ---------------------------------------------------------------------
select pg_temp.act_as('expert');
select is((select count(*)::int from public.ai_generations), 2, 'the assigned expert sees the drafts of s1');
select pg_temp.act_as('admin');
select is((select count(*)::int from public.ai_generations), 2, 'a manager sees the drafts of the workspace');
select pg_temp.act_as('expert2');
select is((select count(*)::int from public.ai_generations), 0, 'another expert does not see them');
select pg_temp.act_as('viewer');
select is((select count(*)::int from public.ai_generations), 0, 'a viewer does not see them');
select pg_temp.act_as('outsider');
select is((select count(*)::int from public.ai_generations), 1, 'another workspace sees only its own');
select pg_temp.act_as('expert');
select is((select generations::int from public.ai_generation_metrics), 2, 'the metrics count what the user may read');

-- Users never write generations directly ---------------------------------------
select throws_ok(
  $$insert into public.ai_generations (workspace_id, section_id, output_schema, schema_version, provider, model, estimated_tokens)
    values (pg_temp.id('w1'), pg_temp.id('s1'), 'section_draft', 1, 'mock', 'mock', 0)$$,
  '42501', null, 'users cannot insert a generation');
select throws_ok(
  $$update public.ai_generations set input_tokens = 0 where id = (select id from run where name = 'second')$$,
  '42501', null, 'users cannot change the usage of a generation');
select throws_ok(
  $$update public.ai_generations set accepted = true where id = (select id from run where name = 'second')$$,
  '42501', null, 'users cannot mark a draft accepted without the function');
select throws_ok(
  $$delete from public.ai_generations where id = (select id from run where name = 'second')$$,
  '42501', null, 'users cannot delete a generation');

-- Feedback ----------------------------------------------------------------------
select is(
  pg_temp.affected($$update public.ai_generations set user_rating = 1, feedback_comment = 'Bon point de départ'
    where id = (select id from run where name = 'second')$$),
  1, 'the requester rates the draft');
select throws_ok(
  $$update public.ai_generations set user_rating = 5 where id = (select id from run where name = 'second')$$,
  '23514', null, 'a rating is 1 or -1');
select is(
  pg_temp.affected($$update public.ai_generations set user_rating = -1 where id = (select id from run where name = 'first')$$),
  0, 'a failed draft cannot be rated');
select pg_temp.act_as('admin');
select is(
  pg_temp.affected($$update public.ai_generations set user_rating = -1 where id = (select id from run where name = 'second')$$),
  0, 'someone else cannot rate the requester''s draft');

-- Accepting and discarding -------------------------------------------------------
select pg_temp.act_as('expert2');
select throws_ok(
  $$select public.accept_ai_generation((select id from run where name = 'second'), 'Texte', 0, null)$$,
  '42501', null, 'an expert of another section cannot accept the draft');
select pg_temp.act_as('viewer');
select throws_ok(
  $$select public.discard_ai_generation((select id from run where name = 'second'))$$,
  '42501', null, 'a viewer cannot discard it');
select pg_temp.act_as('expert');
select throws_ok(
  $$select public.accept_ai_generation(gen_random_uuid(), 'Texte', 0, null)$$,
  'P0002', null, 'an unknown draft is reported as missing');
select throws_ok(
  $$select public.accept_ai_generation((select id from run where name = 'first'), 'Texte', 0, null)$$,
  '55000', null, 'a failed draft cannot be accepted');
select throws_ok(
  $$select public.accept_ai_generation((select id from run where name = 'second'), '   ', 0, null)$$,
  '22023', null, 'accepted text cannot be empty');
select throws_ok(
  $$select public.accept_ai_generation((select id from run where name = 'second'), 'Texte', 0, now() - interval '1 day')$$,
  '40001', null, 'a section changed since the page loaded is not overwritten');
-- Moving the section changes updated_at but not the text version (KRB-18).
reset role;
select set_config('request.jwt.claims', '', true);
update public.report_sections set position = position + 1 where id = pg_temp.id('s1');
select pg_temp.act_as('expert');
select lives_ok(
  $$select public.accept_ai_generation((select id from run where name = 'second'), 'Texte accepté', 12,
    (select content_updated_at from public.report_sections where id = pg_temp.id('s1')))$$,
  'the assigned expert accepts the draft with the text version, even after the section moved');
select results_eq(
  $$select content, status::text, ai_draft, ai_generated_at is not null from public.report_sections where id = pg_temp.id('s1')$$,
  $$values ('Texte accepté', 'in_progress', '{"title": "Brouillon"}'::jsonb, true)$$,
  'the section gets the text, moves to in progress and keeps the structured draft');
select results_eq(
  $$select accepted, edit_distance, decided_at is not null from public.ai_generations where id = (select id from run where name = 'second')$$,
  $$values (true, 12, true)$$, 'the decision and the edit distance are recorded');
select throws_ok(
  $$select public.discard_ai_generation((select id from run where name = 'second'))$$,
  '55000', null, 'a decided draft cannot be decided again');

reset role;
insert into run
select 'third', generation_id from pg_temp.start('s1', 'expert', pg_temp.template('synthese-section'), 30, 100000, 1000, 'section_draft', 'w1');
select pg_temp.act_as('expert');
select throws_ok(
  $$select public.discard_ai_generation((select id from run where name = 'third'))$$,
  '55000', null, 'a running draft cannot be discarded');
reset role;
select pg_temp.succeed((select id from run where name = 'third'), 800, 400);
select pg_temp.act_as('expert');
select lives_ok($$select public.discard_ai_generation((select id from run where name = 'third'))$$,
  'the expert discards the next draft');
select results_eq(
  $$select accepted, edit_distance from public.ai_generations where id = (select id from run where name = 'third')$$,
  $$values (false, null::integer)$$, 'a discarded draft is recorded as such');
select is((select content from public.report_sections where id = pg_temp.id('s1')), 'Texte accepté',
  'discarding leaves the section text alone');

select pg_temp.act_as('admin');
select results_eq(
  $$select generations::int, succeeded::int, failed::int, accepted::int, discarded::int, thumbs_up::int, mean_edit_ratio
    from public.ai_generation_metrics where workspace_id = pg_temp.id('w1')$$,
  $$values (3, 2, 1, 1, 1, 1, 0.12)$$,
  'the metrics count outcomes, ratings and the edit ratio per prompt version and model');

-- Usage outlives the section ---------------------------------------------------
reset role;
select lives_ok($$delete from public.report_sections where id = pg_temp.id('s1')$$,
  'a section with drafts can be deleted');
select is(
  (select count(*)::int from public.ai_generations where workspace_id = pg_temp.id('w1') and section_id is null), 3,
  'its drafts stay, without a section');
select results_eq(
  $$select refusal from pg_temp.start('s3', 'expert', pg_temp.template('synthese-section'), 2, 100000, 1000, 'section_draft', 'w1')$$,
  $$values ('rateLimited')$$, 'they still count against the hourly limit');
select results_eq(
  $$select refusal from pg_temp.start('s3', 'admin', pg_temp.template('synthese-section'), 30, 2800, 200, 'section_draft', 'w1')$$,
  $$values ('budgetExceeded')$$, 'and against the monthly budget');
delete from public.workspaces where id = pg_temp.id('w2');
select is((select count(*)::int from public.ai_generations where workspace_id = pg_temp.id('w2')), 0,
  'deleting the workspace removes its drafts');

select * from finish();
rollback;
