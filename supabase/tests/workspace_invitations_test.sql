begin;
\ir fixtures.psql
select plan(74);

-- SHA-256 of a link token, the way the app stores it.
create function pg_temp.token_hash(token text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(token, 'UTF8')), 'hex');
$$;

-- guest signs up later in this file, after being invited.
create function pg_temp.guest() returns uuid
language sql immutable as $$
  select '00000000-0000-4000-a000-000000000008'::uuid;
$$;

create function pg_temp.act_as_guest() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.guest(), 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

grant execute on function pg_temp.token_hash(text), pg_temp.guest(), pg_temp.act_as_guest() to authenticated, anon;

-- The trial counts 5 members, open invitations included, and w1 already has
-- 4: org_a is on Cabinet here, like the demo organization of the seed.
select pg_temp.set_plan(pg_temp.id('org_a'), 'cabinet');

-- The accept functions only trust a confirmed e-mail. Fixture users are not
-- confirmed, so confirm the two that accept invitations. viewer stays
-- unconfirmed until the end of the accept tests.
update auth.users set email_confirmed_at = now()
where id in (pg_temp.id('stranger'), pg_temp.id('outsider'));

-- Who can invite --------------------------------------------------------------
select pg_temp.act_as('owner');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'anna@kolabreport.test', 'expert', pg_temp.token_hash('tok-anna'))$$,
  'owner can invite an expert');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'boris@kolabreport.test', 'owner', pg_temp.token_hash('tok-boris'))$$,
  'owner can invite an owner');

select pg_temp.act_as('admin');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'chloe@kolabreport.test', 'expert', pg_temp.token_hash('tok-chloe'))$$,
  'admin can invite an expert');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, role, token_hash)
  values (pg_temp.id('w1'), 'denis@kolabreport.test', 'owner', pg_temp.token_hash('tok-denis'))$$,
  '42501', null, 'admin cannot invite an owner');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash, invited_by)
  values (pg_temp.id('w1'), 'denis@kolabreport.test', pg_temp.token_hash('tok-denis'), pg_temp.id('owner'))$$,
  '42501', null, 'the inviter must be the caller');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash, revoked_at)
  values (pg_temp.id('w1'), 'denis@kolabreport.test', pg_temp.token_hash('tok-denis'), now())$$,
  '42501', null, 'a new invitation cannot start revoked');

select pg_temp.act_as('expert');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash)
  values (pg_temp.id('w1'), 'denis@kolabreport.test', pg_temp.token_hash('tok-denis'))$$,
  '42501', null, 'expert cannot invite');

select pg_temp.act_as('viewer');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash)
  values (pg_temp.id('w1'), 'denis@kolabreport.test', pg_temp.token_hash('tok-denis'))$$,
  '42501', null, 'viewer cannot invite');

select pg_temp.act_as('outsider');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash)
  values (pg_temp.id('w1'), 'denis@kolabreport.test', pg_temp.token_hash('tok-denis'))$$,
  '42501', null, 'outsider cannot invite into w1');

select pg_temp.act_as_anon();
select throws_ok('select * from public.workspace_invitations', '42501', null, 'anon cannot read invitations');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash)
  values (pg_temp.id('w1'), 'denis@kolabreport.test', pg_temp.token_hash('tok-denis'))$$,
  '42501', null, 'anon cannot invite');

-- Who can read ----------------------------------------------------------------
select pg_temp.act_as('owner');
select is((select count(*)::int from public.workspace_invitations where workspace_id = pg_temp.id('w1')), 3, 'owner reads the w1 invitations');
select pg_temp.act_as('admin');
select is((select count(*)::int from public.workspace_invitations where workspace_id = pg_temp.id('w1')), 3, 'admin reads the w1 invitations');
select pg_temp.act_as('expert');
select is((select count(*)::int from public.workspace_invitations where workspace_id = pg_temp.id('w1')), 0, 'expert cannot read the w1 invitations');
select pg_temp.act_as('viewer');
select is((select count(*)::int from public.workspace_invitations where workspace_id = pg_temp.id('w1')), 0, 'viewer cannot read the w1 invitations');
select pg_temp.act_as('outsider');
select is((select count(*)::int from public.workspace_invitations where workspace_id = pg_temp.id('w1')), 0, 'outsider cannot read the w1 invitations');

