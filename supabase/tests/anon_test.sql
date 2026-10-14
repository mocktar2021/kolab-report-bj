begin;
\ir fixtures.psql
select plan(15);

select pg_temp.act_as_anon();
select throws_ok('select * from public.organizations', '42501', null, 'anon cannot read organizations');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok('select * from public.workspaces', '42501', null, 'anon cannot read workspaces');
select throws_ok('select * from public.workspace_members', '42501', null, 'anon cannot read workspace_members');
select throws_ok('select * from public.reports', '42501', null, 'anon cannot read reports');
select throws_ok('select * from public.report_sections', '42501', null, 'anon cannot read report_sections');
select throws_ok('select * from public.deliverables', '42501', null, 'anon cannot read deliverables');
select throws_ok('select * from public.prompt_library', '42501', null, 'anon cannot read prompt_library');
select throws_ok('select * from public.report_progress', '42501', null, 'anon cannot read report_progress');
select throws_ok('select * from public.ai_generations', '42501', null, 'anon cannot read ai_generations');
select throws_ok('select * from public.ai_generation_metrics', '42501', null, 'anon cannot read ai_generation_metrics');
select throws_ok('select * from public.prompt_rollouts', '42501', null, 'anon cannot read prompt_rollouts');
select throws_ok('select * from public.ai_cost_alerts', '42501', null, 'anon cannot read ai_cost_alerts');


-- Signed-in users keep the API privileges, but not TRUNCATE (it ignores RLS).
select pg_temp.act_as('owner');
select throws_ok('truncate public.reports', '42501', null, 'signed-in users cannot truncate a table');
-- One privilege per check: has_table_privilege with a list is true when any one is held.
select ok(has_table_privilege('authenticated', 'public.reports', 'select')
  and has_table_privilege('authenticated', 'public.reports', 'delete')
  and has_column_privilege('authenticated', 'public.reports', 'title', 'insert')
  and has_column_privilege('authenticated', 'public.reports', 'title', 'update'),
  'signed-in users keep select and delete, and insert and update on the columns they may write');

select * from finish();
rollback;
