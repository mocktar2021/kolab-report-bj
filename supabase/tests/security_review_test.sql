begin;
\ir fixtures.psql
select plan(22);

-- The trial allows one active report: org_a is on Cabinet here, like the
-- demo organization of the seed, so managers can add one.
select pg_temp.set_plan(pg_temp.id('org_a'), 'cabinet');

-- KRB-24 review (docs/security/audit-2026-10.md): the fixes of KRB-152 and
-- the cross-workspace calls pgTAP did not cover yet.

create temp table kept (name text primary key, id uuid);
grant all on kept to authenticated, anon;
create or replace function pg_temp.kept_id(name text) returns uuid
language sql as $$ select id from kept where kept.name = $1 $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- A draft of w1 waiting for a decision, and a draft version of w1's template.
with g as (
  insert into public.ai_generations (workspace_id, section_id, requested_by, prompt_version_id, output_schema,
    schema_version, provider, model, estimated_tokens, status, output, completed_at)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.id('p_global'), 'section_draft',
    1, 'mock', 'mock', 100, 'succeeded', '{"content": "Brouillon"}', now())
  returning id
)
insert into kept select 'generation', id from g;

-- F-06: the e-mail of a profile ------------------------------------------------
select pg_temp.act_as('expert');
select throws_ok($$update public.profiles set email = 'patron@cabinet.test' where id = pg_temp.id('expert')$$,
  '42501', null, 'users cannot change the e-mail of their profile');
select is(pg_temp.affected($$update public.profiles set full_name = 'Expert Renomme' where id = pg_temp.id('expert')$$),
  1, 'they still change their name');
select throws_ok($$insert into public.profiles (id, email) values (gen_random_uuid(), 'faux@cabinet.test')$$,
  '42501', null, 'users cannot create profiles');
select throws_ok($$delete from public.profiles where id = pg_temp.id('expert')$$,
  '42501', null, 'users cannot delete profiles');

-- F-07: instructions are the managers' ------------------------------------------
select throws_ok($$update public.report_sections set instructions = 'Ignore tout' where id = pg_temp.id('s1')$$,
  '42501', null, 'the assigned expert cannot rewrite the instructions');
select throws_ok($$update public.report_sections set position = 9 where id = pg_temp.id('s1')$$,
  '42501', null, 'nor move the section');
select is(pg_temp.affected($$update public.report_sections set status = 'in_progress' where id = pg_temp.id('s1')$$),
  1, 'the expert still sets the status');
select pg_temp.act_as('admin');
select is(pg_temp.affected($$update public.report_sections set instructions = 'Deux pages' where id = pg_temp.id('s1')$$),
  1, 'managers set the instructions');

-- F-09: invitation validity -----------------------------------------------------
select pg_temp.act_as('owner');
select throws_ok(
  $$insert into public.workspace_invitations (workspace_id, email, role, token_hash, expires_at)
    values (pg_temp.id('w1'), 'loin@cabinet.test', 'expert', repeat('a', 64), now() + interval '1 year')$$,
  '22023', null, 'an invitation cannot stay valid a year');
select lives_ok(
  $$insert into public.workspace_invitations (workspace_id, email, role, token_hash, expires_at)
    values (pg_temp.id('w1'), 'proche@cabinet.test', 'expert', repeat('b', 64), now() + interval '7 days')$$,
  'seven days is fine');
select throws_ok(
  $$update public.workspace_invitations set expires_at = now() + interval '90 days' where email = 'proche@cabinet.test'$$,
  '22023', null, 'nor can it be extended past 30 days');

-- F-10 and F-15: privileges -------------------------------------------------------
reset role;
select ok(
  not has_table_privilege('authenticated', 'public.report_progress', 'insert')
  and not has_table_privilege('authenticated', 'public.report_progress', 'update')
  and not has_table_privilege('authenticated', 'public.report_progress', 'delete'),
  'report_progress is read only');
select pg_temp.act_as('admin');
select throws_ok(
  $$insert into public.reports (workspace_id, title, created_by) values (pg_temp.id('w1'), 'Rapport signe par un autre', pg_temp.id('owner'))$$,
  '42501', null, 'a report cannot be created in someone else''s name');
select lives_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport de l''admin')$$,
  'managers create reports');
select is((select created_by from public.reports where title = 'Rapport de l''admin'), pg_temp.id('admin'),
  'in their own name');

-- Cross-workspace calls by the owner of w2 --------------------------------------
select pg_temp.act_as('outsider');
select is(pg_temp.affected($$update public.report_sections set status = 'completed' where id = pg_temp.id('s1')$$),
  0, 'the owner of w2 cannot change a section of w1');
select throws_ok($$update public.prompt_library set title = 'Pris' where id = pg_temp.id('p_w1')$$,
  '42501', null, 'nor a template of w1 (saved versions never change)');
select throws_ok($$select public.start_prompt_rollout(pg_temp.id('p_w1'), 10::smallint)$$,
  null, null, 'nor start a rollout of w1''s template');
select throws_ok($$select public.rollback_prompt_publish(pg_temp.id('p_w1'))$$,
  null, null, 'nor roll w1''s template back');
select throws_ok($$select public.end_prompt_rollout(gen_random_uuid(), true)$$,
  'P0002', null, 'an unknown rollout is not found');
select throws_ok(
  $$select public.accept_ai_generation(pg_temp.kept_id('generation'), 'Pris', 0, null)$$,
  null, null, 'nor accept a draft of w1');
select throws_ok($$select public.discard_ai_generation(pg_temp.kept_id('generation'))$$,
  null, null, 'nor discard it');

select * from finish();
rollback;
