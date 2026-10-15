begin;
\ir fixtures.psql
select plan(75);

-- Limits on members, reports and custom templates (ADR 001, sections 3.4 and
-- 7). org_a goes from plan to plan; its state is read first, so read-only
-- refuses whatever the limits of the last entitlement say. Opening the
-- billing page, sending a reminder or paying are other stories.

update private.billing_settings set enforced = true;

-- The accept functions only trust a confirmed e-mail.
update auth.users set email_confirmed_at = now()
where id in (pg_temp.id('stranger'), pg_temp.id('outsider'));

create function pg_temp.token_hash(token text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(token, 'UTF8')), 'hex');
$$;

create temp table kept (name text primary key, id uuid);
grant all on kept to authenticated;
create function pg_temp.kept_id(name text) returns uuid
language sql as $$ select id from kept where kept.name = $1 $$;

-- Moves a report through its statuses, as the signed-in user.
create function pg_temp.move_report(report_title text, steps text[]) returns void
language plpgsql as $$
declare
  report uuid;
begin
  select r.id into report from public.reports r where r.title = report_title;
  for i in 1 .. array_length(steps, 1) - 1 loop
    perform public.transition_report_status(report, steps[i]::public.report_status, steps[i + 1]::public.report_status);
  end loop;
end;
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- org_a on Indépendant: 3 members, 3 active reports, no custom template.
-- w1 keeps two people with a seat, the owner and the admin, and its viewer.
-- w3 is a second workspace of the subscription, owned by the owner.
select pg_temp.act_as_server();
insert into kept values ('independant', pg_temp.set_plan(pg_temp.id('org_a'), 'independant'));
delete from public.workspace_members
where workspace_id = pg_temp.id('w1') and user_id in (pg_temp.id('expert'), pg_temp.id('expert2'));
insert into public.workspaces (id, organization_id, name, created_by)
values ('00000000-0000-4000-c000-000000000003', pg_temp.id('org_a'), 'Etude A2', pg_temp.id('owner'));
insert into kept values ('w3', '00000000-0000-4000-c000-000000000003');

-- Members: invitations ------------------------------------------------------------
select pg_temp.act_as('owner');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'trois@cabinet-a.test', 'expert', pg_temp.token_hash('tok-trois'))$$,
  'a third person with a seat fits on Indépendant');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'quatre@cabinet-a.test', 'expert', pg_temp.token_hash('tok-quatre'))$$,
  'KR040', null, 'the fourth is refused: open invitations count');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.kept_id('w3'), 'quatre@cabinet-a.test', 'admin', pg_temp.token_hash('tok-quatre'))$$,
  'KR040', null, 'in every workspace of the subscription');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'lecteur@cabinet-a.test', 'viewer', pg_temp.token_hash('tok-lecteur'))$$,
  'viewers are free');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.kept_id('w3'), 'trois@cabinet-a.test', 'expert', pg_temp.token_hash('tok-trois-w3'))$$,
  'the same person invited to a second workspace counts once');
select is(public.billing_overview(pg_temp.id('org_a')) -> 'subscription' -> 'usage',
  '{"members": 2, "invitations": 1, "active_reports": 1, "workspaces": 2}'::jsonb,
  'the usage meter counts the same way');
select is(pg_temp.affected($$update public.workspace_invitations set revoked_at = now() where email = 'trois@cabinet-a.test'$$),
  2, 'revoking both invitations of that person');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'quatre@cabinet-a.test', 'expert', pg_temp.token_hash('tok-quatre'))$$,
  'frees the seat');

select pg_temp.act_as_server();
update public.workspace_invitations set expires_at = now() - interval '1 day' where email = 'quatre@cabinet-a.test';
select pg_temp.act_as('owner');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'cinq@cabinet-a.test', 'expert', pg_temp.token_hash('tok-cinq'))$$,
  'an expired invitation frees its seat');
