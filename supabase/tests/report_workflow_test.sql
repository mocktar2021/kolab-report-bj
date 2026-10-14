begin;
\ir fixtures.psql
select plan(63);

create temp table kept (name text primary key, id uuid, ids uuid[]);
grant all on kept to authenticated, anon;

create or replace function pg_temp.keep(name text, id uuid, ids uuid[] default null) returns void
language sql as $$
  insert into kept values (name, id, ids) on conflict (name) do update set id = excluded.id, ids = excluded.ids
$$;

create or replace function pg_temp.kept_id(name text) returns uuid
language sql as $$ select id from kept where kept.name = $1 $$;

create or replace function pg_temp.report_status(report uuid) returns text
language sql security definer as $$ select status::text from public.reports where id = report $$;

-- Moves r1 as the given user and keeps the change and its recipients.
create or replace function pg_temp.move(who text, from_status text, to_status text) returns void
language plpgsql as $$
declare
  changed record;
begin
  perform pg_temp.act_as(who);
  select * into changed from public.transition_report_status(
    pg_temp.id('r1'), from_status::public.report_status, to_status::public.report_status);
  reset role;
  perform pg_temp.keep(to_status, changed.event_id, changed.recipients);
end;
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- The transitions ------------------------------------------------------------------
select results_eq(
  $$select from_status::text, to_status::text, roles::text[] from private.report_status_transitions order by from_status::text, to_status::text$$,
  $$values ('draft', 'in_review', array['owner', 'admin']),
           ('final', 'draft', array['owner']),
           ('in_review', 'draft', array['owner', 'admin']),
           ('in_review', 'final', array['owner'])$$,
  'the transitions match src/lib/reports/status.ts');

select pg_temp.act_as('owner');
select throws_ok($$select * from private.report_status_transitions$$, '42501', null,
  'users cannot read the transition table directly');

-- Who changes the status -----------------------------------------------------------
select pg_temp.act_as('expert');
select throws_ok($$select * from public.transition_report_status(pg_temp.id('r1'), 'draft', 'in_review')$$,
  '42501', null, 'an expert cannot submit a report for review');
select pg_temp.act_as('viewer');
select throws_ok($$select * from public.transition_report_status(pg_temp.id('r1'), 'draft', 'in_review')$$,
  '42501', null, 'a viewer cannot submit a report for review');
select pg_temp.act_as('outsider');
select throws_ok($$select * from public.transition_report_status(pg_temp.id('r1'), 'draft', 'in_review')$$,
  'P0002', null, 'someone from another workspace does not see the report');
select pg_temp.act_as('owner');
select throws_ok($$select * from public.transition_report_status(pg_temp.id('r1'), 'draft', 'final')$$,
  '22023', null, 'a draft cannot become final without a review');
select throws_ok($$select * from public.transition_report_status(pg_temp.id('r1'), 'in_review', 'final')$$,
  '40001', null, 'a change from a status the report is not in is refused');
select is(pg_temp.report_status(pg_temp.id('r1')), 'draft', 'the refused changes changed nothing');

select pg_temp.act_as('owner');
select throws_ok($$update public.reports set status = 'final' where id = pg_temp.id('r1')$$,
  '42501', null, 'the status cannot be written directly');
select pg_temp.act_as('admin');
select throws_ok(
  $$insert into public.reports (workspace_id, title, status) values (pg_temp.id('w1'), 'Rapport direct', 'final')$$,
  '42501', null, 'a report cannot be created with another status than draft');
select lives_ok(
  $$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport annexe')$$,
  'managers still create reports, as drafts');

-- Submitting for review ------------------------------------------------------------
select lives_ok($$select pg_temp.move('admin', 'draft', 'in_review')$$, 'an admin submits a draft for review');
select is(pg_temp.report_status(pg_temp.id('r1')), 'in_review', 'the report is in review');
select results_eq(
  $$select from_status::text, to_status::text, changed_by from public.report_status_events
    where id = pg_temp.kept_id('in_review')$$,
  $$values ('draft', 'in_review', pg_temp.id('admin'))$$,
  'the change is recorded with who made it');
select is(
  (select ids from kept where name = 'in_review'),
  (select array_agg(x order by x) from unnest(array[pg_temp.id('owner'), pg_temp.id('expert'), pg_temp.id('expert2')]) x),
  'the owner and the experts of the report are told, not the admin who made the change nor the viewer');
select is(
  (select count(*)::integer from public.notifications where event_id = pg_temp.kept_id('in_review')),
  3, 'one notification per person told');

-- Reading notifications -----------------------------------------------------------
select pg_temp.act_as('expert');
select results_eq(
  $$select user_id, read_at is null from public.notifications$$,
  $$values (pg_temp.id('expert'), true)$$,
  'an expert reads their own notification only');
