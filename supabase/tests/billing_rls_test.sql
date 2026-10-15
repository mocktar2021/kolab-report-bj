begin;
\ir fixtures.psql
select plan(69);

-- Billing data is private to each organization (ADR 001, sections 3.5 and
-- 5.4). The organization owner and the owners and admins of its workspaces
-- read it; experts, viewers and outsiders see nothing; nobody signed in
-- writes it. Members read the state of their workspace through
-- workspace_billing_state, with no amount.

-- Billing is on in these tests, whatever the database says.
update private.billing_settings set enforced = true;

-- A pack for each organization, written as postgres like the server does.
insert into public.billing_ai_packs (organization_id, drafts, expires_at) values
  (pg_temp.id('org_a'), 100, now() + interval '12 months'),
  (pg_temp.id('org_b'), 100, now() + interval '12 months');

-- Open invitations of w1: one expert counts, a viewer and an expired one do not.
insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by, expires_at) values
  (pg_temp.id('w1'), 'nouvelle@cabinet-a.test', 'expert', repeat('1', 64), pg_temp.id('owner'), now() + interval '7 days'),
  (pg_temp.id('w1'), 'lectrice@cabinet-a.test', 'viewer', repeat('2', 64), pg_temp.id('owner'), now() + interval '7 days'),
  (pg_temp.id('w1'), 'ancienne@cabinet-a.test', 'expert', repeat('3', 64), pg_temp.id('owner'), now() - interval '1 day');

-- The fixtures' organizations got their row and a trial when they were created.
select is((select count(*)::int from public.organization_billing
           where organization_id in (pg_temp.id('org_a'), pg_temp.id('org_b'))),
  2, 'each organization has its billing row');
select is((select count(*)::int from public.billing_entitlements
           where organization_id in (pg_temp.id('org_a'), pg_temp.id('org_b')) and plan = 'trial'),
  2, 'and its trial');

-- Who reads and who pays ------------------------------------------------------
select pg_temp.act_as('owner');
select results_eq(
  $$select private.can_read_org_billing(pg_temp.id('org_a')), private.can_manage_org_billing(pg_temp.id('org_a'))$$,
  $$values (true, true)$$, 'the organization owner reads and manages its billing');
select pg_temp.act_as('admin');
select results_eq(
  $$select private.can_read_org_billing(pg_temp.id('org_a')), private.can_manage_org_billing(pg_temp.id('org_a'))$$,
  $$values (true, false)$$, 'an admin of one of its workspaces reads it but cannot buy');
select pg_temp.act_as('expert');
select results_eq(
  $$select private.can_read_org_billing(pg_temp.id('org_a')), private.can_manage_org_billing(pg_temp.id('org_a'))$$,
  $$values (false, false)$$, 'an expert neither reads nor manages it');
select pg_temp.act_as('viewer');
select results_eq(
  $$select private.can_read_org_billing(pg_temp.id('org_a')), private.can_manage_org_billing(pg_temp.id('org_a'))$$,
  $$values (false, false)$$, 'nor does a viewer');
select pg_temp.act_as('outsider');
select results_eq(
  $$select private.can_read_org_billing(pg_temp.id('org_a')), private.can_read_org_billing(pg_temp.id('org_b'))$$,
  $$values (false, true)$$, 'the outsider reads the billing of org_b only');
select pg_temp.act_as('stranger');
select results_eq(
  $$select private.can_read_org_billing(pg_temp.id('org_a')), private.can_manage_org_billing(pg_temp.id('org_a'))$$,
  $$values (false, false)$$, 'a user without workspace reads nothing');

-- Rows each person sees -------------------------------------------------------
select pg_temp.act_as('owner');
select results_eq('select organization_id from public.organization_billing', array[pg_temp.id('org_a')],
  'the owner reads the billing details of org_a only');
select results_eq('select organization_id from public.billing_entitlements', array[pg_temp.id('org_a')],
  'the owner reads the entitlements of org_a only');
select results_eq('select organization_id from public.billing_ai_packs', array[pg_temp.id('org_a')],
  'the owner reads the packs of org_a only');

select pg_temp.act_as('admin');
select results_eq('select organization_id from public.organization_billing', array[pg_temp.id('org_a')],
  'the admin reads the billing details of org_a');
select results_eq('select organization_id from public.billing_entitlements', array[pg_temp.id('org_a')],
  'the admin reads the entitlements of org_a');
select results_eq('select organization_id from public.billing_ai_packs', array[pg_temp.id('org_a')],
  'the admin reads the packs of org_a');

