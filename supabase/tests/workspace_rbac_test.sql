begin;
\ir fixtures.psql
select plan(42);

-- create_workspace_with_owner -------------------------------------------------
select pg_temp.act_as('stranger');
select is((select count(*)::int from public.create_workspace_with_owner('  Cabinet Énergie & Associés  ', '  Etude climat  ', '  Rapport climat  ')),
  1, 'create_workspace_with_owner returns one row');
select is((select array[o.name, w.name, r.title] from public.organizations o
           join public.workspaces w on w.organization_id = o.id
           join public.reports r on r.workspace_id = w.id
           where w.name = 'Etude climat'),
  array['Cabinet Énergie & Associés', 'Etude climat', 'Rapport climat'], 'names are trimmed');
select is((select m.role::text from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
           where w.name = 'Etude climat' and m.user_id = pg_temp.id('stranger')),
  'owner', 'the creator owns the new workspace');
select is((select o.owner_id from public.organizations o join public.workspaces w on w.organization_id = o.id where w.name = 'Etude climat'),
  pg_temp.id('stranger'), 'the creator owns the new organization');
select is((select count(*)::int from public.reports r join public.workspaces w on w.id = r.workspace_id
           where w.name = 'Etude climat' and r.title = 'Rapport climat'),
  1, 'the first report is in the new workspace');
select is((select o.slug from public.organizations o join public.workspaces w on w.organization_id = o.id where w.name = 'Etude climat'),
  'cabinet-energie-associes', 'the organization slug comes from its name');

select pg_temp.act_as('outsider');
select lives_ok($$select public.create_workspace_with_owner('Cabinet Énergie & Associés', 'Etude bis', 'Rapport bis')$$,
  'another user can reuse an organization name');
select matches((select o.slug from public.organizations o join public.workspaces w on w.organization_id = o.id where w.name = 'Etude bis'),
  '^cabinet-energie-associes-[0-9a-f]{6}$', 'a slug already in use gets a random suffix');

select pg_temp.act_as('stranger');
select throws_ok($$select public.create_workspace_with_owner(' a ', 'Etude courte', 'Rapport court')$$,
  '22023', null, 'a name shorter than 2 characters once trimmed is rejected');
select lives_ok($$select public.create_workspace_with_owner(E'\tCabinet Tab\n', E'\n Etude tab\t', 'Rapport tab')$$,
  'names with tabs and line breaks are accepted');
select is((select o.name from public.organizations o where o.slug = 'cabinet-tab'),
  'Cabinet Tab', 'tabs and line breaks are trimmed too');

select pg_temp.act_as_anon();
select throws_ok($$select public.create_workspace_with_owner('Cabinet Anonyme', 'Etude anonyme', 'Rapport anonyme')$$,
  '42501', 'permission denied for function create_workspace_with_owner', 'anon cannot call create_workspace_with_owner');

-- Nothing is left behind when the call fails, either on validation or on the
-- last insert. The temporary check forces the report insert itself to fail.
select pg_temp.act_as('stranger');
select throws_ok($$select public.create_workspace_with_owner('Cabinet Atomique', 'Etude atomique', 'x')$$,
  '22023', null, 'a report title that is too short is rejected');
reset role;
select is((select count(*)::int from public.organizations where name = 'Cabinet Atomique')
        + (select count(*)::int from public.workspaces where name = 'Etude atomique'),
  0, 'a rejected report title leaves no organization or workspace');

alter table public.reports add constraint rbac_test_refused_title check (title <> 'Rapport refuse');
select pg_temp.act_as('stranger');
select throws_ok($$select public.create_workspace_with_owner('Cabinet Rollback', 'Etude rollback', 'Rapport refuse')$$,
  '23514', null, 'a failing report insert fails the whole call');
reset role;
select is((select count(*)::int from public.organizations where name = 'Cabinet Rollback')
        + (select count(*)::int from public.workspaces where name = 'Etude rollback'),
  0, 'a failing report insert rolls back the organization and workspace');
alter table public.reports drop constraint rbac_test_refused_title;

-- Memberships only change role ------------------------------------------------
select pg_temp.act_as('owner');
select throws_ok($$update public.workspace_members set workspace_id = pg_temp.id('w2') where user_id = pg_temp.id('expert')$$,
  '42501', 'permission denied for table workspace_members', 'owner cannot move a membership to another workspace');
select throws_ok($$update public.workspace_members set user_id = pg_temp.id('stranger') where user_id = pg_temp.id('expert')$$,
  '42501', 'permission denied for table workspace_members', 'owner cannot hand a membership to another user');

-- Expert guard still applies to direct updates -------------------------------
select pg_temp.act_as('expert');
select throws_ok($$update public.report_sections set title = 'Nouveau titre' where id = pg_temp.id('s1')$$,
  '42501', null, 'expert still cannot rename their section');
