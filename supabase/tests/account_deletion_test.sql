begin;
\ir fixtures.psql
select plan(73);

-- Deleting one's own account (KRB-186). What blocks it, the organization
-- transfer, what the cleanup removes before the delete, and what stays with
-- the workspace and the organization afterwards.

create or replace function pg_temp.hash(email text) returns text
language sql immutable as $$ select encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') $$;

-- Signed in as a user created in this file, outside the fixtures.
create or replace function pg_temp.act_as_id(user_id uuid) returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Schema --------------------------------------------------------------------------
select results_eq(
  $$select c.relname::text collate "default", a.attname::text collate "default", a.attnotnull, con.confdeltype::text
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.conname in ('workspaces_created_by_fkey', 'reports_created_by_fkey', 'deliverables_uploaded_by_fkey',
                          'workspace_invitations_invited_by_fkey')
    order by 1$$,
  $$values ('deliverables', 'uploaded_by', false, 'n'), ('reports', 'created_by', false, 'n'),
           ('workspace_invitations', 'invited_by', false, 'n'), ('workspaces', 'created_by', false, 'n')$$,
  'creators, uploaders and inviters are nullable and set to null when their profile goes');
select results_eq(
  $$select con.conrelid::regclass::text, con.conname::text collate "default"
    from pg_constraint con
    where con.contype = 'f'
      and con.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
      and con.confdeltype not in ('c', 'n')$$,
  $$values ('organizations', 'organizations_owner_id_fkey')$$,
  'among the foreign keys to an account, only the organization owner blocks its deletion');

-- Privileges ----------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.prepare_account_deletion(uuid)', 'execute'),
  'signed-in users cannot run the cleanup themselves');
select ok(not has_function_privilege('anon', 'public.prepare_account_deletion(uuid)', 'execute'),
  'nor can visitors');
select ok(has_function_privilege('service_role', 'public.prepare_account_deletion(uuid)', 'execute'),
  'the server runs it with the service role');
select ok(not has_function_privilege('authenticated', 'private.account_deletion_blockers(uuid)', 'execute'),
  'nobody signed in reads the blockers of another account');
select ok(not has_function_privilege('anon', 'public.my_account_deletion_blockers()', 'execute')
  and not has_function_privilege('anon', 'public.transfer_organization(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.organization_transfer_candidates(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.my_account_sessions()', 'execute')
  and not has_function_privilege('anon', 'public.claim_account_deletion()', 'execute')
  and not has_function_privilege('anon', 'public.release_account_deletion()', 'execute'),
  'visitors run none of the account functions');
select ok(not has_table_privilege('authenticated', 'private.account_deletion_attempts', 'select')
  and not has_table_privilege('authenticated', 'private.account_deletion_attempts', 'insert')
  and not has_table_privilege('service_role', 'private.account_deletion_attempts', 'select'),
  'the deletion lock is reachable through its functions only');

-- What blocks a deletion ----------------------------------------------------------
select pg_temp.act_as('owner');
select results_eq(
  $$select kind, organization_id, workspace_id, other_members, successors
    from public.my_account_deletion_blockers()$$,
  $$values ('organization_owner', pg_temp.id('org_a'), null::uuid, null::integer, 0),
           ('only_owner', pg_temp.id('org_a'), pg_temp.id('w1'), 4, null::integer)$$,
  'owner owns org_a and is the only owner of w1, which has 4 other members');
select results_eq(
  $$select organization_name, workspace_name from public.my_account_deletion_blockers()$$,
  $$values ('Cabinet A', null::text), ('Cabinet A', 'Etude A')$$,
  'the blockers carry the names the account page shows');

select pg_temp.act_as('outsider');
select results_eq(
  $$select kind, organization_id, workspace_id, other_members, successors
    from public.my_account_deletion_blockers()$$,
  $$values ('organization_owner', pg_temp.id('org_b'), null::uuid, null::integer, 0),
           ('only_member', pg_temp.id('org_b'), pg_temp.id('w2'), 0, null::integer)$$,
  'a workspace whose only member is the account blocks it too');

select pg_temp.act_as('expert');
select is_empty('select * from public.my_account_deletion_blockers()', 'nothing blocks an expert');
select pg_temp.act_as('stranger');
select is_empty('select * from public.my_account_deletion_blockers()', 'nor someone without a workspace');
select pg_temp.act_as_anon();
select throws_ok('select * from public.my_account_deletion_blockers()', '42501', null,
  'a visitor cannot ask');

-- A second owner frees w1.
select pg_temp.act_as('owner');
update public.workspace_members set role = 'owner'
where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('admin');
select results_eq(
  $$select kind, successors from public.my_account_deletion_blockers()$$,
  $$values ('organization_owner', 1)$$,
  'with admin as a second owner of w1, only org_a blocks, and admin can take it over');

