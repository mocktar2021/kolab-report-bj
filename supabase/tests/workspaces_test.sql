begin;
\ir fixtures.psql
select plan(42);

select pg_temp.act_as('expert');
select results_eq('select id from public.workspaces', array[pg_temp.id('w1')], 'expert sees only w1');
select is(pg_temp.affected($$update public.workspaces set name = 'X' where id = pg_temp.id('w1')$$), 0, 'expert cannot rename w1');
select throws_ok($$insert into public.workspaces (organization_id, name, created_by) values (pg_temp.id('org_a'), 'Etude X', pg_temp.id('expert'))$$,
  '42501', null, 'expert cannot create a workspace in org_a');

select pg_temp.act_as('viewer');
select throws_ok($$select public.delete_workspace(pg_temp.id('w1'), 'Etude A')$$, '42501', null, 'viewer cannot delete w1');

select pg_temp.act_as('admin');
select is(pg_temp.affected($$update public.workspaces set description = 'Mise a jour' where id = pg_temp.id('w1')$$), 1, 'admin can edit w1');
select throws_ok($$select public.delete_workspace(pg_temp.id('w1'), 'Etude A')$$, '42501', null, 'admin cannot delete w1');
select lives_ok($$insert into public.workspaces (organization_id, name, created_by) values (pg_temp.id('org_a'), 'Etude admin', pg_temp.id('admin'))$$,
  'admin of a workspace in org_a can create another one there');

select pg_temp.act_as('outsider');
select results_eq('select id from public.workspaces', array[pg_temp.id('w2')], 'outsider only sees w2');
-- KRB-24: moving w2 into org_a would make the outsider a member of org_a.
select throws_ok($$update public.workspaces set organization_id = pg_temp.id('org_a') where id = pg_temp.id('w2')$$,
  '42501', null, 'the owner of w2 cannot move it into another organization');
select is((select count(*)::int from public.organizations where id = pg_temp.id('org_a')), 0,
  'so org_a stays hidden from the outsider');
select throws_ok($$update public.organizations set owner_id = pg_temp.id('stranger') where id = pg_temp.id('org_b')$$,
  '42501', null, 'an organization owner changes only its name and slug');
select throws_ok($$insert into public.workspaces (organization_id, name, created_by) values (pg_temp.id('org_a'), 'Intrusion', pg_temp.id('outsider'))$$,
  '42501', null, 'outsider cannot create a workspace in org_a');

select pg_temp.act_as('stranger');
select is((select count(*)::int from public.workspaces), 0, 'a user without workspace sees none');

-- KRB-175: a workspace inside an existing organization -----------------------
-- org_c belongs to the stranger and has no workspace yet. The admin of w1 is
-- also an admin of w2, and expert2 (an expert in w1) owns w2 with the outsider.
-- Each new workspace comes with a report, more than the trial's one active
-- report: org_a and org_b are on Cabinet, like the demo organization of the
-- seed. org_c starts the stranger's trial.
select pg_temp.act_as_server();
select pg_temp.set_plan(pg_temp.id('org_a'), 'cabinet');
select pg_temp.set_plan(pg_temp.id('org_b'), 'cabinet');
insert into public.organizations (id, name, slug, owner_id)
  values ('00000000-0000-4000-b000-000000000003', 'Cabinet C', 'cabinet-c', pg_temp.id('stranger'));
insert into public.workspace_members (workspace_id, user_id, role) values
  (pg_temp.id('w2'), pg_temp.id('admin'), 'admin'),
  (pg_temp.id('w2'), pg_temp.id('expert2'), 'owner');
-- The seed and earlier runs may hold other organizations: compare with this count.
create temp table organizations_before as select count(*)::int as n from public.organizations;

-- my_manageable_organizations
select pg_temp.act_as('owner');
select results_eq('select id from public.my_manageable_organizations()', array[pg_temp.id('org_a')],
  'the owner of org_a can add a workspace to it');
select pg_temp.act_as('admin');
select results_eq('select name from public.my_manageable_organizations()', array['Cabinet A', 'Cabinet B'],
  'an admin of a workspace in each organization gets both, sorted by name');
select pg_temp.act_as('expert2');
select results_eq('select id from public.my_manageable_organizations()', array[pg_temp.id('org_b')],
  'an owner of w2 gets org_b, not org_a where they are an expert');
select pg_temp.act_as('expert');
select is_empty('select * from public.my_manageable_organizations()', 'an expert gets no organization');
select pg_temp.act_as('viewer');
select is_empty('select * from public.my_manageable_organizations()', 'a viewer gets no organization');
select pg_temp.act_as('stranger');
select results_eq('select id from public.my_manageable_organizations()',
  array['00000000-0000-4000-b000-000000000003'::uuid],
  'an organization owner gets it before it has any workspace');