-- What can be invited ---------------------------------------------------------
select pg_temp.act_as('owner');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash)
  values (pg_temp.id('w1'), 'expert@kolabreport.test', pg_temp.token_hash('tok-member'))$$,
  'KR007', null, 'a member of the workspace cannot be invited');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash)
  values (pg_temp.id('w1'), 'Bad@Example.com', pg_temp.token_hash('tok-bad'))$$,
  '23514', null, 'the e-mail must be lower case');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash)
  values (pg_temp.id('w1'), 'nope', pg_temp.token_hash('tok-bad'))$$,
  '23514', null, 'the e-mail must look like an e-mail');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash)
  values (pg_temp.id('w1'), ' spaced@kolabreport.test', pg_temp.token_hash('tok-bad'))$$,
  '23514', null, 'the e-mail must be trimmed');

-- One open invitation per person and workspace.
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash)
  values (pg_temp.id('w1'), 'anna@kolabreport.test', pg_temp.token_hash('tok-anna-dup'))$$,
  '23505', 'duplicate key value violates unique constraint "workspace_invitations_one_open_idx"',
  'a second open invitation for the same e-mail is rejected');
select is(pg_temp.affected($$update public.workspace_invitations set revoked_at = now() where email = 'anna@kolabreport.test'$$),
  1, 'owner can revoke an invitation');
select lives_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash)
  values (pg_temp.id('w1'), 'anna@kolabreport.test', pg_temp.token_hash('tok-anna-2'))$$,
  'a revoked invitation no longer blocks a new one');

-- Resend and revoke only ------------------------------------------------------
select throws_ok($$update public.workspace_invitations set email = 'other@kolabreport.test' where email = 'chloe@kolabreport.test'$$,
  '42501', 'permission denied for table workspace_invitations', 'the e-mail cannot be changed');
select throws_ok($$update public.workspace_invitations set role = 'admin' where email = 'chloe@kolabreport.test'$$,
  '42501', 'permission denied for table workspace_invitations', 'the role cannot be changed');
select throws_ok($$update public.workspace_invitations set workspace_id = pg_temp.id('w2') where email = 'chloe@kolabreport.test'$$,
  '42501', 'permission denied for table workspace_invitations', 'an invitation cannot move to another workspace');

select pg_temp.act_as('admin');
select is(pg_temp.affected($$update public.workspace_invitations
  set token_hash = pg_temp.token_hash('tok-chloe-2'), expires_at = now() + interval '7 days'
  where email = 'chloe@kolabreport.test'$$),
  1, 'admin can resend an invitation');
select is(pg_temp.affected($$update public.workspace_invitations set revoked_at = now() where email = 'boris@kolabreport.test'$$),
  0, 'admin cannot revoke an owner invitation');

select pg_temp.act_as('expert');
select is(pg_temp.affected($$update public.workspace_invitations set revoked_at = now() where email = 'chloe@kolabreport.test'$$),
  0, 'expert cannot revoke an invitation');

select pg_temp.act_as('owner');
select throws_ok($$delete from public.workspace_invitations where email = 'chloe@kolabreport.test'$$,
  '42501', 'permission denied for table workspace_invitations', 'invitations cannot be deleted');

-- invitation_preview ----------------------------------------------------------
insert into public.workspace_invitations (workspace_id, email, role, token_hash)
values (pg_temp.id('w1'), 'stranger@kolabreport.test', 'expert', pg_temp.token_hash('tok-stranger'));
insert into public.workspace_invitations (workspace_id, email, token_hash, expires_at)
values (pg_temp.id('w1'), 'outsider@kolabreport.test', pg_temp.token_hash('tok-late'), now() - interval '1 day');

