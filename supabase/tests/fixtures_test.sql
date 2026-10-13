begin;
\ir fixtures.psql
select plan(4);

select is(
  (select count(*)::int from public.profiles where email like '%@kolabreport.test' and id::text like '00000000-0000-4000-a000-%'),
  7, 'a profile is created for each new user');
select is(
  (select role::text from public.workspace_members where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('owner')),
  'owner', 'the workspace creator becomes its owner');
select is((select count(*)::int from public.workspace_members where workspace_id = pg_temp.id('w1')), 5, 'w1 has five members');

select pg_temp.act_as('expert');
select is(auth.uid(), pg_temp.id('expert'), 'act_as sets auth.uid()');

select * from finish();
rollback;
