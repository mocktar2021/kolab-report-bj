begin;
\ir fixtures.psql
select plan(8);

select pg_temp.act_as('expert');
select set_eq('select id from public.prompt_library', array[pg_temp.id('p_global'), pg_temp.id('p_w1')], 'expert sees global and w1 templates');
select throws_ok($$insert into public.prompt_library (workspace_id, title, template) values (pg_temp.id('w1'), 'Expert', 'x')$$,
  '42501', null, 'expert cannot add a template');

select pg_temp.act_as('admin');
select lives_ok($$insert into public.prompt_library (workspace_id, title, template) values (pg_temp.id('w1'), 'Admin', 'x')$$, 'admin can add a w1 template');
select throws_ok($$insert into public.prompt_library (workspace_id, title, template) values (null, 'Global pirate', 'x')$$,
  '42501', null, 'admin cannot add a global template');
select is(pg_temp.affected($$update public.prompt_library set template = 'pirate' where id = pg_temp.id('p_global')$$), 0, 'admin cannot edit a global template');
select is(pg_temp.affected($$update public.prompt_library set template = 'v2' where id = pg_temp.id('p_w1')$$), 1, 'admin can edit a w1 template');

select pg_temp.act_as('outsider');
select set_eq('select id from public.prompt_library', array[pg_temp.id('p_global'), pg_temp.id('p_w2')], 'outsider sees global and w2 templates');
select is(pg_temp.affected($$delete from public.prompt_library where id = pg_temp.id('p_w1')$$), 0, 'outsider cannot delete a w1 template');

select * from finish();
rollback;
