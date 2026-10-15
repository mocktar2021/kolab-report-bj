begin;
\ir fixtures.psql
select plan(45);

-- KRB-166: deleted rows queue their stored files, the cleanup job removes them.

create or replace function pg_temp.queued(bucket_name text) returns setof text
language sql as $$
  select q.path from private.storage_cleanup_queue q where q.bucket = bucket_name order by q.path
$$;

create or replace function pg_temp.export(report text, workspace text, name text, kind text, age interval)
returns void
language sql as $$
  insert into public.report_exports
    (workspace_id, report_id, format, file_name, status, storage_path, size_bytes, section_count, finished_at, created_at, kind)
  values (pg_temp.id(workspace), pg_temp.id(report), 'pdf', name || '.pdf', 'ready',
          pg_temp.id(workspace) || '/' || pg_temp.id(report) || '/' || name || '.pdf', 1200, 3,
          now() - age, now() - age, kind)
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- Rows queued by other work on this database do not count here.
delete from private.storage_cleanup_queue;

-- Structure ---------------------------------------------------------------------
select has_table('private', 'storage_cleanup_queue', 'the queue lives in the private schema');
select has_trigger('public', 'deliverables', 'queue_storage_cleanup', 'deleting a deliverable queues its file');
select has_trigger('public', 'report_exports', 'queue_storage_cleanup', 'deleting an export queues its file');
select is_definer('private', 'queue_storage_cleanup', array[]::text[], 'the trigger writes the queue with the owner''s rights');
select is_definer('public', 'claim_storage_cleanup', array['integer'], 'claim_storage_cleanup is security definer');
select is_definer('public', 'finish_storage_cleanup', array['bigint[]', 'text'], 'finish_storage_cleanup is security definer');
select is_definer('public', 'expire_report_exports', array['integer'], 'expire_report_exports is security definer');
select is(
  (select count(*)::integer from pg_proc
   where oid in ('private.queue_storage_cleanup()'::regprocedure,
                 'public.claim_storage_cleanup(integer)'::regprocedure,
                 'public.finish_storage_cleanup(bigint[], text)'::regprocedure,
                 'public.expire_report_exports(integer)'::regprocedure)
     and proconfig @> array['search_path=""']),
  4, 'every function runs with an empty search_path');

-- Nobody but the job ------------------------------------------------------------
select pg_temp.act_as('owner');
select throws_ok($$select * from private.storage_cleanup_queue$$, '42501', null, 'users cannot read the queue');
select throws_ok($$insert into private.storage_cleanup_queue (bucket, path) values ('exports', 'x')$$,
  '42501', null, 'users cannot add to the queue');
select throws_ok($$select * from public.claim_storage_cleanup(10)$$, '42501', null, 'users cannot claim paths');
select throws_ok($$select public.finish_storage_cleanup(array[1]::bigint[])$$, '42501', null, 'users cannot clear paths');
select throws_ok($$select public.expire_report_exports(1)$$, '42501', null, 'users cannot expire exports');

select pg_temp.act_as_anon();
select throws_ok($$select * from private.storage_cleanup_queue$$, '42501', null, 'visitors cannot read the queue');
select throws_ok($$select * from public.claim_storage_cleanup(10)$$, '42501', null, 'visitors cannot claim paths');
select throws_ok($$select public.expire_report_exports(1)$$, '42501', null, 'visitors cannot expire exports');

reset role;
set local role service_role;
select throws_ok($$select * from private.storage_cleanup_queue$$, '42501', null,
  'the service role goes through the functions too');

-- Deleting one deliverable -------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.act_as('expert');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.id('d1')$$), 1,
  'the expert deletes their file');
reset role;
select results_eq($$select * from pg_temp.queued('deliverables')$$,
  $$values (pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/d1-plan.docx')$$,
  'its path is queued in the deliverables bucket');
select is((select not_before from private.storage_cleanup_queue where bucket = 'deliverables'),
  now() + interval '2 hours 15 minutes',
  'a file registered just now waits until its signed upload URL has expired');

-- Deleting one export ------------------------------------------------------------
select pg_temp.export('r1', 'w1', 'manuel-1', 'manual', '1 day');
insert into public.report_exports (workspace_id, report_id, format, file_name, created_by)
values (pg_temp.id('w1'), pg_temp.id('r1'), 'docx', 'en-cours.docx', pg_temp.id('admin'));
delete from public.report_exports where file_name in ('manuel-1.pdf', 'en-cours.docx');
select results_eq($$select * from pg_temp.queued('exports')$$,
  $$values (pg_temp.id('w1') || '/' || pg_temp.id('r1') || '/manuel-1.pdf')$$,
  'a deleted export queues its file, a pending one has none yet');
select is((select not_before from private.storage_cleanup_queue where bucket = 'exports'), now(),
  'an export file can go right away');

-- Paths outside the shape the app writes -------------------------------------
select pg_temp.act_as('expert');
select throws_ok(
  $$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
    values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'),
      pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/../../' || pg_temp.id('w2') || '/' || pg_temp.id('s4') || '/cible.docx',
      'cible.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10)$$,
  '23514', null, 'a deliverable path cannot climb out of its section');
reset role;
delete from private.storage_cleanup_queue;
insert into public.report_exports (workspace_id, report_id, format, file_name, created_by, status, storage_path,
  size_bytes, section_count, finished_at)
values (pg_temp.id('w1'), pg_temp.id('r1'), 'pdf', 'hors-forme.pdf', pg_temp.id('admin'), 'ready',
  pg_temp.id('w1') || '/../hors-forme.pdf', 10, 1, now());
delete from public.report_exports where file_name = 'hors-forme.pdf';
select is((select count(*)::integer from private.storage_cleanup_queue), 0,
  'a path of another shape is never queued for the service role to remove');

-- Deleting a whole report --------------------------------------------------------
delete from private.storage_cleanup_queue;
insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, uploaded_at, created_at)
values
  (pg_temp.id('w1'), pg_temp.id('s2'), pg_temp.id('expert2'), pg_temp.id('w1') || '/' || pg_temp.id('s2') || '/a-mesures.csv',
   'mesures.csv', 'text/csv', 10, now() - interval '3 days', now() - interval '3 days'),
  (pg_temp.id('w1'), pg_temp.id('s3'), pg_temp.id('admin'), pg_temp.id('w1') || '/' || pg_temp.id('s3') || '/b-annexe.pdf',
   'annexe.pdf', 'application/pdf', 10, null, now() - interval '3 days');