create or replace function pg_temp.billing_rows() returns integer
language sql as $$
  select (select count(*) from public.organization_billing)::int
       + (select count(*) from public.billing_entitlements)::int
       + (select count(*) from public.billing_ai_packs)::int
$$;
grant execute on function pg_temp.billing_rows() to authenticated;

select pg_temp.act_as('expert');
select is(pg_temp.billing_rows(), 0, 'an expert sees no billing row');
select pg_temp.act_as('expert2');
select is(pg_temp.billing_rows(), 0, 'nor does the second expert');
select pg_temp.act_as('viewer');
select is(pg_temp.billing_rows(), 0, 'nor does a viewer');
select pg_temp.act_as('stranger');
select is(pg_temp.billing_rows(), 0, 'nor does a user without workspace');

select pg_temp.act_as('outsider');
select results_eq('select organization_id from public.billing_entitlements', array[pg_temp.id('org_b')],
  'the outsider reads the entitlements of org_b only');
select results_eq('select organization_id from public.organization_billing', array[pg_temp.id('org_b')],
  'and the billing details of org_b only');

-- Nobody signed in writes, the organization owner included, except the
-- buyer columns of organization_billing (KRB-177, billing_page_test.sql) -------
select pg_temp.act_as('owner');
select throws_ok($$insert into public.organization_billing (organization_id) values (pg_temp.id('org_b'))$$,
  '42501', null, 'the owner cannot insert billing details');
select throws_ok($$update public.organization_billing set organization_id = pg_temp.id('org_b') where organization_id = pg_temp.id('org_a')$$,
  '42501', null, 'nor move them to another organization');
select throws_ok($$delete from public.organization_billing where organization_id = pg_temp.id('org_a')$$,
  '42501', null, 'nor delete them');
select throws_ok(
  $$insert into public.billing_entitlements (organization_id, scope, plan, source, starts_at, ends_at)
    values (pg_temp.id('org_a'), 'subscription', 'cabinet', 'manual', now() + interval '1 year', now() + interval '2 years')$$,
  '42501', null, 'the owner cannot grant an entitlement');
select throws_ok($$update public.billing_entitlements set ends_at = '2100-01-01' where organization_id = pg_temp.id('org_a')$$,
  '42501', null, 'nor extend one');
select throws_ok($$delete from public.billing_entitlements where organization_id = pg_temp.id('org_a')$$,
  '42501', null, 'nor delete one');
select throws_ok(
  $$insert into public.billing_ai_packs (organization_id, drafts, expires_at) values (pg_temp.id('org_a'), 1000, '2100-01-01')$$,
  '42501', null, 'the owner cannot add a pack');
select throws_ok($$update public.billing_ai_packs set drafts = 1000 where organization_id = pg_temp.id('org_a')$$,
  '42501', null, 'nor change one');
select throws_ok($$delete from public.billing_ai_packs where organization_id = pg_temp.id('org_a')$$,
  '42501', null, 'nor delete one');

select pg_temp.act_as('admin');
select throws_ok($$update public.workspaces set billing_mode = 'mission' where id = pg_temp.id('w1')$$,
  '42501', null, 'a manager cannot change the billing mode of a workspace');
select throws_ok(
  $$insert into public.workspaces (organization_id, name, created_by, billing_mode)
    values (pg_temp.id('org_a'), 'Mission gratuite', pg_temp.id('admin'), 'mission')$$,
  '42501', null, 'nor create a workspace with one');
select pg_temp.act_as('expert');
select results_eq($$select billing_mode from public.workspaces where id = pg_temp.id('w1')$$, array['subscription'],
  'members read the billing mode of their workspace');

select pg_temp.act_as('owner');
select throws_ok('select * from private.billing_settings', '42501', null, 'the billing settings are unreachable');
select throws_ok('select * from private.billing_trial_claims', '42501', null, 'the trial claims are unreachable');
select throws_ok('select * from private.billing_events', '42501', null, 'the billing audit log is unreachable');
select throws_ok($$select * from private.workspace_access(pg_temp.id('w1'))$$, '42501', null,
  'signed-in users cannot call workspace_access directly');

-- Privileges, one per check (has_table_privilege with a list is true when any one is held)
reset role;
select is(
  (select coalesce(array_agg(t || ' ' || p order by t, p), '{}')
   from unnest(array['public.organization_billing', 'public.billing_entitlements', 'public.billing_ai_packs']) t,
        unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
   where has_table_privilege('authenticated', t, p)),
  array['public.billing_ai_packs select', 'public.billing_entitlements select', 'public.organization_billing select'],
  'signed-in users only have select on the billing tables');