select pg_temp.act_as_anon();
select results_eq(
  $$select status, email, role::text, workspace_name, organization_name, invited_by_name from public.invitation_preview('tok-stranger')$$,
  $$values ('pending', 'stranger@kolabreport.test', 'expert', 'Etude A', 'Cabinet A', 'Owner')$$,
  'anon sees a pending invitation');
select is((select expires_at from public.invitation_preview('tok-stranger')), now() + interval '7 days',
  'an invitation lasts 7 days');
select is((select count(*)::int from public.invitation_preview('tok-unknown')), 0, 'an unknown token shows nothing');
select is((select status from public.invitation_preview('tok-late')), 'expired', 'a past expiry shows as expired');
select is((select count(*)::int from public.invitation_preview('tok-chloe')), 0, 'a resent invitation drops the old link');

select pg_temp.act_as('stranger');
select results_eq(
  $$select status, email, role::text, workspace_name, organization_name, invited_by_name from public.invitation_preview('tok-stranger')$$,
  $$values ('pending', 'stranger@kolabreport.test', 'expert', 'Etude A', 'Cabinet A', 'Owner')$$,
  'a signed-in user sees a pending invitation');

reset role;
update public.profiles set full_name = ' ' where id = pg_temp.id('admin');
select pg_temp.act_as_anon();
select is((select invited_by_name from public.invitation_preview('tok-chloe-2')), 'admin@kolabreport.test',
  'an inviter without a name shows as their e-mail');

-- accept_workspace_invitation -------------------------------------------------
select throws_ok($$select public.accept_workspace_invitation('tok-stranger')$$,
  '42501', 'permission denied for function accept_workspace_invitation', 'anon cannot accept an invitation');

select pg_temp.act_as('stranger');
select throws_ok($$select private.join_from_invitation(gen_random_uuid(), pg_temp.id('stranger'))$$,
  '42501', 'permission denied for function join_from_invitation', 'signed-in users cannot call the join helper');

select pg_temp.act_as('outsider');
select throws_ok($$select public.accept_workspace_invitation('tok-stranger')$$,
  'KR006', null, 'another account cannot use the link');

select pg_temp.act_as('stranger');
select is(public.accept_workspace_invitation('tok-stranger'), pg_temp.id('w1'), 'the invitee joins with the link');
reset role;
select is((select role::text from public.workspace_members where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('stranger')),
  'expert', 'the invitee gets the invited role');
select is((select accepted_by from public.workspace_invitations
           where token_hash = pg_temp.token_hash('tok-stranger') and accepted_at is not null),
  pg_temp.id('stranger'), 'the invitation records who used it');

select pg_temp.act_as('stranger');
select is(public.accept_workspace_invitation('tok-stranger'), pg_temp.id('w1'), 'opening the link again returns the workspace');

select pg_temp.act_as('outsider');
select throws_ok($$select public.accept_workspace_invitation('tok-stranger')$$,
  'KR004', null, 'a used invitation cannot be used by someone else');
select throws_ok($$select public.accept_workspace_invitation('tok-late')$$,
  'KR005', null, 'an expired invitation cannot be used');

select pg_temp.act_as('owner');
update public.workspace_invitations set revoked_at = now() where token_hash = pg_temp.token_hash('tok-late');

select pg_temp.act_as('outsider');
select throws_ok($$select public.accept_workspace_invitation('tok-late')$$,
  'KR003', null, 'a revoked invitation cannot be used');
select throws_ok($$select public.accept_workspace_invitation('tok-unknown')$$,
  'KR003', null, 'an unknown token is rejected');
reset role;
select is((select count(*)::int from public.workspace_members where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('outsider')),
  0, 'failed attempts add no membership');

