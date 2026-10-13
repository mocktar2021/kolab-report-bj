begin;
\ir fixtures.psql
select plan(6);

select pg_temp.act_as('expert');
select is((select count(*)::int from public.profiles), 5, 'expert sees the five members of w1');
select is((select count(*)::int from public.profiles where id = pg_temp.id('outsider')), 0, 'expert cannot see a user from another tenant');
select is(pg_temp.affected($$update public.profiles set full_name = 'Moi' where id = pg_temp.id('expert')$$), 1, 'expert can edit their own profile');
select is(pg_temp.affected($$update public.profiles set full_name = 'Pirate' where id = pg_temp.id('admin')$$), 0, 'expert cannot edit another profile');

select pg_temp.act_as('stranger');
select results_eq('select id from public.profiles', array[pg_temp.id('stranger')], 'a user without workspace only sees themselves');

select pg_temp.act_as('outsider');
select is((select count(*)::int from public.profiles where id in (pg_temp.id('owner'), pg_temp.id('expert'))), 0, 'outsider cannot see tenant A users');

select * from finish();
rollback;
