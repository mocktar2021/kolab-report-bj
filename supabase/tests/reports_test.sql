begin;
\ir fixtures.psql
select plan(8);

select pg_temp.act_as('viewer');
select results_eq('select id from public.reports', array[pg_temp.id('r1')], 'viewer sees the w1 report');
select is(pg_temp.affected($$update public.reports set title = 'X' where id = pg_temp.id('r1')$$), 0, 'viewer cannot edit a report');

select pg_temp.act_as('expert');
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport expert')$$,
  '42501', null, 'expert cannot create a report');
select is(pg_temp.affected($$delete from public.reports where id = pg_temp.id('r1')$$), 0, 'expert cannot delete a report');

select pg_temp.act_as('admin');
-- created_by comes from the column default (auth.uid()), KRB-152 F-15.
select lives_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport admin')$$,
  'admin can create a report');
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w2'), 'Rapport chez B')$$,
  '42501', null, 'admin of w1 cannot create a report in w2');

select pg_temp.act_as('outsider');
select results_eq('select id from public.reports', array[pg_temp.id('r2')], 'outsider only sees the w2 report');
select is(pg_temp.affected($$update public.reports set title = 'X' where id = pg_temp.id('r1')$$), 0, 'outsider cannot edit a w1 report');

select * from finish();
rollback;