select pg_temp.act_as_anon();
select is((select status from public.invitation_preview('tok-late')), 'revoked', 'a revoked invitation shows as revoked');
select is((select status from public.invitation_preview('tok-stranger')), 'accepted', 'a used invitation shows as accepted');

select pg_temp.act_as('owner');
select is(pg_temp.affected($$update public.workspace_invitations set revoked_at = now() where token_hash = pg_temp.token_hash('tok-stranger')$$),
  0, 'a used invitation cannot be revoked');

-- Someone added directly while the invitation was open keeps their role.
select pg_temp.act_as('outsider');
insert into public.workspace_invitations (workspace_id, email, role, token_hash)
values (pg_temp.id('w2'), 'stranger@kolabreport.test', 'admin', pg_temp.token_hash('tok-stranger-w2'));
-- Joined through another invitation meanwhile (written as the table owner).
reset role;
insert into public.workspace_members (workspace_id, user_id, role)
values (pg_temp.id('w2'), pg_temp.id('stranger'), 'viewer');
select pg_temp.act_as('stranger');
select is(public.accept_workspace_invitation('tok-stranger-w2'), pg_temp.id('w2'), 'a member who joined meanwhile can still use the link');
reset role;
select is((select role::text from public.workspace_members where workspace_id = pg_temp.id('w2') and user_id = pg_temp.id('stranger')),
  'viewer', 'they keep the role they already had');

-- An unconfirmed e-mail cannot accept, even with its own invitation.
select pg_temp.act_as('outsider');
insert into public.workspace_invitations (workspace_id, email, role, token_hash)
values (pg_temp.id('w2'), 'viewer@kolabreport.test', 'expert', pg_temp.token_hash('tok-viewer'));
select pg_temp.act_as('viewer');
select throws_ok($$select public.accept_workspace_invitation('tok-viewer')$$,
  'KR006', null, 'an unconfirmed e-mail cannot use the link');
select is(public.accept_my_pending_invitations(), 0, 'an unconfirmed e-mail joins nothing on sign-in');
reset role;
select is((select count(*)::int from public.workspace_members where workspace_id = pg_temp.id('w2') and user_id = pg_temp.id('viewer')),
  0, 'the unconfirmed user did not join');
update auth.users set email_confirmed_at = now() where id = pg_temp.id('viewer');
select pg_temp.act_as('viewer');
select is(public.accept_workspace_invitation('tok-viewer'), pg_temp.id('w2'), 'the same link works once the e-mail is confirmed');

-- accept_my_pending_invitations -----------------------------------------------
select pg_temp.act_as_anon();
select throws_ok($$select public.accept_my_pending_invitations()$$,
  '42501', 'permission denied for function accept_my_pending_invitations', 'anon cannot accept pending invitations');

-- guest is invited to w1 and w2 before having an account. A revoked
-- invitation in w1 and an expired one in a third workspace are skipped.
reset role;
insert into public.workspaces (id, organization_id, name, created_by)
values ('00000000-0000-4000-c000-000000000003', pg_temp.id('org_a'), 'Etude C', pg_temp.id('owner'));

select pg_temp.act_as('owner');
insert into public.workspace_invitations (workspace_id, email, role, token_hash)
values (pg_temp.id('w1'), 'guest@kolabreport.test', 'admin', pg_temp.token_hash('tok-guest-old'));
update public.workspace_invitations set revoked_at = now() where token_hash = pg_temp.token_hash('tok-guest-old');
insert into public.workspace_invitations (workspace_id, email, role, token_hash)
values (pg_temp.id('w1'), 'guest@kolabreport.test', 'viewer', pg_temp.token_hash('tok-guest-w1'));
insert into public.workspace_invitations (workspace_id, email, role, token_hash, expires_at)
values ('00000000-0000-4000-c000-000000000003', 'guest@kolabreport.test', 'expert', pg_temp.token_hash('tok-guest-w3'), now() - interval '1 minute');
select pg_temp.act_as('outsider');
insert into public.workspace_invitations (workspace_id, email, role, token_hash)
values (pg_temp.id('w2'), 'guest@kolabreport.test', 'admin', pg_temp.token_hash('tok-guest-w2'));

