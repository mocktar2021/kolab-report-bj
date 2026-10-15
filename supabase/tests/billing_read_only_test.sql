begin;
\ir fixtures.psql
select plan(83);

-- Read-only workspaces and renewal reminders (ADR 001, sections 6.1, 7.3
-- and 12; KRB-178). org_a runs on Cabinet, then its period is moved back
-- to put w1 in grace, then in read-only. The reminders use dates in 2030,
-- far from now(), and only look at the entitlements made here: other rows
-- of the local database may owe notices too.

update private.billing_settings set enforced = true;

create temp table kept (name text primary key, id uuid);
grant all on kept to authenticated;
create function pg_temp.kept_id(name text) returns uuid
language sql as $$ select id from kept where kept.name = $1 $$;

-- Moves the running subscription period of org_a to end `days` days from
-- now, in the past when negative.
create function pg_temp.end_in(days integer) returns void
language sql as $$
  update public.billing_entitlements
  set starts_at = now() - interval '60 days', ends_at = now() + make_interval(days => days)
  where organization_id = pg_temp.id('org_a') and scope = 'subscription' and revoked_at is null;
$$;

-- The notices one run of the cron claims, kept for the checks. Only the
-- entitlements of this file.
create temp table sent (run text, entitlement_id uuid, kind text, workspace_id uuid, plan text, recipients jsonb);
create function pg_temp.run(name text, at timestamptz) returns void
language sql as $$
  insert into sent
  select name, n.entitlement_id, n.kind, n.workspace_id, n.plan, n.recipients
  from public.billing_due_notices(at) n
  where n.entitlement_id in (select k.id from kept k);
$$;

create function pg_temp.kinds(name text) returns text[]
language sql as $$
  select coalesce(array_agg(s.kind order by s.kind), '{}') from sent s where s.run = name;
$$;

-- User ids of the recipients of a run's notices, as text, sorted.
create function pg_temp.recipients(name text) returns text[]
language sql as $$
  select coalesce(array_agg(r ->> 'user_id' order by r ->> 'user_id'), '{}')
  from sent s cross join jsonb_array_elements(s.recipients) r
  where s.run = name;
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- While org_a can write: Cabinet, a draft template rolled out to 20 %, a
-- throwaway template, an AI draft of s1 waiting for a decision, and r1 in
-- review (which notifies the admin). d1 is registered and not sent yet.
select pg_temp.act_as_server();
insert into kept values ('cabinet', pg_temp.set_plan(pg_temp.id('org_a'), 'cabinet'));
with candidate as (
  insert into public.prompt_library (workspace_id, template_key, title, template, status, changelog)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'Texte 2', 'draft', 'Essai')
  returning id
)
insert into kept select 'candidate', id from candidate;
with throwaway as (
  insert into public.prompt_library (workspace_id, template_key, title, template, status)
  values (pg_temp.id('w1'), 'modele-jetable', 'Modele jetable', 'Texte', 'draft')
  returning id
)
insert into kept select 'throwaway', id from throwaway;
with draft as (
  insert into public.ai_generations (workspace_id, section_id, requested_by, prompt_version_id, output_schema,
    schema_version, provider, model, estimated_tokens, status, output, completed_at)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.id('p_global'), 'section_draft',
    1, 'mock', 'mock', 10, 'succeeded', '{"title": "Brouillon"}', now())
  returning id
)
insert into kept select 'draft', id from draft;

select pg_temp.act_as('owner');
insert into kept select 'rollout', public.start_prompt_rollout(pg_temp.kept_id('candidate'), 20::smallint);
select public.transition_report_status(pg_temp.id('r1'), 'draft', 'in_review');

-- Grace: everything still works ------------------------------------------------------
select pg_temp.act_as_server();
select pg_temp.end_in(-2);
select pg_temp.act_as('owner');
select results_eq($$select state, plan from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('grace', 'cabinet')$$, 'two days after the end, w1 is in grace');
select lives_ok($$update public.reports set title = 'Rapport A, en grâce' where id = pg_temp.id('r1')$$,
  'in grace, a report is renamed');
select lives_ok($$insert into public.report_sections (workspace_id, report_id, title, position)
  values (pg_temp.id('w1'), pg_temp.id('r1'), 'Ajoutée en grâce', 9)$$,
  'a section is added');
