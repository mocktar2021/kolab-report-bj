-- Creating a report's sections from its plan, and counting the AI reading of
-- a PDF plan as one AI draft of the month (KRB-196).
begin;
\ir fixtures.psql
select plan(67);

update private.billing_settings set enforced = true;

create temp table kept (name text primary key, id uuid);
grant all on kept to authenticated;
create function pg_temp.kept_id(name text) returns uuid
language sql as $$ select id from kept where kept.name = $1 $$;

-- Sections of r1 in document order: a section, then its subsections.
create function pg_temp.outline(report uuid) returns table (title text, parent text, pos integer, instructions text)
language sql as $$
  select s.title, p.title, s.position, s.instructions
  from public.report_sections s
  left join public.report_sections p on p.id = s.parent_id
  where s.report_id = report
  order by coalesce(p.position, s.position), s.parent_id is not null, s.position;
$$;

create function pg_temp.section_count(report uuid) returns integer
language sql as $$ select count(*)::int from public.report_sections where report_id = report $$;

-- Starts a reading as the app does (service role), for the owner of w1 unless told otherwise.
create function pg_temp.start(who text default 'owner', report text default 'r1', hourly integer default 100)
returns table (call_id uuid, refusal text, retry_after integer)
language sql as $$
  select * from public.start_plan_import_call(
    (select r.workspace_id from public.reports r where r.id = pg_temp.id(report)),
    pg_temp.id(report), pg_temp.id(who), 'mock', 'mock', 12000, 3, hourly);
$$;

create function pg_temp.usage(call uuid) returns text
language sql as $$ select status from public.billing_draft_usage where generation_id = call $$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- Importing a plan ----------------------------------------------------------------
select pg_temp.act_as('owner');
select is(
  public.import_report_plan(pg_temp.id('r1'), jsonb_build_array(
    jsonb_build_object('title', '  Contexte   et  justification ', 'level', 1, 'instructions', 'Rappeler le projet.'),
    jsonb_build_object('title', 'Objectif général', 'level', 2, 'instructions', '  '),
    jsonb_build_object('title', 'Objectifs spécifiques', 'level', 2, 'instructions', null),
    jsonb_build_object('title', 'Méthodologie', 'level', 1),
    jsonb_build_object('title', 'Calendrier', 'level', 1, 'instructions', E'Trois phases.\nUn livrable par phase.'),
    jsonb_build_object('title', 'Phase 1', 'level', 2, 'instructions', 'Cadrage.'))),
  6, 'the owner imports a plan of six items');
select results_eq(
  $$select title, parent, pos, instructions from pg_temp.outline(pg_temp.id('r1'))
    where title not in ('Contexte', 'Analyse', 'Annexes')$$,
  $$values
    ('Contexte et justification'::text, null::text, 1, 'Rappeler le projet.'::text),
    ('Objectif général', 'Contexte et justification', 0, null),
    ('Objectifs spécifiques', 'Contexte et justification', 1, null),
    ('Méthodologie', null, 2, null),
    ('Calendrier', null, 3, E'Trois phases.\nUn livrable par phase.'),
    ('Phase 1', 'Calendrier', 0, 'Cadrage.')$$,
  'sections go after the existing ones, each subsection under the section before it');
select is(
  (select count(*)::int from public.report_sections
   where report_id = pg_temp.id('r1') and parent_id is null and position = 0),
  3, 'the existing sections keep their place');

select pg_temp.act_as('admin');
select is(
  public.import_report_plan(pg_temp.id('r1'), '[{"title": "Annexe A", "level": 1}]'),
  1, 'an admin imports a plan too');
select is(
  (select position from public.report_sections where report_id = pg_temp.id('r1') and title = 'Annexe A'),
  4, 'a second import goes after the first');

-- Who may import ------------------------------------------------------------------
select pg_temp.act_as('expert');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[{"title": "X", "level": 1}]')$$,
  '42501', null, 'an expert cannot import a plan');
select pg_temp.act_as('viewer');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[{"title": "X", "level": 1}]')$$,
  '42501', null, 'nor can a viewer');
select pg_temp.act_as('outsider');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[{"title": "X", "level": 1}]')$$,
  'P0002', 'Rapport introuvable', 'someone outside the workspace finds no report');
select pg_temp.act_as('stranger');
select throws_ok($$select public.import_report_plan(gen_random_uuid(), '[{"title": "X", "level": 1}]')$$,
  'P0002', null, 'a missing report answers the same');
select pg_temp.act_as_anon();
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[{"title": "X", "level": 1}]')$$,
  '42501', null, 'a visitor cannot call it');

-- What a plan may hold --------------------------------------------------------------
select pg_temp.act_as('owner');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '{"title": "X"}')$$,
  '22023', null, 'a plan is a list');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[]')$$,
  '22023', null, 'with at least one item');