select pg_temp.act_as_anon();
select throws_ok('select * from public.my_manageable_organizations()',
  '42501', 'permission denied for function my_manageable_organizations', 'anon cannot call my_manageable_organizations');

-- create_workspace_in_organization: who can
select pg_temp.act_as('owner');
select results_eq(
  $$select organization_id from public.create_workspace_in_organization(pg_temp.id('org_a'), '  Etude interne  ', E'\tRapport interne\n')$$,
  array[pg_temp.id('org_a')], 'the owner of org_a adds a workspace to it');
select is((select array[w.organization_id::text, w.name, r.title, r.created_by::text]
           from public.workspaces w join public.reports r on r.workspace_id = w.id
           where w.name = 'Etude interne'),
  array[pg_temp.id('org_a')::text, 'Etude interne', 'Rapport interne', pg_temp.id('owner')::text],
  'the workspace and its first report land in org_a, names trimmed');
select results_eq($$select m.user_id, m.role::text from public.workspace_members m
                    join public.workspaces w on w.id = m.workspace_id where w.name = 'Etude interne'$$,
  $$values (pg_temp.id('owner'), 'owner')$$, 'the creator is the only member, as owner');

select pg_temp.act_as('admin');
select lives_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), 'Etude de l''admin', 'Rapport de l''admin')$$,
  'an admin of w1 adds a workspace to org_a');
select is((select m.role::text from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
           where w.name = 'Etude de l''admin' and m.user_id = pg_temp.id('admin')),
  'owner', 'the admin owns the workspace they added');

select pg_temp.act_as('expert2');
select lives_ok($$select public.create_workspace_in_organization(pg_temp.id('org_b'), 'Etude B bis', 'Rapport B bis')$$,
  'an owner of w2 adds a workspace to org_b');

select pg_temp.act_as('stranger');
select lives_ok($$select public.create_workspace_in_organization('00000000-0000-4000-b000-000000000003', 'Etude C', 'Rapport C')$$,
  'the owner of an organization without workspace adds one');

-- create_workspace_in_organization: who cannot
select pg_temp.act_as('expert2');
select throws_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), 'Etude refusee', 'Rapport refuse')$$,
  '42501', null, 'an owner of w2 cannot add a workspace to org_a, where they are an expert');
select pg_temp.act_as('expert');
select throws_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), 'Etude refusee', 'Rapport refuse')$$,
  '42501', null, 'an expert cannot add a workspace to org_a');
select pg_temp.act_as('viewer');
select throws_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), 'Etude refusee', 'Rapport refuse')$$,
  '42501', null, 'a viewer cannot add a workspace to org_a');
select pg_temp.act_as('outsider');
select throws_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), 'Etude refusee', 'Rapport refuse')$$,
  '42501', null, 'the outsider cannot add a workspace to org_a');
select throws_ok($$select public.create_workspace_in_organization(gen_random_uuid(), 'Etude refusee', 'Rapport refuse')$$,
  '42501', null, 'an unknown organization is refused like a foreign one');
select throws_ok($$select public.create_workspace_in_organization(null, 'Etude refusee', 'Rapport refuse')$$,
  '42501', null, 'a missing organization is refused');
select pg_temp.act_as_anon();
select throws_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), 'Etude refusee', 'Rapport refuse')$$,
  '42501', 'permission denied for function create_workspace_in_organization', 'anon cannot call create_workspace_in_organization');

-- create_workspace_in_organization: names
select pg_temp.act_as('owner');
select throws_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), ' a ', 'Rapport refuse')$$,
  '22023', null, 'a workspace name shorter than 2 characters once trimmed is refused');
select throws_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), repeat('x', 121), 'Rapport refuse')$$,
  '22023', null, 'a workspace name over 120 characters is refused');
select throws_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), 'Etude refusee', E'\n x \t')$$,
  '22023', null, 'a report title shorter than 2 characters once trimmed is refused');
select throws_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), 'Etude refusee', repeat('x', 201))$$,
  '22023', null, 'a report title over 200 characters is refused');

reset role;
select is((select count(*)::int from public.workspaces where name = 'Etude refusee'), 0, 'refused calls leave no workspace');
select is((select count(*)::int from public.organizations), (select n from organizations_before), 'adding workspaces creates no organization');

-- The members of w1 do not join the workspaces added next to it.
select pg_temp.act_as('expert');
select results_eq('select id from public.workspaces', array[pg_temp.id('w1')],
  'an expert of w1 still sees only w1');

select pg_temp.act_as('owner');
select lives_ok($$select public.delete_workspace(pg_temp.id('w1'), 'Etude A')$$, 'owner can delete w1');

select * from finish();
rollback;