insert into public.report_status_events (id, workspace_id, report_id, from_status, to_status)
values ('00000000-0000-4000-8000-000000000001', pg_temp.id('w1'), pg_temp.id('r1'), 'in_review', 'final');
select pg_temp.export('r1', 'w1', 'manuel-2', 'manual', '2 days');
insert into public.report_exports
  (workspace_id, report_id, format, file_name, status, storage_path, size_bytes, section_count, finished_at, kind, status_event_id)
values (pg_temp.id('w1'), pg_temp.id('r1'), 'pdf', 'final.pdf', 'ready',
        pg_temp.id('w1') || '/' || pg_temp.id('r1') || '/final.pdf', 1200, 3, now(), 'final',
        '00000000-0000-4000-8000-000000000001');

select pg_temp.act_as('owner');
select is(public.delete_report(pg_temp.id('r1')) ->> 'sections', '3', 'the owner deletes the report (KRB-180)');
reset role;
select results_eq($$select * from pg_temp.queued('deliverables')$$,
  $$values (pg_temp.id('w1') || '/' || pg_temp.id('s2') || '/a-mesures.csv'),
           (pg_temp.id('w1') || '/' || pg_temp.id('s3') || '/b-annexe.pdf')$$,
  'the files of its sections are queued, sent or not');
select results_eq($$select * from pg_temp.queued('exports')$$,
  $$values (pg_temp.id('w1') || '/' || pg_temp.id('r1') || '/final.pdf'),
           (pg_temp.id('w1') || '/' || pg_temp.id('r1') || '/manuel-2.pdf')$$,
  'its exports and its final snapshot are queued');
select is((select count(*)::integer from private.storage_cleanup_queue where not_before > now()), 0,
  'files registered days ago can go right away');