select throws_ok(
  $$select public.import_report_plan(pg_temp.id('r1'),
    (select jsonb_agg(jsonb_build_object('title', 'Titre ' || n, 'level', 1)) from generate_series(1, 201) n))$$,
  '22023', 'Un plan compte de 1 à 200 éléments', 'and at most 200');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[{"title": "Sous", "level": 2}]')$$,
  '22023', 'Le premier élément du plan est une section', 'the first item is a section');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[{"title": "   ", "level": 1}]')$$,
  '22023', null, 'a title is not empty');
select throws_ok(
  $$select public.import_report_plan(pg_temp.id('r1'), jsonb_build_array(jsonb_build_object('title', repeat('a', 201), 'level', 1)))$$,
  '22023', null, 'a title has at most 200 characters');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[{"title": 12, "level": 1}]')$$,
  '22023', null, 'a title is text');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[{"title": "X", "level": 3}]')$$,
  '22023', null, 'there are two levels');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[{"title": "X", "level": "1"}]')$$,
  '22023', null, 'given as numbers');
select throws_ok(
  $$select public.import_report_plan(pg_temp.id('r1'),
    jsonb_build_array(jsonb_build_object('title', 'X', 'level', 1, 'instructions', repeat('a', 4001))))$$,
  '22023', null, 'instructions have at most 4000 characters');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[{"title": "X", "level": 1, "instructions": 4}]')$$,
  '22023', null, 'instructions are text');
select throws_ok(
  $$select public.import_report_plan(pg_temp.id('r1'),
    '[{"title": "Bon", "level": 1}, {"title": "Bon aussi", "level": 2}, {"title": "", "level": 1}]')$$,
  '22023', 'Le titre de l''élément 3 compte de 1 à 200 caractères', 'the message names the item at fault');
select is(pg_temp.section_count(pg_temp.id('r1')), 10, 'a refused plan creates nothing');

-- Limits of the report ----------------------------------------------------------------
select pg_temp.act_as_server();
insert into public.report_sections (workspace_id, report_id, title, position)
select pg_temp.id('w2'), pg_temp.id('r2'), 'Section ' || n, n from generate_series(1, 400) n;
select pg_temp.act_as('outsider');
select throws_ok(
  $$select public.import_report_plan(pg_temp.id('r2'),
    (select jsonb_agg(jsonb_build_object('title', 'Titre ' || n, 'level', 1)) from generate_series(1, 100) n))$$,
  'KR052', null, 'a report has at most 500 sections');
select is(
  public.import_report_plan(pg_temp.id('r2'),
    (select jsonb_agg(jsonb_build_object('title', 'Titre ' || n, 'level', 1)) from generate_series(1, 99) n)),
  99, 'up to 500');

select pg_temp.act_as_server();
update public.reports set status = 'final' where id = pg_temp.id('r2');
select pg_temp.act_as('outsider');
select throws_ok($$select public.import_report_plan(pg_temp.id('r2'), '[{"title": "X", "level": 1}]')$$,
  'KR020', null, 'nothing is imported into a final report');

-- A read-only workspace: the billing trigger refuses the sections.
select pg_temp.act_as_server();
select pg_temp.set_plan(pg_temp.id('org_a'), 'cabinet');
update public.billing_entitlements set starts_at = now() - interval '60 days', ends_at = now() - interval '8 days'
where organization_id = pg_temp.id('org_a') and scope = 'subscription' and revoked_at is null;
select pg_temp.act_as('owner');
select throws_ok($$select public.import_report_plan(pg_temp.id('r1'), '[{"title": "X", "level": 1}]')$$,
  'KR043', null, 'nothing is imported into a read-only workspace');

-- Readings of a PDF plan: who calls ---------------------------------------------------------
select pg_temp.act_as('owner');
select throws_ok($$select * from public.start_plan_import_call(pg_temp.id('w1'), pg_temp.id('r1'),
    pg_temp.id('owner'), 'mock', 'mock', 1, 1, 10)$$,
  '42501', null, 'users cannot start a reading themselves');
select throws_ok($$select public.finish_plan_import_call(gen_random_uuid(), pg_temp.id('w1'), 'succeeded',
    null, 1, 1, 1, 0, 1)$$,
  '42501', null, 'nor finish one');

select pg_temp.act_as_server();
select results_eq($$select refusal, retry_after from pg_temp.start()$$,
  $$values ('readOnly', null::integer)$$, 'a read-only workspace gets no reading');
update public.billing_entitlements set ends_at = now() + interval '20 days'
where organization_id = pg_temp.id('org_a') and scope = 'subscription' and revoked_at is null;

select results_eq($$select refusal from pg_temp.start('expert')$$, $$values ('forbidden')$$,
  'an expert gets no reading');
select results_eq($$select refusal from pg_temp.start('outsider')$$, $$values ('forbidden')$$,
  'nor someone outside the workspace');