select pg_temp.act_as('expert');
select lives_ok($$select public.save_section_content(pg_temp.id('s1'), 'Texte en grâce',
  (select content_updated_at from public.report_sections where id = pg_temp.id('s1')))$$,
  'and the expert writes their section');

-- Read-only: every insert and update in a user's name is refused ----------------------
select pg_temp.act_as_server();
select pg_temp.end_in(-8);
select pg_temp.act_as('owner');
select results_eq($$select state, plan from public.workspace_billing_state(pg_temp.id('w1'))$$,
  $$values ('read_only', 'cabinet')$$, 'eight days after the end, w1 is read-only');
select throws_ok($$update public.reports set title = 'Rapport A, lecture seule' where id = pg_temp.id('r1')$$,
  'KR043', null, 'reports: no rename');
select throws_ok($$select public.transition_report_status(pg_temp.id('r1'), 'in_review', 'draft')$$,
  'KR043', null, 'reports: no status change, so no history and no notification');
select throws_ok($$insert into public.report_sections (workspace_id, report_id, title)
  values (pg_temp.id('w1'), pg_temp.id('r1'), 'Refusée')$$,
  'KR043', null, 'report_sections: no new section');
select throws_ok($$update public.report_sections set weight = 3 where id = pg_temp.id('s3')$$,
  'KR043', null, 'report_sections: no new weight');
select throws_ok($$update public.report_sections set assigned_to = pg_temp.id('admin') where id = pg_temp.id('s3')$$,
  'KR043', null, 'report_sections: no assignment');
select throws_ok($$select public.reorder_report_sections(pg_temp.id('r1'),
  array[pg_temp.id('s3'), pg_temp.id('s1'), pg_temp.id('s2')]
  || (select array_agg(s.id order by s.id) from public.report_sections s
      where s.report_id = pg_temp.id('r1') and s.id not in (pg_temp.id('s1'), pg_temp.id('s2'), pg_temp.id('s3'))))$$,
  'KR043', null, 'report_sections: no new order');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'modele-refuse', 'Modele refuse', 'Texte')$$,
  'KR043', null, 'prompt_library: no new template');
select throws_ok($$update public.prompt_library set status = 'archived' where id = pg_temp.kept_id('throwaway')$$,
  'KR043', null, 'prompt_library: no status change, archiving included');
select throws_ok($$select public.set_prompt_rollout_percent(pg_temp.kept_id('rollout'), 40::smallint)$$,
  'KR043', null, 'prompt_rollouts: no new percentage');
select throws_ok($$select public.end_prompt_rollout(pg_temp.kept_id('rollout'), false)$$,
  'KR043', null, 'prompt_rollouts: not ended either');

select pg_temp.act_as('expert');
select throws_ok($$select public.save_section_content(pg_temp.id('s1'), 'Texte refusé',
  (select content_updated_at from public.report_sections where id = pg_temp.id('s1')))$$,
  'KR043', null, 'report_sections: the expert cannot write their section');
select throws_ok($$update public.report_sections set status = 'completed' where id = pg_temp.id('s1')$$,
  'KR043', null, 'report_sections: nor change its status');
select throws_ok($$select public.accept_ai_generation(pg_temp.kept_id('draft'), 'Texte du brouillon', 0, null)$$,
  'KR043', null, 'report_sections: nor accept an AI draft');
select throws_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'),
    pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/d2-notes.txt', 'notes.txt', 'text/plain', 10)$$,
  'KR043', null, 'deliverables: no new file');