-- Organization transfer ---------------------------------------------------------
select pg_temp.act_as('admin');
select throws_ok($$select public.transfer_organization(pg_temp.id('org_a'), pg_temp.id('admin'))$$,
  '42501', null, 'only the organization owner transfers it');
select is_empty($$select * from public.organization_transfer_candidates(pg_temp.id('org_a'))$$,
  'and only they see who can take it over');

select pg_temp.act_as('owner');
select results_eq($$select user_id from public.organization_transfer_candidates(pg_temp.id('org_a'))$$,
  array[pg_temp.id('admin')], 'the other owners of its workspaces can take org_a over');
select is_empty($$select * from public.organization_transfer_candidates(pg_temp.id('org_b'))$$,
  'nobody is listed for an organization the caller does not own');
select throws_ok($$select public.transfer_organization(pg_temp.id('org_a'), pg_temp.id('expert'))$$,
  'KR061', null, 'not to an expert of its workspace');
select throws_ok($$select public.transfer_organization(pg_temp.id('org_a'), pg_temp.id('outsider'))$$,
  'KR061', null, 'not to the owner of a workspace of another organization');
select throws_ok($$select public.transfer_organization(pg_temp.id('org_a'), pg_temp.id('owner'))$$,
  'KR061', null, 'not to themselves');
select throws_ok($$select public.transfer_organization(pg_temp.id('org_a'), null)$$,
  'KR061', null, 'not to nobody');
select throws_ok($$select public.transfer_organization(pg_temp.id('org_b'), pg_temp.id('owner'))$$,
  '42501', null, 'not an organization they do not own');
select lives_ok($$select public.transfer_organization(pg_temp.id('org_a'), pg_temp.id('admin'))$$,
  'owner hands org_a to admin');

select pg_temp.act_as_server();
select is((select owner_id from public.organizations where id = pg_temp.id('org_a')), pg_temp.id('admin'),
  'admin owns org_a');
select results_eq(
  $$select details ->> 'previous_owner_id', details ->> 'new_owner_id', actor
    from private.billing_events where organization_id = pg_temp.id('org_a') and kind = 'owner_transferred'$$,
  $$values (pg_temp.id('owner')::text, pg_temp.id('admin')::text, null::text)$$,
  'the billing audit log records who handed it to whom');

select pg_temp.act_as('owner');
select throws_ok($$select public.transfer_organization(pg_temp.id('org_a'), pg_temp.id('owner'))$$,
  '42501', null, 'the previous owner cannot take it back');
select is(pg_temp.affected($$update public.organizations set name = 'Cabinet A bis' where id = pg_temp.id('org_a')$$),
  0, 'nor rename it');
select is_empty('select * from public.my_account_deletion_blockers()', 'and nothing blocks their deletion any more');

select pg_temp.act_as('admin');
select is(pg_temp.affected($$update public.organizations set name = 'Cabinet A bis' where id = pg_temp.id('org_a')$$),
  1, 'the new owner renames it');
select ok((public.billing_overview(pg_temp.id('org_a')) ->> 'can_manage')::boolean,
  'and manages its billing');
select results_eq($$select id from public.my_manageable_organizations()$$, array[pg_temp.id('org_a')],
  'and can add workspaces to it');

-- The caller's sessions, for the export ---------------------------------------------
select pg_temp.act_as_server();
insert into auth.sessions (id, user_id, user_agent, ip) values
  ('00000000-0000-4000-8000-0000000000a1', pg_temp.id('expert'), 'Firefox', '192.0.2.10'),
  ('00000000-0000-4000-8000-0000000000a2', pg_temp.id('admin'), 'Chrome', '192.0.2.20');
select pg_temp.act_as('expert');
select results_eq($$select user_agent, ip from public.my_account_sessions()$$,
  $$values ('Firefox', '192.0.2.10')$$, 'a person reads their own sessions and nobody else''s');

-- One deletion at a time ------------------------------------------------------------
select is(public.claim_account_deletion(), 'ok', 'expert starts a deletion');
select is(public.claim_account_deletion(), 'busy', 'a second click while it runs is refused');
select lives_ok('select public.release_account_deletion()', 'a deletion that stops releases the lock');
select is(public.claim_account_deletion(), 'ok', 'so the next try can start');
do $$
begin
  -- Tries 3, 4 and 5.
  for i in 1..3 loop
    perform public.release_account_deletion();
    perform public.claim_account_deletion();
  end loop;
  perform public.release_account_deletion();
end;
$$;
select is(public.claim_account_deletion(), 'rate_limited', 'the sixth try in 15 minutes is refused');
select pg_temp.act_as('viewer');
select is(public.claim_account_deletion(), 'ok', 'the limit is per person');