select results_eq(
  $$select refusal from public.start_plan_import_call(pg_temp.id('w1'), pg_temp.id('r2'), pg_temp.id('owner'),
    'mock', 'mock', 1, 1, 10)$$,
  $$values ('forbidden')$$, 'a report of another workspace is refused');
update public.reports set status = 'final' where id = pg_temp.id('r1');
select results_eq($$select refusal from pg_temp.start()$$, $$values ('reportFinal')$$,
  'a final report gets no reading');
update public.reports set status = 'draft' where id = pg_temp.id('r1');

-- One AI draft of the month ---------------------------------------------------------------
insert into kept select 'first', call_id from pg_temp.start();
select isnt(pg_temp.kept_id('first'), null, 'the owner starts a reading');
select results_eq(
  $$select c.status, c.user_id, c.report_id, c.input_chars, c.pages from public.plan_import_calls c
    where c.id = pg_temp.kept_id('first')$$,
  $$values ('running'::text, pg_temp.id('owner'), pg_temp.id('r1'), 12000, 3)$$,
  'it is recorded as running');
select results_eq(
  $$select pool, status, workspace_id from public.billing_draft_usage where generation_id = pg_temp.kept_id('first')$$,
  $$values ('subscription'::text, 'reserved'::text, pg_temp.id('w1'))$$,
  'and reserves one AI draft of the month');
select is(
  public.finish_plan_import_call(pg_temp.kept_id('first'), pg_temp.id('w1'), 'succeeded', null, 12, 900, 400, 0.0125, 2300),
  true, 'it succeeds');
select results_eq(
  $$select status, items, total_tokens, cost_estimate, completed_at is not null from public.plan_import_calls
    where id = pg_temp.kept_id('first')$$,
  $$values ('succeeded'::text, 12, 1300, 0.012500::numeric(12, 6), true)$$,
  'with its usage and cost');
select is(pg_temp.usage(pg_temp.kept_id('first')), 'counted', 'its draft counts');
select is(
  public.finish_plan_import_call(pg_temp.kept_id('first'), pg_temp.id('w1'), 'failed', 'late', null, 0, 0, null, 0),
  false, 'a finished reading does not end twice');

insert into kept select 'failed', call_id from pg_temp.start('admin');
select is(
  public.finish_plan_import_call(pg_temp.kept_id('failed'), pg_temp.id('w2'), 'succeeded', null, 3, 1, 1, 0, 1),
  false, 'a reading is finished in its own workspace only');
select is(
  public.finish_plan_import_call(pg_temp.kept_id('failed'), pg_temp.id('w1'), 'failed', '', null, 500, 0, null, 900),
  true, 'an admin''s reading fails');
select results_eq($$select status, error_code from public.plan_import_calls where id = pg_temp.kept_id('failed')$$,
  $$values ('failed'::text, 'failed'::text)$$, 'with an error code');
select is(pg_temp.usage(pg_temp.kept_id('failed')), 'released', 'and gives its draft back');
select throws_ok(
  $$select public.finish_plan_import_call(pg_temp.kept_id('failed'), pg_temp.id('w1'), 'running', null, 0, 0, 0, 0, 0)$$,
  '22023', null, 'a reading ends as succeeded or failed');

-- A reading counts with the section drafts: Cabinet has 250 a month.
insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, usage_month, status, settled_at)
select gen_random_uuid(), pg_temp.id('org_a'), pg_temp.id('w1'), 'subscription',
  date_trunc('month', now() at time zone 'utc')::date, 'counted', now()
from generate_series(1, 249 - (
  select count(*)::int from public.billing_draft_usage
  where organization_id = pg_temp.id('org_a') and pool = 'subscription' and status <> 'released'
    and usage_month = date_trunc('month', now() at time zone 'utc')::date));
insert into kept select 'last', call_id from pg_temp.start();
select isnt(pg_temp.kept_id('last'), null, 'the 250th draft of the month is a reading');
select results_eq(
  $$select refusal, retry_after = ceil(extract(epoch from
      date_trunc('month', now() at time zone 'utc') at time zone 'utc' + interval '1 month' - now()))::integer
    from pg_temp.start()$$,
  $$values ('quotaExceeded', true)$$, 'the next reading is refused until the next month');
select is(
  (select count(*)::int from public.plan_import_calls where workspace_id = pg_temp.id('w1')),
  3, 'and nothing is recorded for it');
select is(
  (select refusal from public.start_ai_generation(pg_temp.id('w1'), pg_temp.id('s3'), pg_temp.id('expert'),
    pg_temp.id('p_global'), 'section_draft', 1::smallint, 'mock', 'mock', '{}', 1000, 1000, 1000000000, null)),
  'quotaExceeded', 'a section draft is refused too');