-- guest signs up and confirms their e-mail.
reset role;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
values (pg_temp.guest(), 'guest@kolabreport.test', '{"full_name": "Guest"}', now());

select pg_temp.act_as_guest();
select is(public.accept_my_pending_invitations(), 2, 'sign-in accepts the two open invitations');
reset role;
select results_eq(
  $$select workspace_id, role::text from public.workspace_members where user_id = pg_temp.guest() order by workspace_id$$,
  $$values (pg_temp.id('w1'), 'viewer'), (pg_temp.id('w2'), 'admin')$$,
  'the invitee joins both workspaces with the invited roles');
select is((select count(*)::int from public.workspace_invitations where accepted_by = pg_temp.guest() and accepted_at is not null),
  2, 'both invitations are marked as used');
select is((select count(*)::int from public.workspace_invitations where email = 'guest@kolabreport.test' and accepted_at is null),
  2, 'the revoked and expired invitations stay unused');
select pg_temp.act_as_guest();
select is(public.accept_my_pending_invitations(), 0, 'a second sign-in accepts nothing');

-- Hardening -------------------------------------------------------------------
-- Someone outside w1 cannot use an invite to test who is a member.
select pg_temp.act_as('outsider');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash)
  values (pg_temp.id('w1'), 'expert@kolabreport.test', pg_temp.token_hash('tok-probe'))$$,
  '42501', null, 'a non-manager learns nothing about who is a member');

select pg_temp.act_as('owner');
select throws_ok($$insert into public.workspace_invitations (workspace_id, email, token_hash, accepted_by)
  values (pg_temp.id('w1'), 'eve@kolabreport.test', pg_temp.token_hash('tok-eve'), pg_temp.id('owner'))$$,
  '42501', null, 'a new invitation cannot name who accepted it');
insert into public.workspace_invitations (workspace_id, email, token_hash)
values (pg_temp.id('w1'), 'reopen@kolabreport.test', pg_temp.token_hash('tok-reopen'));
select is(pg_temp.affected($$update public.workspace_invitations set revoked_at = now() where email = 'reopen@kolabreport.test'$$),
  1, 'owner revokes an invitation');
select is(pg_temp.affected($$update public.workspace_invitations set revoked_at = null where email = 'reopen@kolabreport.test'$$),
  0, 'a revoked invitation cannot be reopened');

-- Deleting the account of someone whose invitation was used still works.
select pg_temp.act_as('admin');
insert into public.workspace_invitations (workspace_id, email, role, token_hash)
values (pg_temp.id('w1'), 'outsider@kolabreport.test', 'viewer', pg_temp.token_hash('tok-outsider'));
select pg_temp.act_as('outsider');
select is(public.accept_workspace_invitation('tok-outsider'), pg_temp.id('w1'), 'outsider joins w1 through the admin invitation');
reset role;
select lives_ok($$delete from auth.users where id = pg_temp.id('admin')$$, 'the inviter account can still be deleted');
select is((select invited_by from public.workspace_members where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('outsider')),
  null::uuid, 'the membership drops the link to the deleted inviter');

-- Deleting a workspace --------------------------------------------------------
select pg_temp.act_as('owner');
select lives_ok($$select public.delete_workspace(pg_temp.id('w1'), 'Etude A')$$, 'owner deletes w1');
reset role;
select is((select count(*)::int from public.workspace_invitations where workspace_id = pg_temp.id('w1')),
  0, 'deleting a workspace deletes its invitations');
select isnt((select count(*)::int from public.workspace_invitations where workspace_id = pg_temp.id('w2')),
  0, 'other workspaces keep their invitations');

select * from finish();
rollback;