select is(
  (select coalesce(array_agg(t || ' ' || p order by t, p), '{}')
   from unnest(array['public.organization_billing', 'public.billing_entitlements', 'public.billing_ai_packs']) t,
        unnest(array['insert', 'update']) p
   where has_any_column_privilege('authenticated', t, p)),
  array['public.organization_billing update'],
  'and no insert or update on their columns, except the buyer columns of organization_billing');
select is(
  (select coalesce(array_agg(t || ' ' || p order by t, p), '{}')
   from unnest(array['public.organization_billing', 'public.billing_entitlements', 'public.billing_ai_packs']) t,
        unnest(array['select', 'insert', 'update', 'references']) p
   where has_any_column_privilege('anon', t, p)),
  '{}'::text[], 'signed-out visitors have no privilege on the billing tables');
select is(
  (select coalesce(array_agg(r || ' ' || t || ' ' || p order by r, t, p), '{}')
   from unnest(array['anon', 'authenticated', 'service_role']) r,
        unnest(array['private.billing_settings', 'private.billing_trial_claims', 'private.billing_events']) t,
        unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, t, p)),
  '{}'::text[], 'no API role has a privilege on the private billing tables');
select ok(
  not has_column_privilege('authenticated', 'public.workspaces', 'billing_mode', 'insert')
  and not has_column_privilege('authenticated', 'public.workspaces', 'billing_mode', 'update')
  and has_column_privilege('authenticated', 'public.workspaces', 'billing_mode', 'select'),
  'signed-in users read the billing mode and never write it');
select ok(
  has_column_privilege('authenticated', 'public.workspaces', 'name', 'insert')
  and has_column_privilege('authenticated', 'public.workspaces', 'organization_id', 'insert')
  and has_column_privilege('authenticated', 'public.workspaces', 'created_by', 'insert'),
  'they still insert the other columns of a workspace');
select is(
  (select coalesce(array_agg(f order by f), '{}')
   from unnest(array[
     'private.billing_enforced()', 'private.billing_trial_terms()', 'private.billing_lock_org(uuid)',
     'private.billing_access(uuid, uuid, timestamptz)', 'private.workspace_access(uuid, timestamptz)',
     'private.billing_usage(uuid, uuid)', 'private.billing_new_organization()']) f
   where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  '{}'::text[], 'nobody signed in calls the private billing helpers');
select lives_ok($$select private.billing_lock_org(pg_temp.id('org_a'))$$,
  'the server takes the billing lock of an organization');
select ok(exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted),
  'and holds it until the end of the transaction');
select ok(
  has_function_privilege('authenticated', 'public.workspace_billing_state(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.billing_overview(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.workspace_billing_state(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.billing_overview(uuid)', 'execute'),
  'signed-in users call workspace_billing_state and billing_overview, visitors do not');

-- workspace_billing_state: every member, no amount -------------------------------
select ok(
  pg_get_function_result('public.workspace_billing_state(uuid)'::regprocedure) !~* '(amount|price|xof|email|name)',
  'workspace_billing_state returns no amount, name or e-mail');

select pg_temp.act_as('owner');
select results_eq(
  $$select state, plan, max_members, max_reports, drafts_total, can_read_billing, can_manage_billing
    from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('trialing', 'trial', 5, 1, 20, true, true)$$, 'the owner reads the state of w1');
select pg_temp.act_as('admin');
select results_eq(
  $$select state, plan, max_members, max_reports, drafts_total, can_read_billing, can_manage_billing
    from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('trialing', 'trial', 5, 1, 20, true, false)$$, 'the admin reads it');
select pg_temp.act_as('expert');
select results_eq(
  $$select state, plan, max_members, max_reports, drafts_total, can_read_billing, can_manage_billing
    from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('trialing', 'trial', 5, 1, 20, false, false)$$, 'an expert reads it');
select pg_temp.act_as('viewer');
select results_eq(
  $$select state, plan, max_members, max_reports, drafts_total, can_read_billing, can_manage_billing
    from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('trialing', 'trial', 5, 1, 20, false, false)$$, 'a viewer reads it');
select pg_temp.act_as('outsider');
select is((select count(*)::int from public.workspace_billing_state(pg_temp.id('w1'))), 0,
  'the outsider gets nothing about w1');