select is(private.can_upload_deliverable(pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/d1-plan.docx'),
  false, 'deliverables: a file registered before cannot be sent now');
select lives_ok($$select public.discard_ai_generation(pg_temp.kept_id('draft'))$$,
  'discarding an AI draft still works');

select pg_temp.act_as('admin');
select is(pg_temp.affected($$update public.notifications set read_at = now() where user_id = pg_temp.id('admin')$$),
  1, 'marking a notification as read still works');

select pg_temp.act_as('outsider');
select throws_ok($$insert into public.report_sections (workspace_id, report_id, title)
  values (pg_temp.id('w1'), pg_temp.id('r1'), 'Intrusion')$$,
  '42501', null, 'people from outside get the usual refusal, not the billing one');

select pg_temp.act_as_server();
select is(pg_temp.affected($$update public.report_sections set content = 'Texte du serveur' where id = pg_temp.id('s1')$$),
  1, 'writes of the server are not checked');
select is((select refusal from public.claim_report_export(pg_temp.id('r1'), pg_temp.id('owner'), 'pdf', 'rapport-a.pdf', 10)),
  null, 'exports still work');

-- A mission workspace follows its own pass: read-only when the pass is over,
-- whatever the subscription.
insert into public.workspaces (id, organization_id, name, created_by, billing_mode)
values ('00000000-0000-4000-c000-000000000011', pg_temp.id('org_a'), 'Mission terminee', pg_temp.id('owner'), 'mission');
insert into kept values ('wm', '00000000-0000-4000-c000-000000000011');
insert into public.reports (id, workspace_id, title, created_by)
values ('00000000-0000-4000-d000-000000000011', pg_temp.kept_id('wm'), 'Rapport mission', pg_temp.id('owner'));
insert into public.billing_entitlements (organization_id, workspace_id, scope, plan, source, starts_at, ends_at,
  max_members, max_reports, drafts_total)
values (pg_temp.id('org_a'), pg_temp.kept_id('wm'), 'mission', 'mission', 'manual',
  now() - interval '100 days', now() - interval '10 days', 10, 1, 80);
select pg_temp.end_in(30);
select pg_temp.act_as('owner');
select throws_ok($$insert into public.report_sections (workspace_id, report_id, title)
  values (pg_temp.kept_id('wm'), '00000000-0000-4000-d000-000000000011', 'Refusée')$$,
  'KR043', null, 'a mission workspace whose pass is over is read-only');
select lives_ok($$insert into public.report_sections (workspace_id, report_id, title, position)
  values (pg_temp.id('w1'), pg_temp.id('r1'), 'Ajoutée sous abonnement', 10)$$,
  'while the subscription workspaces write again once renewed');

-- Nothing is refused while billing is not enforced ---------------------------------------
select pg_temp.act_as_server();
select pg_temp.end_in(-8);
update private.billing_settings set enforced = false;
select pg_temp.act_as('owner');
select lives_ok($$update public.reports set title = 'Rapport A, sans facturation' where id = pg_temp.id('r1')$$,
  'not enforced: a report is renamed');
select lives_ok($$insert into public.report_sections (workspace_id, report_id, title, position)
  values (pg_temp.id('w1'), pg_temp.id('r1'), 'Ajoutée sans facturation', 11)$$,
  'not enforced: a section is added');
select pg_temp.act_as('expert');
select is(private.can_upload_deliverable(pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/d1-plan.docx'),
  true, 'not enforced: the registered file can be sent');
select pg_temp.act_as_server();
update private.billing_settings set enforced = true;

-- Deletes are never refused ----------------------------------------------------------
select pg_temp.act_as('owner');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.id('d1')$$),
  1, 'read-only: a file is deleted');
select is(pg_temp.affected($$delete from public.report_sections where id = pg_temp.id('s3')$$),
  1, 'a section is deleted');
select is(pg_temp.affected($$delete from public.workspace_members
  where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('expert2')$$),
  1, 'a member is removed');
select is((select assigned_to from public.report_sections where id = pg_temp.id('s2')), null,
  'and their section is unassigned: writes made by another trigger are not checked');
-- Updates made by a foreign key action (on delete set null) run inside the
-- action's trigger, so they are not checked either. Deleting reports,
-- workspaces and organizations goes through the functions of KRB-180, whose
-- tests run them in read-only workspaces. Here, an account deleted in the
-- owner's name, as a definer function would: its sections lose their expert.
select pg_temp.act_as_server();
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.id('owner'), 'role', 'authenticated')::text, true);
select is(pg_temp.affected($$delete from public.profiles where id = pg_temp.id('expert')$$),
  1, 'an account is deleted in a user''s name');
select is((select assigned_to from public.report_sections where id = pg_temp.id('s1')), null,
  'and its sections are unassigned by the foreign key, read-only or not');

