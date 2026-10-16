begin;
\ir fixtures.psql
select plan(13);

select pg_temp.act_as('expert');
select is((select count(*)::int from public.report_sections), 3, 'expert sees every section of w1');
select is(pg_temp.affected($$update public.report_sections set status = 'in_progress' where id = pg_temp.id('s1')$$),
  1, 'expert can update their assigned section');
select is(pg_temp.affected($$update public.report_sections set status = 'completed' where id = pg_temp.id('s2')$$), 0, 'expert cannot update a section assigned to someone else');
select is(pg_temp.affected($$update public.report_sections set status = 'completed' where id = pg_temp.id('s3')$$), 0, 'expert cannot update an unassigned section');
select throws_ok($$update public.report_sections set assigned_to = pg_temp.id('expert2') where id = pg_temp.id('s1')$$,
  '42501', null, 'expert cannot reassign their section');
select throws_ok($$update public.report_sections set weight = 10 where id = pg_temp.id('s1')$$,
  '42501', null, 'expert cannot change the weight of their section');
select throws_ok($$insert into public.report_sections (workspace_id, report_id, title) values (pg_temp.id('w1'), pg_temp.id('r1'), 'Nouvelle')$$,
  '42501', null, 'expert cannot add a section');

select pg_temp.act_as('viewer');
select is(pg_temp.affected($$update public.report_sections set status = 'completed' where id = pg_temp.id('s1')$$), 0, 'viewer cannot change a section');

select pg_temp.act_as('admin');
select is(pg_temp.affected($$update public.report_sections set assigned_to = pg_temp.id('expert'), weight = 3 where id = pg_temp.id('s3')$$),
  1, 'admin can assign and weight a section');
select throws_ok($$insert into public.report_sections (workspace_id, report_id, title) values (pg_temp.id('w1'), pg_temp.id('r2'), 'Melange')$$,
  '23503', null, 'a section cannot point to a report from another workspace');

select pg_temp.act_as('owner');
select is((select completed_at is not null from public.report_sections where id = pg_temp.id('s2')), true, 'completed sections get completed_at');
select lives_ok($$select public.delete_report_section(pg_temp.id('s3'))$$, 'owner can delete a section');

select pg_temp.act_as('outsider');
select is((select count(*)::int from public.report_sections where workspace_id = pg_temp.id('w1')), 0, 'outsider cannot see w1 sections');

select * from finish();
rollback;