select is(pg_temp.affected($$update public.report_sections set status = 'in_progress' where id = pg_temp.id('s1')$$),
  1, 'expert can still update their section');

-- Section assignees -----------------------------------------------------------
select pg_temp.act_as('owner');
select throws_ok($$update public.report_sections set assigned_to = pg_temp.id('outsider') where id = pg_temp.id('s3')$$,
  'KR002', null, 'a section cannot go to someone outside the workspace');
select throws_ok($$update public.report_sections set assigned_to = pg_temp.id('viewer') where id = pg_temp.id('s3')$$,
  'KR002', null, 'a section cannot go to a viewer');
select throws_ok($$insert into public.report_sections (workspace_id, report_id, title, assigned_to) values (pg_temp.id('w1'), pg_temp.id('r1'), 'Nouvelle', pg_temp.id('stranger'))$$,
  'KR002', null, 'a new section cannot go to someone outside the workspace');

-- A section assigned before the rule existed can still be saved as long as
-- its assignee does not change.
reset role;
alter table public.report_sections disable trigger check_assignee;
update public.report_sections set assigned_to = pg_temp.id('viewer') where id = pg_temp.id('s3');
alter table public.report_sections enable trigger check_assignee;
select pg_temp.act_as('owner');
select is(pg_temp.affected($$update public.report_sections set assigned_to = assigned_to, status = 'in_progress' where id = pg_temp.id('s3')$$),
  1, 'resending an unchanged assignee does not hit the assignee check');

select pg_temp.act_as('admin');
select is(pg_temp.affected($$update public.report_sections set assigned_to = pg_temp.id('expert2') where id = pg_temp.id('s3')$$),
  1, 'a section can go to an expert');
select is(pg_temp.affected($$update public.report_sections set assigned_to = pg_temp.id('admin') where id = pg_temp.id('s3')$$),
  1, 'a section can go to an admin');

-- Admins never touch owners ---------------------------------------------------
select is(pg_temp.affected($$update public.workspace_members set role = 'expert' where user_id = pg_temp.id('owner')$$),
  0, 'admin cannot change the owner role');
select is(pg_temp.affected($$delete from public.workspace_members where user_id = pg_temp.id('owner')$$),
  0, 'admin cannot remove the owner');
select throws_ok($$insert into public.workspace_members (workspace_id, user_id, role) values (pg_temp.id('w1'), pg_temp.id('owner'), 'viewer')
  on conflict (workspace_id, user_id) do update set role = excluded.role$$,
  '42501', null, 'admin cannot change the owner role through an upsert');
select is(pg_temp.affected($$update public.workspace_members set role = 'admin' where user_id = pg_temp.id('expert2')$$),
  1, 'admin can promote an expert to admin');
select is((select assigned_to from public.report_sections where id = pg_temp.id('s2')),
  pg_temp.id('expert2'), 'a promoted member keeps their sections');
select is(pg_temp.affected($$update public.workspace_members set role = 'viewer' where user_id = pg_temp.id('expert2')$$),
  1, 'admin can make another admin a viewer');
select is((select assigned_to from public.report_sections where id = pg_temp.id('s2')),
  null::uuid, 'a member who becomes a viewer loses their sections');
select is(pg_temp.affected($$delete from public.workspace_members where user_id = pg_temp.id('viewer')$$),
  1, 'admin can remove a viewer');

-- Leaving the workspace -------------------------------------------------------
select pg_temp.act_as('expert');
select is(pg_temp.affected($$delete from public.workspace_members where user_id = pg_temp.id('expert')$$),
  1, 'expert can leave the workspace');
select pg_temp.act_as('owner');
select is((select assigned_to from public.report_sections where id = pg_temp.id('s1')),
  null::uuid, 'a member who leaves loses their sections');

-- Last owner ------------------------------------------------------------------
select throws_ok($$update public.workspace_members set role = 'admin' where user_id = pg_temp.id('owner')$$,
  'KR001', null, 'the last owner cannot step down');
select throws_ok($$delete from public.workspace_members where user_id = pg_temp.id('owner')$$,
  'KR001', null, 'the last owner cannot leave');
select lives_ok($$update public.workspace_members set role = 'owner' where user_id = pg_temp.id('admin')$$,
  'owner can make the admin a second owner');
select lives_ok($$update public.workspace_members set role = 'admin' where user_id = pg_temp.id('owner')$$,
  'an owner can step down when another owner remains');
select results_eq($$select user_id from public.workspace_members where workspace_id = pg_temp.id('w1') and role = 'owner'$$,
  array[pg_temp.id('admin')], 'the other owner remains');

-- The admin user is now the only owner of w1. Deleting the workspace
-- cascades to that membership and must not hit the last owner guard.
select pg_temp.act_as('admin');
select lives_ok($$select public.delete_workspace(pg_temp.id('w1'), 'Etude A')$$,
  'the last owner can still delete the workspace');

select * from finish();
rollback;