-- Deleting a whole workspace -----------------------------------------------------
delete from private.storage_cleanup_queue;
insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, uploaded_at)
values (pg_temp.id('w2'), pg_temp.id('s4'), pg_temp.id('outsider'), pg_temp.id('w2') || '/' || pg_temp.id('s4') || '/c-synthese.docx',
        'synthese.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10, now());
select pg_temp.export('r2', 'w2', 'manuel-b', 'manual', '1 hour');

select pg_temp.act_as('outsider');
select is(public.delete_workspace(pg_temp.id('w2'), 'Etude B') ->> 'reports', '1',
  'the owner of the other workspace deletes it');
reset role;
select results_eq(
  $$select bucket, path from private.storage_cleanup_queue order by bucket$$,
  $$values ('deliverables', pg_temp.id('w2') || '/' || pg_temp.id('s4') || '/c-synthese.docx'),
           ('exports', pg_temp.id('w2') || '/' || pg_temp.id('r2') || '/manuel-b.pdf')$$,
  'every file of the workspace is queued');

-- The same path queued twice -------------------------------------------------------
-- A new report in w1, for this test and the retention one below.
insert into public.reports (id, workspace_id, title) values (pg_temp.id('r2'), pg_temp.id('w1'), 'Rapport C');
insert into public.report_sections (id, workspace_id, report_id, title)
values (pg_temp.id('s4'), pg_temp.id('w1'), pg_temp.id('r2'), 'Reprise');
delete from private.storage_cleanup_queue;
insert into private.storage_cleanup_queue (bucket, path, not_before)
values ('deliverables', pg_temp.id('w1') || '/' || pg_temp.id('s4') || '/z-reprise.pdf', now() - interval '1 hour');
insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
values (pg_temp.id('w1'), pg_temp.id('s4'), pg_temp.id('owner'),
        pg_temp.id('w1') || '/' || pg_temp.id('s4') || '/z-reprise.pdf', 'reprise.pdf', 'application/pdf', 10);
delete from public.deliverables where section_id = pg_temp.id('s4');
select results_eq(
  $$select count(*)::integer, max(not_before) from private.storage_cleanup_queue$$,
  $$values (1, now() + interval '2 hours 15 minutes')$$,
  'a path queued again stays one entry and waits for the later upload window');

-- Claiming --------------------------------------------------------------------------
delete from private.storage_cleanup_queue;
insert into private.storage_cleanup_queue (bucket, path, not_before) values
  ('exports', 'w/r/1.pdf', now() - interval '3 hours'),
  ('deliverables', 'w/s/2.docx', now() - interval '2 hours'),
  ('exports', 'w/r/3.docx', now() - interval '1 hour'),
  ('deliverables', 'w/s/4.csv', now() + interval '1 hour');

set local role service_role;
select throws_ok($$select * from public.claim_storage_cleanup(0)$$, '22023', null, 'a batch takes at least one path');
select throws_ok($$select * from public.claim_storage_cleanup(1001)$$, '22023', null, 'and at most 1000');
select results_eq($$select bucket, path from public.claim_storage_cleanup(2) order by path$$,
  $$values ('exports', 'w/r/1.pdf'), ('deliverables', 'w/s/2.docx')$$,
  'the service role claims the oldest paths that are due');
select results_eq($$select bucket, path from public.claim_storage_cleanup(10)$$,
  $$values ('exports', 'w/r/3.docx')$$,
  'a claimed path is held, and one not due yet waits');
select is((select count(*)::integer from public.claim_storage_cleanup(10)), 0, 'nothing else is due');

reset role;
select results_eq(
  $$select path, attempts, not_before from private.storage_cleanup_queue where attempts > 0 order by path$$,
  $$values ('w/r/1.pdf', 1, now() + interval '15 minutes'),
           ('w/r/3.docx', 1, now() + interval '15 minutes'),
           ('w/s/2.docx', 1, now() + interval '15 minutes')$$,
  'a claim counts the attempt and holds the path for 15 minutes');

-- Finishing ---------------------------------------------------------------------------
create temp table claimed as select id, path from private.storage_cleanup_queue;
grant select on claimed to service_role;
set local role service_role;
select is(public.finish_storage_cleanup((select array_agg(id) from claimed where path = 'w/r/1.pdf')), 1,
  'a removed path is finished');
select is(
  public.finish_storage_cleanup((select array_agg(id) from claimed where path in ('w/s/2.docx', 'w/r/3.docx')), 'Storage error'),
  2, 'a failed removal is recorded');
reset role;
select results_eq(
  $$select path, last_error from private.storage_cleanup_queue order by path$$,
  $$values ('w/r/3.docx', 'Storage error'), ('w/s/2.docx', 'Storage error'), ('w/s/4.csv', null)$$,
  'finished paths leave the queue, failed ones stay with their error');
update private.storage_cleanup_queue set not_before = now() - interval '1 second' where last_error is not null;
set local role service_role;
select is((select count(*)::integer from public.claim_storage_cleanup(10)), 2,
  'failed paths come back once their hold ends');

-- Export retention --------------------------------------------------------------------
reset role;
delete from private.storage_cleanup_queue;
insert into public.report_status_events (id, workspace_id, report_id, from_status, to_status)
values ('00000000-0000-4000-8000-000000000002', pg_temp.id('w1'), pg_temp.id('r2'), 'in_review', 'final');
select pg_temp.export('r2', 'w1', 'ancien', 'manual', '91 days');
select pg_temp.export('r2', 'w1', 'recent', 'manual', '89 days');
insert into public.report_exports
  (workspace_id, report_id, format, file_name, status, storage_path, size_bytes, section_count, finished_at, created_at, kind, status_event_id)
values (pg_temp.id('w1'), pg_temp.id('r2'), 'pdf', 'final.pdf', 'ready',
        pg_temp.id('w1') || '/' || pg_temp.id('r2') || '/final.pdf', 1200, 3, now() - interval '200 days',
        now() - interval '200 days', 'final', '00000000-0000-4000-8000-000000000002');
insert into public.report_exports (workspace_id, report_id, format, file_name, status, finished_at, created_at)
values (pg_temp.id('w1'), pg_temp.id('r2'), 'docx', 'echec.docx', 'failed', now() - interval '120 days', now() - interval '120 days');

set local role service_role;
select throws_ok($$select public.expire_report_exports(0)$$, '22023', null, 'the retention is at least one day');
select is(public.expire_report_exports(90), 2, 'the service role expires manual exports older than 90 days');
reset role;
select results_eq(
  $$select file_name from public.report_exports where report_id = pg_temp.id('r2') order by file_name$$,
  $$values ('final.pdf'), ('recent.pdf')$$,
  'recent exports and final snapshots stay');
select results_eq($$select * from pg_temp.queued('exports')$$,
  $$values (pg_temp.id('w1') || '/' || pg_temp.id('r2') || '/ancien.pdf')$$,
  'the expired file is queued for removal');

select * from finish();
rollback;