-- Reminders ------------------------------------------------------------------------------
-- org_b (owned by outsider): E, Indépendant until 20 March 2030 at 14:00 UTC
-- (15:00 in Porto-Novo), and H, a month in early 2029.
-- org_a (owned by owner): F1 then F2 stacked at its end, Cabinet until
-- 10 June 2030; w4, a second subscription workspace that admin owns too; and
-- wm2, a mission workspace that expert2 owns too, with its pass P.
select pg_temp.act_as_server();
update public.billing_entitlements set revoked_at = now(), revoked_reason = 'pgTAP'
where organization_id in (pg_temp.id('org_a'), pg_temp.id('org_b')) and revoked_at is null;

insert into kept (name, id) values
  ('E',  '00000000-0000-4000-8000-0000000000e1'),
  ('H',  '00000000-0000-4000-8000-0000000000e2'),
  ('G',  '00000000-0000-4000-8000-0000000000e3'),
  ('F1', '00000000-0000-4000-8000-0000000000f1'),
  ('F2', '00000000-0000-4000-8000-0000000000f2'),
  ('P',  '00000000-0000-4000-8000-0000000000a1'),
  ('w4', '00000000-0000-4000-c000-000000000014'),
  ('wm2', '00000000-0000-4000-c000-000000000015');

insert into public.workspaces (id, organization_id, name, created_by, billing_mode) values
  (pg_temp.kept_id('w4'), pg_temp.id('org_a'), 'Etude A4', pg_temp.id('owner'), 'subscription'),
  (pg_temp.kept_id('wm2'), pg_temp.id('org_a'), 'Mission A2', pg_temp.id('owner'), 'mission');
insert into public.workspace_members (workspace_id, user_id, role) values
  (pg_temp.kept_id('w4'), pg_temp.id('admin'), 'owner'),
  (pg_temp.kept_id('wm2'), pg_temp.id('expert2'), 'owner');

insert into public.billing_entitlements (id, organization_id, workspace_id, scope, plan, source, starts_at, ends_at) values
  (pg_temp.kept_id('E'), pg_temp.id('org_b'), null, 'subscription', 'independant', 'purchase',
   '2030-02-20 14:00+00', '2030-03-20 14:00+00'),
  (pg_temp.kept_id('H'), pg_temp.id('org_b'), null, 'subscription', 'independant', 'purchase',
   '2029-01-01 00:00+00', '2029-02-01 00:00+00'),
  (pg_temp.kept_id('F1'), pg_temp.id('org_a'), null, 'subscription', 'cabinet', 'purchase',
   '2030-04-10 12:00+00', '2030-05-10 12:00+00'),
  (pg_temp.kept_id('F2'), pg_temp.id('org_a'), null, 'subscription', 'cabinet', 'purchase',
   '2030-05-10 12:00+00', '2030-06-10 12:00+00'),
  (pg_temp.kept_id('P'), pg_temp.id('org_a'), pg_temp.kept_id('wm2'), 'mission', 'mission', 'purchase',
   '2030-04-16 10:00+00', '2030-07-15 10:00+00');

-- E ends on 20 March: d7 from 13 March at 00:00 in Porto-Novo (12 March, 23:00 UTC).
select pg_temp.run('early', '2030-03-12 22:59+00');
select is(pg_temp.kinds('early'), '{}'::text[], 'nothing is due before the d7 day');
select pg_temp.run('d7', '2030-03-13 05:17+00');
select is(pg_temp.kinds('d7'), array['d7'], 'seven days before the end day, d7 is due');
select is((select s.recipients from sent s where s.run = 'd7'),
  jsonb_build_array(jsonb_build_object('user_id', pg_temp.id('outsider'), 'email', 'outsider@kolabreport.test', 'name', 'Outsider')),
  'it goes to the organization owner, with the e-mail and the name to write to');
select is((select count(*)::int from public.notifications n
           where n.kind = 'billing' and n.entitlement_id = pg_temp.kept_id('E') and n.billing_notice = 'd7'
             and n.user_id = pg_temp.id('outsider') and n.organization_id = pg_temp.id('org_b') and n.workspace_id is null),
  1, 'with an in-app notification');
select pg_temp.run('d7 again', '2030-03-13 05:17+00');
select is(pg_temp.kinds('d7 again'), '{}'::text[], 'running again sends nothing twice');
select is((select count(*)::int from public.notifications n
           where n.entitlement_id = pg_temp.kept_id('E') and n.billing_notice = 'd7'),
  1, 'and writes no second notification');