select is((select count(*)::integer from public.report_status_events where report_id = pg_temp.id('r1')), 1,
  'members read the history of the report');
select is(pg_temp.affected($$update public.notifications set read_at = now() where user_id = pg_temp.id('expert')$$),
  1, 'people mark their notifications as read');
select is(pg_temp.affected($$update public.notifications set read_at = now() where user_id = pg_temp.id('owner')$$),
  0, 'nor the notifications of others');
select throws_ok($$update public.notifications set user_id = pg_temp.id('expert2') where user_id = pg_temp.id('expert')$$,
  '42501', null, 'the read date is the only column people change');
select throws_ok(
  $$insert into public.notifications (workspace_id, user_id, event_id)
    values (pg_temp.id('w1'), pg_temp.id('expert'), pg_temp.kept_id('in_review'))$$,
  '42501', null, 'people cannot create notifications');
select throws_ok(
  $$insert into public.report_status_events (workspace_id, report_id, from_status, to_status)
    values (pg_temp.id('w1'), pg_temp.id('r1'), 'in_review', 'final')$$,
  '42501', null, 'people cannot write the history');
select pg_temp.act_as('outsider');
select is((select count(*)::integer from public.report_status_events), 0,
  'another workspace does not see the history');
select is((select count(*)::integer from public.notifications), 0,
  'another workspace does not see the notifications');

-- In review, the sections stay open
select pg_temp.act_as('expert');
select is(pg_temp.affected($$update public.report_sections set status = 'in_progress' where id = pg_temp.id('s1')$$),
  1, 'experts keep working on their sections during the review');

-- Sending back and finalizing -----------------------------------------------------
select pg_temp.act_as('admin');
select throws_ok($$select * from public.transition_report_status(pg_temp.id('r1'), 'in_review', 'final')$$,
  '42501', null, 'an admin cannot finalize a report');
select lives_ok($$select pg_temp.move('admin', 'in_review', 'draft')$$, 'an admin sends a report back to draft');
select lives_ok($$select pg_temp.move('admin', 'draft', 'in_review')$$, 'and submits it again');
select lives_ok($$select pg_temp.move('owner', 'in_review', 'final')$$, 'the owner finalizes the report');
select is(pg_temp.report_status(pg_temp.id('r1')), 'final', 'the report is final');
select is(
  (select ids from kept where name = 'final'),
  (select array_agg(x order by x) from unnest(array[pg_temp.id('admin'), pg_temp.id('expert'), pg_temp.id('expert2')]) x),
  'the admin and the experts are told the report is final');

-- A final report is frozen ---------------------------------------------------------
select pg_temp.act_as('expert');
select is(pg_temp.affected($$update public.report_sections set status = 'completed' where id = pg_temp.id('s1')$$),
  0, 'RLS rejects an expert''s change to a section of a final report');
select throws_ok(
  $$select public.save_section_content(pg_temp.id('s1'), 'Texte tardif',
      (select content_updated_at from public.report_sections where id = pg_temp.id('s1')))$$,
  'KR020', null, 'an expert cannot save the text of a section of a final report');
select throws_ok(
  $$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
    values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'),
      pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/tard.docx', 'tard.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000)$$,
  '42501', null, 'an expert cannot register a file in a final report');
select ok(
  not private.can_upload_deliverable(pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/d1-plan.docx'),
  'a file registered before the report became final cannot be sent');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.id('d1')$$),
  0, 'nor deleted');

select pg_temp.act_as('owner');
select is(pg_temp.affected($$update public.report_sections set title = 'Nouveau titre' where id = pg_temp.id('s1')$$),
  0, 'the owner cannot change a section of a final report either');
select throws_ok(
  $$select public.save_section_content(pg_temp.id('s3'), 'Texte du propriétaire',
      (select content_updated_at from public.report_sections where id = pg_temp.id('s3')))$$,
  'KR020', null, 'nor save its text');
select throws_ok(
  $$insert into public.report_sections (workspace_id, report_id, title) values (pg_temp.id('w1'), pg_temp.id('r1'), 'Ajout')$$,
  'KR020', null, 'nor add a section');
select is(pg_temp.affected($$delete from public.report_sections where id = pg_temp.id('s3')$$),
  0, 'nor delete one');
select throws_ok(
  $$select public.reorder_report_sections(pg_temp.id('r1'),
      array[pg_temp.id('s3'), pg_temp.id('s2'), pg_temp.id('s1')])$$,
  'KR020', null, 'nor reorder them');
select is(pg_temp.affected($$update public.reports set title = 'Titre change' where id = pg_temp.id('r1')$$),
  0, 'nor rename the report');