select throws_ok($$update public.workspace_invitations
  set token_hash = pg_temp.token_hash('tok-quatre-2'), expires_at = now() + interval '7 days'
  where email = 'quatre@cabinet-a.test'$$,
  'KR040', null, 'sending an expired invitation again takes a seat');
select is(pg_temp.affected($$update public.workspace_invitations
  set token_hash = pg_temp.token_hash('tok-cinq-2'), expires_at = now() + interval '7 days'
  where email = 'cinq@cabinet-a.test'$$),
  1, 'an open invitation sent again keeps the seat it holds');

-- Members: roles --------------------------------------------------------------------
select throws_ok($$update public.workspace_members set role = 'expert'
  where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('viewer')$$,
  'KR040', null, 'a viewer cannot become expert at the limit');
select is(pg_temp.affected($$update public.workspace_members set role = 'expert'
  where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('admin')$$),
  1, 'other role changes add nobody');
select is(pg_temp.affected($$update public.workspace_members set role = 'admin'
  where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('admin')$$),
  1, 'and can go back');
select is(pg_temp.affected($$update public.workspace_invitations set revoked_at = now() where email = 'cinq@cabinet-a.test'$$),
  1, 'revoking one invitation');
select is(pg_temp.affected($$update public.workspace_members set role = 'expert'
  where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('viewer')$$),
  1, 'lets the viewer become expert');

-- Members: acceptance after a downgrade -----------------------------------------------
-- Two experts invited on Cabinet, then org_a goes back to Indépendant: 3
-- members and 2 open invitations for 3 seats.
select pg_temp.act_as_server();
update kept set id = pg_temp.set_plan(pg_temp.id('org_a'), 'cabinet') where name = 'independant';
select pg_temp.act_as('owner');
insert into public.workspace_invitations (workspace_id, email, role, token_hash) values
  (pg_temp.id('w1'), 'stranger@kolabreport.test', 'expert', pg_temp.token_hash('tok-stranger')),
  (pg_temp.id('w1'), 'outsider@kolabreport.test', 'expert', pg_temp.token_hash('tok-outsider'));
select pg_temp.act_as_server();
update kept set id = pg_temp.set_plan(pg_temp.id('org_a'), 'independant') where name = 'independant';

select pg_temp.act_as('stranger');
select throws_ok($$select public.accept_workspace_invitation('tok-stranger')$$,
  'KR041', null, 'accepting past the limit is refused');
select pg_temp.act_as('outsider');
select is(public.accept_my_pending_invitations(), 0, 'signing in skips an invitation past the limit');
select pg_temp.act_as_server();
select is((select count(*)::int from public.workspace_invitations
           where email in ('stranger@kolabreport.test', 'outsider@kolabreport.test')
             and accepted_at is null and revoked_at is null),
  2, 'and both invitations stay open');

select pg_temp.act_as('owner');
select is(pg_temp.affected($$update public.workspace_members set role = 'viewer'
  where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('viewer')$$),
  1, 'making someone a viewer frees a seat');
select pg_temp.act_as('stranger');
select is(public.accept_workspace_invitation('tok-stranger'), pg_temp.id('w1'), 'and the invitee joins');
select pg_temp.act_as_server();
update public.workspace_invitations set role = 'viewer' where email = 'outsider@kolabreport.test';
select pg_temp.act_as('outsider');
select is(public.accept_my_pending_invitations(), 1, 'a viewer joins whatever the limit');

-- Reports ---------------------------------------------------------------------------
-- 'Rapport A' (r1) is the one active report so far.
select pg_temp.act_as('owner');
select lives_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport 2')$$,
  'a second active report fits');
select lives_ok($$insert into public.reports (workspace_id, title) values (pg_temp.kept_id('w3'), 'Rapport 3')$$,
  'a third, in another workspace');
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport 4')$$,
  'KR042', null, 'the fourth active report is refused, across the workspaces of the subscription');
select pg_temp.act_as('viewer');
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport 4')$$,
  '42501', null, 'people who cannot create reports get the usual refusal');

