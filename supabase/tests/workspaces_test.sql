begin;
\ir fixtures.psql
select plan(11);

select pg_temp.act_as('expert');
select results_eq('select id from public.workspaces', array[pg_temp.id('w1')], 'expert sees only w1');
select is(pg_temp.affected($$update public.workspaces set name = 'X' where id = pg_temp.id('w1')$$), 0, 'expert cannot rename w1');
select throws_ok($$insert into public.workspaces (organization_id, name, created_by) values (pg_temp.id('org_a'), 'Etude X', pg_temp.id('expert'))$$,
  '42501', null, 'expert cannot create a workspace in org_a');

select pg_temp.act_as('viewer');
select is(pg_temp.affected($$delete from public.workspaces where id = pg_temp.id('w1')$$), 0, 'viewer cannot delete w1');

select pg_temp.act_as('admin');
select is(pg_temp.affected($$update public.workspaces set description = 'Mise a jour' where id = pg_temp.id('w1')$$), 1, 'admin can edit w1');
select is(pg_temp.affected($$delete from public.workspaces where id = pg_temp.id('w1')$$), 0, 'admin cannot delete w1');
select lives_ok($$insert into public.workspaces (organization_id, name, created_by) values (pg_temp.id('org_a'), 'Etude admin', pg_temp.id('admin'))$$,
  'admin of a workspace in org_a can create another one there');

select pg_temp.act_as('outsider');
select results_eq('select id from public.workspaces', array[pg_temp.id('w2')], 'outsider only sees w2');
select throws_ok($$insert into public.workspaces (organization_id, name, created_by) values (pg_temp.id('org_a'), 'Intrusion', pg_temp.id('outsider'))$$,
  '42501', null, 'outsider cannot create a workspace in org_a');

select pg_temp.act_as('stranger');
select is((select count(*)::int from public.workspaces), 0, 'a user without workspace sees none');

select pg_temp.act_as('owner');
select is(pg_temp.affected($$delete from public.workspaces where id = pg_temp.id('w1')$$), 1, 'owner can delete w1');

select * from finish();
rollback;