select pg_temp.act_as('admin');
select is(pg_temp.affected($$delete from public.reports where id = pg_temp.id('r1')$$),
  0, 'an admin cannot delete a final report');

-- The trigger stops writes that skip RLS, the service role included.
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$update public.report_sections set content = 'Par le service' where id = pg_temp.id('s1')$$,
  'KR020', null, 'the database refuses a change to a final report whoever makes it');
select throws_ok(
  $$insert into public.report_sections (workspace_id, report_id, title) values (pg_temp.id('w1'), pg_temp.id('r1'), 'Ajout')$$,
  'KR020', null, 'and a new section in it');

-- Removing an expert still unassigns their sections.
select lives_ok(
  $$delete from public.workspace_members where workspace_id = pg_temp.id('w1') and user_id = pg_temp.id('expert2')$$,
  'a member of a workspace with a final report can be removed');
select is((select assigned_to from public.report_sections where id = pg_temp.id('s2')), null,
  'and their sections of the final report are unassigned');

-- AI drafts wait for the report to reopen.
insert into public.ai_generations (workspace_id, section_id, requested_by, prompt_version_id, output_schema,
  schema_version, provider, model, estimated_tokens, status, output, completed_at)
values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.id('p_global'), 'section_draft',
  1, 'mock', 'mock', 100, 'succeeded', '{"content": "Brouillon"}', now())
returning id \gset ai_
select pg_temp.keep('generation', :'ai_id');
select pg_temp.act_as('expert');
select throws_ok(
  $$select public.accept_ai_generation(pg_temp.kept_id('generation'), 'Brouillon', 0, null)$$,
  'KR020', null, 'an AI draft cannot be accepted in a final report');

-- Reopening -------------------------------------------------------------------------
select pg_temp.act_as('admin');
select throws_ok($$select * from public.transition_report_status(pg_temp.id('r1'), 'final', 'draft')$$,
  '42501', null, 'an admin cannot reopen a final report');
select lives_ok($$select pg_temp.move('owner', 'final', 'draft')$$, 'the owner reopens the report');
select is(
  (select ids from kept where name = 'draft'),
  (select array_agg(x order by x) from unnest(array[pg_temp.id('admin'), pg_temp.id('expert')]) x),
  'the admin and the experts still assigned are told');
select pg_temp.act_as('expert');
select is(pg_temp.affected($$update public.report_sections set status = 'completed' where id = pg_temp.id('s1')$$),
  1, 'the expert writes their section again');
select lives_ok(
  $$select public.accept_ai_generation(pg_temp.kept_id('generation'), 'Brouillon', 0, null)$$,
  'and accepts the AI draft');
select is((select count(*)::integer from public.report_status_events where report_id = pg_temp.id('r1')), 5,
  'the history keeps every change');

-- Snapshots -------------------------------------------------------------------------
reset role;
insert into public.report_exports (workspace_id, report_id, format, file_name, kind, status_event_id)
values (pg_temp.id('w1'), pg_temp.id('r1'), 'pdf', 'final.pdf', 'final', pg_temp.kept_id('final'));
select throws_ok(
  $$insert into public.report_exports (workspace_id, report_id, format, file_name, kind, status_event_id)
    values (pg_temp.id('w1'), pg_temp.id('r1'), 'pdf', 'final-2.pdf', 'final', pg_temp.kept_id('final'))$$,
  '23505', null, 'one snapshot at a time per finalization');
update public.report_exports set status = 'failed' where status_event_id = pg_temp.kept_id('final');
select lives_ok(
  $$insert into public.report_exports (workspace_id, report_id, format, file_name, kind, status_event_id)
    values (pg_temp.id('w1'), pg_temp.id('r1'), 'pdf', 'final-2.pdf', 'final', pg_temp.kept_id('final'))$$,
  'a failed snapshot can be made again');
select throws_ok(
  $$insert into public.report_exports (workspace_id, report_id, format, file_name, kind)
    values (pg_temp.id('w1'), pg_temp.id('r1'), 'pdf', 'final-3.pdf', 'final')$$,
  '23514', null, 'a snapshot names the change that made the report final');

-- Deleting the report takes its history, notifications and snapshots along.
select lives_ok($$delete from public.reports where id = pg_temp.id('r1')$$, 'a report with a history can be deleted');
select is((select count(*)::integer from public.notifications where workspace_id = pg_temp.id('w1')), 0,
  'its notifications go with it');

-- Signed-out visitors -------------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok('select * from public.notifications', '42501', null, 'anon cannot read notifications');
select throws_ok('select * from public.report_status_events', '42501', null, 'anon cannot read report_status_events');
select throws_ok($$select * from public.transition_report_status(pg_temp.id('r2'), 'draft', 'in_review')$$,
  '42501', null, 'anon cannot change a status');

select * from finish();
rollback;