select pg_temp.act_as('owner');
select pg_temp.move_report('Rapport A', array['draft', 'in_review']);
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport 4')$$,
  'KR042', null, 'a report in review still counts');
select pg_temp.move_report('Rapport A', array['in_review', 'final']);
select lives_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport 4')$$,
  'a final report frees its slot');
select throws_ok($$select pg_temp.move_report('Rapport A', array['final', 'draft'])$$,
  'KR042', null, 'reopening is refused when no slot is free');
select lives_ok($$select public.delete_report((select id from public.reports where title = 'Rapport 4'))$$,
  'deleting a report');
select lives_ok($$select pg_temp.move_report('Rapport A', array['final', 'draft'])$$,
  'frees its slot for the reopened one');

-- A mission workspace counts apart: one report, whatever its status.
select pg_temp.act_as_server();
insert into public.workspaces (id, organization_id, name, created_by, billing_mode)
values ('00000000-0000-4000-c000-000000000004', pg_temp.id('org_a'), 'Mission A', pg_temp.id('owner'), 'mission');
insert into kept values ('wm', '00000000-0000-4000-c000-000000000004');
insert into public.billing_entitlements (organization_id, workspace_id, scope, plan, source, starts_at, ends_at,
  max_members, max_reports, drafts_total)
values (pg_temp.id('org_a'), pg_temp.kept_id('wm'), 'mission', 'mission', 'manual',
  now() - interval '1 day', now() + interval '89 days', 10, 1, 80);

select pg_temp.act_as('owner');
select lives_ok($$insert into public.reports (workspace_id, title) values (pg_temp.kept_id('wm'), 'Mission 1')$$,
  'a pass takes its report while the subscription is full');
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.kept_id('wm'), 'Mission 2')$$,
  'KR042', null, 'and only one');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.kept_id('wm'), 'six@cabinet-a.test', 'expert', pg_temp.token_hash('tok-six'))$$,
  'its members count apart from the subscription');
select pg_temp.move_report('Mission 1', array['draft', 'in_review', 'final']);
select lives_ok($$select pg_temp.move_report('Mission 1', array['final', 'draft'])$$,
  'reopening the report of a pass adds no report');

-- Custom templates --------------------------------------------------------------------
-- p_w1 is the published version 1 of modele-a, made before.
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'modele-neuf', 'Modele neuf', 'Texte')$$,
  'KR044', null, 'a new custom template is refused on Indépendant');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, status, changelog)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'Texte 2', 'draft', 'Nouvelle version')$$,
  'KR044', null, 'and so is a new version of one');
select is(pg_temp.affected($$update public.prompt_library set status = 'archived' where id = pg_temp.id('p_w1')$$),
  1, 'a template kept from an earlier plan can be archived');
select throws_ok($$update public.prompt_library set status = 'published' where id = pg_temp.id('p_w1')$$,
  'KR044', null, 'not published again');

select pg_temp.act_as_server();
update public.prompt_library set status = 'published' where id = pg_temp.id('p_w1');
with candidate as (
  insert into public.prompt_library (workspace_id, template_key, title, template, status, changelog)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'Texte 2', 'draft', 'Essai')
  returning id
)
insert into kept select 'candidate', id from candidate;

select pg_temp.act_as('owner');
select throws_ok($$select public.start_prompt_rollout(pg_temp.kept_id('candidate'), 50::smallint)$$,
  'KR044', null, 'nor rolled out');
select pg_temp.act_as('viewer');
select throws_ok($$select public.start_prompt_rollout(pg_temp.kept_id('candidate'), 50::smallint)$$,
  '42501', null, 'people who cannot manage templates get the usual refusal');
select pg_temp.act_as_server();
insert into kept values ('cabinet', pg_temp.set_plan(pg_temp.id('org_a'), 'cabinet'));
select pg_temp.act_as('owner');
select lives_ok($$select public.start_prompt_rollout(pg_temp.kept_id('candidate'), 50::smallint)$$,
  'on Cabinet, rollouts work');
select lives_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'modele-neuf', 'Modele neuf', 'Texte')$$,
  'and new templates');