select results_eq($$select state from public.workspace_billing_state(pg_temp.id('w2'))$$, array['trialing'],
  'but reads the state of w2');
select pg_temp.act_as('stranger');
select is((select count(*)::int from public.workspace_billing_state(pg_temp.id('w1'))), 0,
  'a user without workspace gets nothing');
select is((select count(*)::int from public.workspace_billing_state(gen_random_uuid())), 0,
  'nor does anyone for an unknown workspace');

-- billing_overview: billing readers, counts only -----------------------------------
create temp table overview (who text primary key, body jsonb);
grant all on overview to authenticated;

select pg_temp.act_as('owner');
insert into overview values ('owner', public.billing_overview(pg_temp.id('org_a')));
select is(
  (select body -> 'subscription' -> 'usage' from overview where who = 'owner'),
  '{"members": 4, "invitations": 1, "active_reports": 1, "workspaces": 1}'::jsonb,
  'the overview counts 4 members, 1 open invitation and 1 active report, viewers left out');
select is(
  (select body -> 'subscription' ->> 'state' from overview where who = 'owner'),
  'trialing', 'and shows the trial');
select is((select body -> 'packs' -> 0 ->> 'drafts' from overview where who = 'owner'), '100',
  'and the running pack');
select ok(
  (select body::text !~ '(@|Owner|Admin|Expert|Viewer|Cabinet)' from overview where who = 'owner'),
  'it holds no e-mail, no person''s name and no organization name (workspace names come for the pass picker)');

select pg_temp.act_as('admin');
select is((public.billing_overview(pg_temp.id('org_a')) ->> 'can_manage')::boolean, false,
  'the admin reads the overview, without the right to buy');
select pg_temp.act_as('expert');
select is(public.billing_overview(pg_temp.id('org_a')), null, 'an expert gets no overview');
select pg_temp.act_as('viewer');
select is(public.billing_overview(pg_temp.id('org_a')), null, 'nor does a viewer');
select pg_temp.act_as('outsider');
select is(public.billing_overview(pg_temp.id('org_a')), null, 'nor the outsider for org_a');
select pg_temp.act_as('stranger');
select is(public.billing_overview(pg_temp.id('org_a')), null, 'nor a user without workspace');

-- The owner of any workspace of the organization reads and pays -------------------
-- A mission workspace of org_a owned by expert2, where stranger is an expert.
-- It counts apart from the subscription.
reset role;
insert into public.workspaces (id, organization_id, name, created_by, billing_mode)
values ('00000000-0000-4000-c000-000000000003', pg_temp.id('org_a'), 'Mission A', pg_temp.id('expert2'), 'mission');
insert into public.workspace_members (workspace_id, user_id, role)
values ('00000000-0000-4000-c000-000000000003', pg_temp.id('stranger'), 'expert');
insert into public.billing_entitlements (organization_id, workspace_id, scope, plan, source, starts_at, ends_at,
  max_members, max_reports, drafts_total, amount_ht_xof)
values (pg_temp.id('org_a'), '00000000-0000-4000-c000-000000000003', 'mission', 'mission', 'manual',
  now(), now() + interval '90 days', 10, 1, 80, 39000);

select pg_temp.act_as('expert2');
select results_eq(
  $$select private.can_read_org_billing(pg_temp.id('org_a')), private.can_manage_org_billing(pg_temp.id('org_a'))$$,
  $$values (true, true)$$, 'the owner of another workspace of org_a reads and manages its billing');
select is(
  (public.billing_overview(pg_temp.id('org_a')) -> 'subscription' -> 'usage' ->> 'members')::int,
  4, 'people of a mission workspace do not count against the subscription');
select is(
  (select jsonb_build_object('workspace', p ->> 'workspace_id', 'state', p ->> 'state', 'usage', p -> 'usage')
   from jsonb_array_elements(public.billing_overview(pg_temp.id('org_a')) -> 'passes') p),
  jsonb_build_object('workspace', '00000000-0000-4000-c000-000000000003', 'state', 'active',
    'usage', '{"members": 2, "invitations": 0, "reports": 0}'::jsonb),
  'the pass of the mission workspace has its own usage');
select pg_temp.act_as('stranger');
select results_eq(
  $$select billing_mode, state, plan, max_members, drafts_total
    from public.workspace_billing_state('00000000-0000-4000-c000-000000000003')$$,
  $$values ('mission', 'active', 'mission', 10, 80)$$, 'its expert reads the state of the pass');
select is(pg_temp.billing_rows(), 0, 'and still no billing row');

select * from finish();
rollback;