select pg_temp.run('d7 later', '2030-03-16 05:17+00');
select is(pg_temp.kinds('d7 later'), '{}'::text[], 'nor on the next days');

select pg_temp.run('d1', '2030-03-19 04:17+00');
select is(pg_temp.kinds('d1'), array['d1'], 'the day before the end day, d1 is due');
select results_eq($$select kind, emailed_at is null from private.billing_notices
                   where entitlement_id = pg_temp.kept_id('E') order by kind$$,
  $$values ('d1', true), ('d7', true)$$, 'each notice is claimed once, before its e-mails');
select is(public.billing_finish_notice(pg_temp.kept_id('E'), 'd7', 1, 0), true, 'the cron records the e-mails');
select results_eq($$select emails_sent, emails_failed, emailed_at is not null from private.billing_notices
                   where entitlement_id = pg_temp.kept_id('E') and kind = 'd7'$$,
  $$values (1, 0, true)$$, 'sent and failed are kept');
select is(public.billing_finish_notice(pg_temp.kept_id('E'), 'read_only', 1, 0), false,
  'a notice never claimed records nothing');

select pg_temp.run('ended', '2030-03-21 05:17+00');
select is(pg_temp.kinds('ended'), array['ended'], 'after the end, ended is due');
select is((select count(*)::int from private.billing_events b
           where b.organization_id = pg_temp.id('org_b') and b.kind = 'entered_grace'
             and b.details ->> 'entitlement_id' = pg_temp.kept_id('E')::text),
  1, 'with the entered_grace audit event');

-- Paid in time: G starts at the payment, before the cron runs.
insert into public.billing_entitlements (id, organization_id, scope, plan, source, starts_at, ends_at)
values (pg_temp.kept_id('G'), pg_temp.id('org_b'), 'subscription', 'independant', 'purchase',
  '2030-03-28 00:00+00', '2030-04-28 00:00+00');
select pg_temp.run('paid', '2030-03-28 05:17+00');
select is(pg_temp.kinds('paid'), '{}'::text[], 'a line paid again owes no read_only notice');
update public.billing_entitlements set revoked_at = now(), revoked_reason = 'pgTAP' where id = pg_temp.kept_id('G');
select pg_temp.run('read only', '2030-03-28 05:17+00');
select is(pg_temp.kinds('read only'), array['read_only'], 'without it, read_only is due once the grace is over');
select is((select count(*)::int from private.billing_events b
           where b.organization_id = pg_temp.id('org_b') and b.kind = 'entered_read_only'
             and b.details ->> 'entitlement_id' = pg_temp.kept_id('E')::text),
  1, 'with the entered_read_only audit event');
select pg_temp.run('read only again', '2030-03-29 05:17+00');
select is(pg_temp.kinds('read only again'), '{}'::text[], 'and only once');

-- H turned read-only on 8 February 2029: the notice catches up for 7 days, no more.
select pg_temp.run('too late', '2029-02-20 05:17+00');
select is(pg_temp.kinds('too late'), '{}'::text[], 'a line read-only for longer than the catch-up gets nothing');
select pg_temp.run('catch up', '2029-02-12 05:17+00');
select is(pg_temp.kinds('catch up'), array['read_only'], 'within it, the read_only notice still goes out');

-- org_a: F2 is stacked at the end of F1.
select pg_temp.run('stacked', '2030-05-05 05:17+00');
select is(pg_temp.kinds('stacked'), '{}'::text[], 'a period followed by a renewal at its end owes nothing');
-- A missed week: only the notice that is still true goes out.
select pg_temp.run('late', '2030-06-11 05:17+00');
select is(pg_temp.kinds('late'), array['ended'], 'after missed runs, only the latest notice goes out');
select is((select array_agg(kind order by kind) from private.billing_notices where entitlement_id = pg_temp.kept_id('F2')),
  array['ended'], 'd7 and d1 are not sent late');
select is(pg_temp.recipients('late'),
  array[pg_temp.id('owner')::text, pg_temp.id('admin')::text],
  'a subscription notice goes to the organization owner and the owners of its workspaces, not of mission ones');

select pg_temp.run('pass', '2030-07-08 05:17+00');
select results_eq($$select kind, workspace_id, plan from sent where run = 'pass'$$,
  $$values ('d7', pg_temp.kept_id('wm2'), 'mission')$$, 'a pass gets its own notices');