-- Grace: the limits of the period that ended still apply ---------------------------------
select pg_temp.act_as_server();
update kept set id = pg_temp.set_plan(pg_temp.id('org_a'), 'independant') where name = 'independant';
update public.billing_entitlements set starts_at = now() - interval '40 days', ends_at = now() - interval '2 days'
where id = pg_temp.kept_id('independant');

select pg_temp.act_as('owner');
select results_eq($$select state, plan from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('grace', 'independant')$$, 'two days after the end, org_a is in grace');
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport 4')$$,
  'KR042', null, 'with the limits of Indépendant');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'lecteur2@cabinet-a.test', 'viewer', pg_temp.token_hash('tok-lecteur2'))$$,
  'and still writable');

-- Read-only: refused, whatever the limits say ---------------------------------------------
-- Cabinet would allow every change below, but it ended 8 days ago.
select pg_temp.move_report('Rapport 3', array['draft', 'in_review', 'final']);
select pg_temp.act_as_server();
update kept set id = pg_temp.set_plan(pg_temp.id('org_a'), 'cabinet') where name = 'cabinet';
update public.billing_entitlements set starts_at = now() - interval '40 days', ends_at = now() - interval '8 days'
where id = pg_temp.kept_id('cabinet');

select pg_temp.act_as('owner');
select results_eq(
  $$select state, plan, max_reports, max_members from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('read_only', 'cabinet', null::integer, 10)$$,
  'eight days after the end, org_a is read-only, with the limits of Cabinet still on the row');
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport 4')$$,
  'KR043', null, 'read-only refuses a report that Cabinet would allow');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'lecteur3@cabinet-a.test', 'viewer', pg_temp.token_hash('tok-lecteur3'))$$,
  'KR043', null, 'and every invitation, viewers included');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'sept@cabinet-a.test', 'expert', pg_temp.token_hash('tok-sept'))$$,
  'KR043', null, 'experts too');
select throws_ok($$update public.workspace_invitations
  set token_hash = pg_temp.token_hash('tok-lecteur-2'), expires_at = now() + interval '7 days'
  where email = 'lecteur@cabinet-a.test'$$,
  'KR043', null, 'no invitation is sent again');
select throws_ok($$update public.workspace_members set role = 'expert'
  where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('viewer')$$,
  'KR043', null, 'a viewer cannot become expert');
select throws_ok($$select pg_temp.move_report('Rapport 3', array['final', 'draft'])$$,
  'KR043', null, 'a final report cannot be reopened');
select throws_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), 'Etude refusee', 'Rapport refuse')$$,
  'KR043', null, 'no workspace is added');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'modele-autre', 'Modele autre', 'Texte')$$,
  'KR043', null, 'no template is written');
select throws_ok($$select public.start_prompt_rollout(pg_temp.kept_id('candidate'), 50::smallint)$$,
  'KR043', null, 'and no rollout started');
select is(pg_temp.affected($$update public.workspace_invitations set revoked_at = now() where email = 'lecteur@cabinet-a.test'$$),
  1, 'revoking an invitation still works');
select is(pg_temp.affected($$update public.workspace_members set role = 'viewer'
  where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('stranger')$$),
  1, 'so does making someone a viewer');
select is(pg_temp.affected($$delete from public.workspace_members
  where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('outsider')$$),
  1, 'and removing a member');
select pg_temp.act_as('outsider');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'huit@cabinet-a.test', 'viewer', pg_temp.token_hash('tok-huit'))$$,
  '42501', null, 'people from outside get the usual refusal, not the billing one');
select pg_temp.act_as_server();
select lives_ok($$insert into public.reports (workspace_id, title, created_by)
  values (pg_temp.id('w1'), 'Rapport serveur', pg_temp.id('owner'))$$,
  'writes of the server are not checked');