-- Data around owner, who is about to go ---------------------------------------------
select pg_temp.act_as_server();
insert into public.report_status_events (id, workspace_id, report_id, from_status, to_status, changed_by)
values ('00000000-0000-4000-8000-0000000000e1', pg_temp.id('w1'), pg_temp.id('r1'), 'draft', 'in_review', pg_temp.id('owner'));
insert into public.notifications (workspace_id, user_id, event_id) values
  (pg_temp.id('w1'), pg_temp.id('owner'), '00000000-0000-4000-8000-0000000000e1'),
  (pg_temp.id('w1'), pg_temp.id('expert2'), '00000000-0000-4000-8000-0000000000e1');
insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by) values
  (pg_temp.id('w2'), 'owner@kolabreport.test', 'viewer', encode(sha256('tok-owner'::bytea), 'hex'), pg_temp.id('outsider')),
  (pg_temp.id('w2'), 'expert2@kolabreport.test', 'viewer', encode(sha256('tok-expert2'::bytea), 'hex'), pg_temp.id('outsider')),
  -- An invitation owner sends, still open when they go.
  (pg_temp.id('w1'), 'newcomer@kolabreport.test', 'viewer', private.invitation_token_hash('tok-newcomer'), pg_temp.id('owner'));
insert into public.ai_generations (id, workspace_id, section_id, requested_by, output_schema, schema_version,
  provider, model, estimated_tokens, user_rating, feedback_comment) values
  ('00000000-0000-4000-8000-0000000000f1', pg_temp.id('w1'), pg_temp.id('s3'), pg_temp.id('owner'),
   'section_draft', 1, 'mock', 'mock', 10, 1, 'Trop long, mais juste.'),
  ('00000000-0000-4000-8000-0000000000f2', pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'),
   'section_draft', 1, 'mock', 'mock', 10, -1, 'Hors sujet.');
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('deliverables', pg_temp.id('w1') || '/' || pg_temp.id('s3') || '/compte-owner.docx', pg_temp.id('owner'), pg_temp.id('owner')::text),
  ('deliverables', pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/compte-expert.docx', pg_temp.id('expert'), pg_temp.id('expert')::text);
insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
values (pg_temp.id('w1'), pg_temp.id('s3'), pg_temp.id('owner'),
  pg_temp.id('w1') || '/' || pg_temp.id('s3') || '/compte-owner.docx', 'compte-owner.docx', 'text/plain', 10);

-- A blocked account: the cleanup refuses and touches nothing.
select throws_ok($$select public.prepare_account_deletion(pg_temp.id('outsider'))$$, 'KR060', null,
  'the cleanup refuses an account that still has a blocker');
select throws_ok($$select public.prepare_account_deletion('00000000-0000-4000-8000-00000000dead')$$, 'P0002', null,
  'and an account that does not exist');

-- The only owner of a workspace with members, who owns no organization: the
-- trigger on profiles refuses the delete, whoever runs it.
insert into public.workspaces (id, organization_id, name, created_by)
values ('00000000-0000-4000-c000-000000000009', pg_temp.id('org_b'), 'Etude S', pg_temp.id('stranger'));
insert into public.workspace_members (workspace_id, user_id, role)
values ('00000000-0000-4000-c000-000000000009', pg_temp.id('viewer'), 'viewer');
select throws_ok($$delete from auth.users where id = pg_temp.id('stranger')$$, 'KR060', null,
  'deleting the only owner of a workspace is refused on every path');

-- owner goes ----------------------------------------------------------------------
create temp table cleanup as select public.prepare_account_deletion(pg_temp.id('owner')) as result;
select ok((select (result ->> 'storage_objects')::int >= 1 and (result ->> 'feedback_comments')::int >= 1
                  and (result ->> 'invitations')::int >= 1 and (result ->> 'notifications')::int >= 1
           from cleanup),
  'the cleanup reports what it cleared');
select results_eq(
  $$select owner, owner_id from storage.objects where name like '%/compte-owner.docx'$$,
  $$values (null::uuid, null::text)$$, 'their stored file stays, with no owner');
select results_eq(
  $$select owner_id from storage.objects where name like '%/compte-expert.docx'$$,
  array[pg_temp.id('expert')::text], 'other people''s files keep theirs');
select is((select count(*)::int from public.workspace_invitations where email = 'owner@kolabreport.test'),
  0, 'invitations sent to their address are gone');
select is((select count(*)::int from public.workspace_invitations where email = 'expert2@kolabreport.test'),
  1, 'other people''s stay');
select is((select feedback_comment from public.ai_generations where id = '00000000-0000-4000-8000-0000000000f2'),
  'Hors sujet.', 'other people''s feedback comments stay');

select lives_ok($$delete from auth.users where id = pg_temp.id('owner')$$, 'the account of owner can now be deleted');
select is((select count(*)::int from public.profiles where id = pg_temp.id('owner')), 0, 'the profile is gone');
select is((select count(*)::int from public.workspace_members where user_id = pg_temp.id('owner')), 0,
  'and the memberships');
select is((select count(*)::int from public.notifications where user_id = pg_temp.id('owner')), 0,
  'and the notifications');
select is((select count(*)::int from public.notifications where user_id = pg_temp.id('expert2')), 1,
  'while other people''s notifications stay');
select results_eq($$select created_by from public.workspaces where id = pg_temp.id('w1')$$, array[null::uuid],
  'w1 stays, with no creator');
select results_eq($$select created_by from public.reports where id = pg_temp.id('r1')$$, array[null::uuid],
  'r1 stays, with no creator');
select results_eq($$select uploaded_by from public.deliverables where file_name = 'compte-owner.docx'$$, array[null::uuid],
  'their deliverable stays, with no uploader');
select results_eq($$select changed_by from public.report_status_events where id = '00000000-0000-4000-8000-0000000000e1'$$,
  array[null::uuid], 'the status history stays, without their name');
select results_eq(
  $$select requested_by, user_rating::int, feedback_comment
    from public.ai_generations where id = '00000000-0000-4000-8000-0000000000f1'$$,
  $$values (null::uuid, 1, null::text)$$, 'their draft keeps its rating, without the requester or the comment');
select results_eq(
  $$select user_id, role::text from public.workspace_members where workspace_id = pg_temp.id('w1') and role = 'owner'$$,
  $$values (pg_temp.id('admin'), 'owner')$$, 'w1 keeps an owner');

-- Invitations belong to the workspace: the one owner sent keeps working.
select results_eq(
  $$select invited_by, accepted_at, revoked_at from public.workspace_invitations where email = 'newcomer@kolabreport.test'$$,
  $$values (null::uuid, null::timestamptz, null::timestamptz)$$, 'the open invitation owner sent stays, with no inviter');
select results_eq(
  $$select status, workspace_name, invited_by_name from public.invitation_preview('tok-newcomer')$$,
  $$values ('pending', 'Etude A', null::text)$$, 'its link still shows the invitation, without a name');
insert into auth.users (id, email, email_confirmed_at)
values ('00000000-0000-4000-a000-0000000000c1', 'newcomer@kolabreport.test', now());
select pg_temp.act_as_id('00000000-0000-4000-a000-0000000000c1');
select is(public.accept_workspace_invitation('tok-newcomer'), pg_temp.id('w1'), 'and the invitee joins w1 with it');
select pg_temp.act_as_server();
select results_eq(
  $$select role::text, invited_by from public.workspace_members
    where workspace_id = pg_temp.id('w1') and user_id = '00000000-0000-4000-a000-0000000000c1'$$,
  $$values ('viewer', null::uuid)$$, 'as a viewer, with no inviter on the membership');

-- Billing stays with the organization, and the trial claim with the e-mail hash.
select is((select count(*)::int from private.billing_trial_claims
           where user_id = pg_temp.id('owner') and email_hash = pg_temp.hash('owner@kolabreport.test')),
  1, 'the trial claim outlives the account');
select isnt_empty($$select 1 from public.billing_entitlements where organization_id = pg_temp.id('org_a')$$,
  'org_a keeps its billing rights');
select isnt_empty($$select 1 from public.organization_billing where organization_id = pg_temp.id('org_a')$$,
  'and its billing details');
select results_eq(
  $$select kind from private.billing_events where organization_id = pg_temp.id('org_a') order by id$$,
  $$values ('trial_started'), ('owner_transferred')$$, 'and its billing history');

-- Signing up again with the same address gives no new trial.
insert into auth.users (id, email) values ('00000000-0000-4000-a000-0000000000b1', 'Owner@KolabReport.test');
insert into public.organizations (id, name, slug, owner_id)
values ('00000000-0000-4000-b000-0000000000b1', 'Cabinet Retour', 'compte-cabinet-retour', '00000000-0000-4000-a000-0000000000b1');
select is((select count(*)::int from public.billing_entitlements where organization_id = '00000000-0000-4000-b000-0000000000b1'),
  0, 'a new account with the same e-mail gets no new trial');

-- expert goes too: no blocker, nothing to clear first.
select lives_ok($$delete from auth.users where id = pg_temp.id('expert')$$, 'an expert account is deleted');
select results_eq($$select uploaded_by from public.deliverables where id = pg_temp.id('d1')$$, array[null::uuid],
  'their deliverable stays with no uploader');
select results_eq($$select assigned_to from public.report_sections where id = pg_temp.id('s1')$$, array[null::uuid],
  'their section is unassigned');
select is((select count(*)::int from private.account_deletion_attempts where user_id = pg_temp.id('expert')), 0,
  'their deletion tries go with the account');

select * from finish();
rollback;