-- A request that died: after 10 minutes the reading is stale and its draft comes back.
update public.plan_import_calls set created_at = now() - interval '11 minutes' where id = pg_temp.kept_id('last');
update public.billing_draft_usage set created_at = now() - interval '11 minutes' where generation_id = pg_temp.kept_id('last');
insert into kept select 'after_stale', call_id from pg_temp.start();
select results_eq($$select status, error_code from public.plan_import_calls where id = pg_temp.kept_id('last')$$,
  $$values ('failed'::text, 'stale'::text)$$, 'a reading still running after 10 minutes is marked stale');
select is(pg_temp.usage(pg_temp.kept_id('last')), 'released', 'its draft is released');
select isnt(pg_temp.kept_id('after_stale'), null, 'so the next reading starts');

-- The hourly limit of a user ------------------------------------------------------------------
-- Three readings of the owner this hour, the oldest 11 minutes ago.
select results_eq(
  $$select refusal, retry_after from pg_temp.start('owner', 'r1', 3)$$,
  $$values ('rateLimited', 2940)$$, 'past the hourly limit, a reading waits for the oldest to leave the hour');

-- Nothing is reserved while billing is not enforced -------------------------------------------
update public.reports set status = 'draft' where id = pg_temp.id('r2');
update private.billing_settings set enforced = false;
insert into kept select 'off', call_id from pg_temp.start('outsider', 'r2');
update private.billing_settings set enforced = true;
select isnt(pg_temp.kept_id('off'), null, 'without enforcement, a reading starts');
select is((select count(*)::int from public.billing_draft_usage where generation_id = pg_temp.kept_id('off')),
  0, 'and reserves nothing');

-- Who reads the calls -----------------------------------------------------------------------
select pg_temp.act_as_server();
insert into public.plan_import_calls (workspace_id, report_id, user_id, provider, model, input_chars, pages)
values (pg_temp.id('w1'), pg_temp.id('r1'), pg_temp.id('expert'), 'mock', 'mock', 10, 1);
select pg_temp.act_as('owner');
select is((select count(*)::int from public.plan_import_calls), 5, 'owners read every call of their workspace');
select pg_temp.act_as('expert');
select is((select count(*)::int from public.plan_import_calls), 1, 'others read their own');
select pg_temp.act_as('outsider');
select is((select count(*)::int from public.plan_import_calls where workspace_id = pg_temp.id('w1')), 0,
  'nobody reads the calls of another workspace');
select throws_ok($$insert into public.plan_import_calls (workspace_id, user_id, provider, model, input_chars, pages)
    values (pg_temp.id('w2'), pg_temp.id('outsider'), 'mock', 'mock', 1, 1)$$,
  '42501', null, 'users cannot write a call');
select pg_temp.act_as('owner');
select throws_ok($$update public.plan_import_calls set cost_estimate = 0$$, '42501', null, 'nor change one');

select pg_temp.act_as('admin');
select results_eq(
  $$select model, calls, succeeded, failed, input_tokens, output_tokens, cost
    from public.plan_import_metrics(pg_temp.id('w1'), now() - interval '1 day')$$,
  $$values ('mock'::text, 5::bigint, 1::bigint, 2::bigint, 1400::bigint, 400::bigint, 0.012500::numeric)$$,
  'the dashboard sums the calls of the workspace per model');

-- The daily cost alert counts the readings --------------------------------------------------
select pg_temp.act_as_server();
delete from public.ai_cost_alerts where day = (now() at time zone 'utc')::date;
create temp table day_spend as
select
  coalesce((select sum(g.cost_estimate) from public.ai_generations g
            where g.created_at >= (now() at time zone 'utc')::date::timestamp at time zone 'utc'), 0)
  + coalesce((select sum(c.cost_estimate) from public.plan_import_calls c
              where c.created_at >= (now() at time zone 'utc')::date::timestamp at time zone 'utc'), 0) as spent;
select is(public.claim_ai_cost_alert((select spent from day_spend)), null, 'at the threshold, no alert');
update public.plan_import_calls set cost_estimate = 2.5 where id = pg_temp.kept_id('after_stale');
select is(public.claim_ai_cost_alert((select spent from day_spend)), (select spent from day_spend) + 2.5,
  'a reading''s cost passes the threshold');
select pg_temp.act_as('owner');
select throws_ok($$select public.claim_ai_cost_alert(0)$$, '42501', null, 'only the server claims the alert');

-- The ledger outlives the workspace ------------------------------------------------------------
select pg_temp.act_as_server();
delete from public.workspaces where id = pg_temp.id('w1');
select is(pg_temp.usage(pg_temp.kept_id('after_stale')), 'released',
  'a reading running when its workspace goes is released');
select is(pg_temp.usage(pg_temp.kept_id('first')), 'counted', 'a finished one still counts');

select * from finish();
rollback;