-- Revoking the current period falls back to the one before ------------------------------
-- Cabinet ended 3 days ago, Indépendant runs since then. Active reports:
-- Rapport A, Rapport 2 and Rapport serveur.
update public.billing_entitlements set starts_at = now() - interval '33 days', ends_at = now() - interval '3 days'
where id = pg_temp.kept_id('cabinet');
insert into public.billing_entitlements (id, organization_id, scope, plan, source, starts_at, ends_at,
  max_members, max_reports, drafts_per_month)
values ('00000000-0000-4000-8000-000000000001', pg_temp.id('org_a'), 'subscription', 'independant', 'purchase',
  now() - interval '3 days', now() + interval '27 days', 3, 3, 60);

select pg_temp.act_as('owner');
select results_eq($$select state, plan from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('active', 'independant')$$, 'a new Indépendant period runs');
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport 4')$$,
  'KR042', null, 'with its limits');
select pg_temp.act_as_server();
update public.billing_entitlements set revoked_at = now(), revoked_reason = 'Paiement remboursé'
where id = '00000000-0000-4000-8000-000000000001';
select pg_temp.act_as('owner');
select results_eq($$select state, plan, max_reports from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('grace', 'cabinet', null::integer)$$, 'revoking it falls back to Cabinet, still in its grace');
select lives_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport 4')$$,
  'with the limits of Cabinet');
select pg_temp.act_as_server();
update public.billing_entitlements set starts_at = now() - interval '38 days', ends_at = now() - interval '8 days'
where id = pg_temp.kept_id('cabinet');
select pg_temp.act_as('owner');
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport 5')$$,
  'KR043', null, 'and read-only once that grace is over');

-- An organization that never had an entitlement ---------------------------------------
-- The owner used their trial with org_a.
select lives_ok($$insert into kept
  select 'bis', workspace_id from public.create_workspace_with_owner('Cabinet A bis', 'Etude A bis', 'Rapport A bis')$$,
  'a second organization, with no trial, still gets its workspace and first report');
insert into kept select 'org_bis', organization_id from public.workspaces where id = pg_temp.kept_id('bis');
select results_eq($$select state, plan from public.workspace_billing_state(pg_temp.kept_id('bis'))$$,
  $$values ('read_only', null::text)$$, 'then it is read-only');
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.kept_id('bis'), 'Rapport A ter')$$,
  'KR043', null, 'a second report is refused');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.kept_id('bis'), 'neuf@cabinet-a.test', 'expert', pg_temp.token_hash('tok-neuf'))$$,
  'KR043', null, 'and so is an invitation');
select throws_ok($$select public.create_workspace_in_organization(pg_temp.kept_id('org_bis'), 'Etude A ter', 'Rapport A ter')$$,
  'KR043', null, 'and a second workspace');

-- Nothing is checked while billing is not enforced ---------------------------------------
select pg_temp.act_as_server();
update private.billing_settings set enforced = false;
select pg_temp.act_as('owner');
select lives_ok($$insert into public.reports (workspace_id, title) values (pg_temp.kept_id('bis'), 'Rapport A ter')$$,
  'without enforcement, a read-only organization takes reports');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.kept_id('bis'), 'neuf@cabinet-a.test', 'expert', pg_temp.token_hash('tok-neuf'))$$,
  'invitations');
select lives_ok($$select public.create_workspace_in_organization(pg_temp.id('org_a'), 'Etude A3', 'Rapport A3')$$,
  'and workspaces');

-- Privileges ------------------------------------------------------------------------------
select is(
  (select coalesce(array_agg(f order by f), '{}')
   from unnest(array[
     'private.assert_workspace_writable(uuid)', 'private.billing_first_report(uuid)',
     'private.billing_check_line_seat(uuid, uuid, text, boolean)', 'private.billing_check_seat(uuid, text, boolean)',
     'private.billing_check_report_slot(uuid, uuid)', 'private.billing_check_templates(uuid)',
     'private.billing_reserve_draft(uuid, uuid, uuid)', 'private.join_from_invitation(uuid, uuid)']) f
   where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  '{}'::text[], 'nobody signed in calls the billing checks');

select * from finish();
rollback;
