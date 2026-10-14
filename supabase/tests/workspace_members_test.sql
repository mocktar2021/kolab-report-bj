begin;
\ir fixtures.psql
select plan(11);

select pg_temp.act_as('viewer');
select is((select count(*)::int from public.workspace_members where workspace_id = pg_temp.id('w1')), 5, 'members can read the w1 roster');
select throws_ok($$insert into public.workspace_members (workspace_id, user_id, role) values (pg_temp.id('w1'), pg_temp.id('stranger'), 'expert')$$,
  '42501', null, 'viewer cannot add members');

select pg_temp.act_as('expert');
select is(pg_temp.affected($$update public.workspace_members set role = 'admin' where user_id = pg_temp.id('expert')$$), 0, 'expert cannot promote themselves');
select is(pg_temp.affected($$delete from public.workspace_members where user_id = pg_temp.id('expert2')$$), 0, 'expert cannot remove another member');
select is(pg_temp.affected($$delete from public.workspace_members where user_id = pg_temp.id('expert')$$), 1, 'expert can leave the workspace');

select pg_temp.act_as('admin');
select throws_ok($$insert into public.workspace_members (workspace_id, user_id, role) values (pg_temp.id('w1'), pg_temp.id('stranger'), 'viewer')$$,
  '42501', null, 'admins add people through invitations only, never directly');

-- Joined through an invitation (the accept functions run as the table owner).
reset role;
insert into public.workspace_members (workspace_id, user_id, role) values (pg_temp.id('w1'), pg_temp.id('stranger'), 'viewer');
select pg_temp.act_as('admin');
select throws_ok($$update public.workspace_members set role = 'owner' where user_id = pg_temp.id('stranger')$$,
  '42501', null, 'admin cannot grant the owner role');
select is(pg_temp.affected($$update public.workspace_members set role = 'expert' where user_id = pg_temp.id('stranger')$$), 1, 'admin can change a role below owner');

select pg_temp.act_as('owner');
select lives_ok($$update public.workspace_members set role = 'owner' where user_id = pg_temp.id('admin')$$, 'owner can grant the owner role');

select pg_temp.act_as('outsider');
select is((select count(*)::int from public.workspace_members where workspace_id = pg_temp.id('w1')), 0, 'outsider cannot read the w1 roster');
select throws_ok($$insert into public.workspace_members (workspace_id, user_id, role) values (pg_temp.id('w1'), pg_temp.id('outsider'), 'owner')$$,
  '42501', null, 'outsider cannot join w1 on their own');

select * from finish();
rollback;
