begin;
\ir fixtures.psql
select plan(5);

-- s1 not_started (weight 1), s2 completed (weight 2), s3 in_progress (weight 1):
-- (0 + 2 + 0.5) / 4 = 62.5 %
select pg_temp.act_as('viewer');
select is((select completion_percent from public.report_progress where report_id = pg_temp.id('r1')), 62.5::numeric, 'weighted completion is 62.5 %');
select is((select total_sections from public.report_progress where report_id = pg_temp.id('r1')), 3::bigint, 'three sections are counted');

select pg_temp.act_as('expert');
select pg_temp.affected($$update public.report_sections set status = 'in_progress' where id = pg_temp.id('s1')$$);
select is((select completion_percent from public.report_progress where report_id = pg_temp.id('r1')), 75.0::numeric, 'progress follows section status');

select pg_temp.act_as('outsider');
select is((select count(*)::int from public.report_progress where report_id = pg_temp.id('r1')), 0, 'outsider cannot see w1 progress');
select is((select completion_percent from public.report_progress where report_id = pg_temp.id('r2')), 0::numeric, 'a report with nothing started is at 0 %');

select * from finish();
rollback;