select is(pg_temp.recipients('pass'),
  array[pg_temp.id('owner')::text, pg_temp.id('expert2')::text],
  'they go to the organization owner and the owners of the mission workspace');

-- Another run claimed d1 of P first (it committed before this one).
insert into private.billing_notices (entitlement_id, kind) values (pg_temp.kept_id('P'), 'd1');
select pg_temp.run('second run', '2030-07-14 05:17+00');
select is(pg_temp.kinds('second run'), '{}'::text[], 'a notice claimed by another run is not sent again');
select is((select count(*)::int from public.notifications n
           where n.entitlement_id = pg_temp.kept_id('P') and n.billing_notice = 'd1'),
  0, 'and gets no second notification');

update private.billing_settings set enforced = false;
delete from private.billing_notices where entitlement_id = pg_temp.kept_id('P') and kind = 'd1';
select pg_temp.run('off', '2030-07-14 05:17+00');
select is(pg_temp.kinds('off'), '{}'::text[], 'no notice is due while billing is not enforced');
update private.billing_settings set enforced = true;

-- Who can call ---------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.billing_due_notices(timestamptz)', 'execute'),
  'the service role claims notices');
select ok(not has_function_privilege('authenticated', 'public.billing_due_notices(timestamptz)', 'execute'),
  'signed-in users cannot');
select ok(not has_function_privilege('anon', 'public.billing_due_notices(timestamptz)', 'execute'),
  'nor visitors');
select ok(has_function_privilege('service_role', 'public.billing_finish_notice(uuid, text, integer, integer)', 'execute'),
  'the service role records e-mails');
select ok(not has_function_privilege('authenticated', 'public.billing_finish_notice(uuid, text, integer, integer)', 'execute'),
  'signed-in users cannot');
select ok(not has_function_privilege('authenticated', 'private.billing_due(timestamptz)', 'execute'),
  'nor read what is due');
select ok(not has_table_privilege('authenticated', 'private.billing_notices', 'select'),
  'nor the claims');
select ok(not has_table_privilege('service_role', 'private.billing_notices', 'select'),
  'the service role goes through the functions too');
select pg_temp.act_as('owner');
select throws_ok($$select * from public.billing_due_notices()$$, '42501', null,
  'calling it signed in is refused');

-- Who sees the notifications --------------------------------------------------------------
select pg_temp.act_as('outsider');
select is((select count(*)::int from public.notifications where kind = 'billing'),
  5, 'the owner of org_b sees its five notices');
select is(pg_temp.affected($$update public.notifications set read_at = now() where kind = 'billing'$$),
  5, 'and marks them as read');
select pg_temp.act_as('admin');
select is((select count(*)::int from public.notifications where kind = 'billing'),
  1, 'the admin, owner of w4, sees the subscription notice of org_a only');
select pg_temp.act_as('expert2');
select is((select array_agg(billing_notice) from public.notifications where kind = 'billing'),
  array['d7'], 'expert2, owner of the mission workspace, sees its pass notice');
select pg_temp.act_as('viewer');
select is((select count(*)::int from public.notifications where kind = 'billing'),
  0, 'other members see none');
select pg_temp.act_as('owner');
select is(pg_temp.affected($$update public.workspace_members set role = 'admin'
  where workspace_id = pg_temp.kept_id('w4') and user_id = pg_temp.id('admin')$$),
  1, 'once the admin is no longer an owner');
select pg_temp.act_as('admin');
select is((select count(*)::int from public.notifications where kind = 'billing'),
  0, 'they stop seeing it: only people who can renew do');

-- The table keeps its two kinds apart.
select pg_temp.act_as_server();
select throws_ok($$insert into public.notifications (kind, user_id, workspace_id, organization_id, entitlement_id)
  values ('billing', pg_temp.id('owner'), null, pg_temp.id('org_a'), pg_temp.kept_id('F1'))$$,
  '23514', null, 'a billing notification names its notice');
select throws_ok($$insert into public.notifications (user_id, workspace_id)
  values (pg_temp.id('owner'), pg_temp.id('w1'))$$,
  '23514', null, 'a status notification names its change');

select * from finish();
rollback;
