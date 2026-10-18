-- The annexes of an export (KRB-215): report_exports.with_annexes and the
-- option of claim_report_export. The other claim rules are in
-- master_report_test.sql.
begin;
\ir fixtures.psql
select plan(17);

-- The column and the function -------------------------------------------------------
select pg_temp.act_as_server();
select is(
  (select is_nullable::text || ' ' || column_default::text
   from information_schema.columns
   where table_schema = 'public' and table_name = 'report_exports' and column_name = 'with_annexes'),
  'NO false', 'with_annexes is never null and false when left out');

-- An export recorded the way it was before KRB-215, without the option.
insert into public.report_exports (workspace_id, report_id, format, file_name, status, storage_path, size_bytes, section_count, finished_at)
values (pg_temp.id('w1'), pg_temp.id('r1'), 'docx', 'rapport-ancien.docx', 'ready',
        pg_temp.id('w1') || '/' || pg_temp.id('r1') || '/ancien.docx', 1200, 3, now());
select is((select with_annexes from public.report_exports where file_name = 'rapport-ancien.docx'), false,
  'an export recorded without the option has no annexes');

select ok(to_regprocedure('public.claim_report_export(uuid, uuid, text, text, integer)') is null,
  'the five-argument claim is gone, so PostgREST has one function to call');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.claim_report_export(uuid, uuid, text, text, integer, boolean)'::regprocedure),
  'the claim is security definer with an empty search_path');
select ok(
  not has_function_privilege('authenticated', 'public.claim_report_export(uuid, uuid, text, text, integer, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.claim_report_export(uuid, uuid, text, text, integer, boolean)', 'execute'),
  'users and visitors cannot call the claim');
select ok(
  has_function_privilege('service_role', 'public.claim_report_export(uuid, uuid, text, text, integer, boolean)', 'execute'),
  'the service role can');

-- Claiming with and without the annexes ---------------------------------------------
create temp table claimed (name text primary key, id uuid);
create or replace function pg_temp.annexes_of(claim text) returns boolean
language sql as $$
  select e.with_annexes from public.report_exports e where e.id = (select c.id from claimed c where c.name = claim);
$$;
create or replace function pg_temp.fail(claim text) returns void
language sql as $$
  update public.report_exports set status = 'failed', finished_at = now()
  where id = (select c.id from claimed c where c.name = claim);
$$;

insert into claimed
select 'with', export_id from public.claim_report_export(pg_temp.id('r1'), pg_temp.id('admin'), 'pdf', 'rapport-a.pdf', 10, true);
select is(pg_temp.annexes_of('with'), true, 'an export asked with the annexes records it');
select pg_temp.fail('with');

insert into claimed
select 'without', export_id from public.claim_report_export(pg_temp.id('r1'), pg_temp.id('admin'), 'pdf', 'rapport-a.pdf', 10, false);
select is(pg_temp.annexes_of('without'), false, 'an export asked without them records that');
select pg_temp.fail('without');

insert into claimed
select 'old app', export_id from public.claim_report_export(pg_temp.id('r1'), pg_temp.id('admin'), 'docx', 'rapport-a.docx', 10);
select is(pg_temp.annexes_of('old app'), false,
  'a claim without the option, from the app version before, has no annexes like its file');
select pg_temp.fail('old app');

insert into claimed
select 'null', export_id from public.claim_report_export(pg_temp.id('r1'), pg_temp.id('admin'), 'docx', 'rapport-a.docx', 10, null);
select is(pg_temp.annexes_of('null'), false, 'a null option has no annexes');
select is(
  (select refusal from public.claim_report_export(pg_temp.id('r1'), pg_temp.id('admin'), 'pdf', 'rapport-a.pdf', 10, true)),
  'busy', 'the option changes none of the claim rules: one export at a time');

-- RLS does not change ---------------------------------------------------------------
select pg_temp.act_as('admin');
select is((select count(*)::int from public.report_exports where with_annexes), 1,
  'owners and admins read the option of their exports');
select throws_ok(
  $$update public.report_exports set with_annexes = true$$,
  '42501', null, 'users cannot change it');
select throws_ok(
  $$select * from public.claim_report_export(pg_temp.id('r1'), pg_temp.id('admin'), 'pdf', 'x.pdf', 10, true)$$,
  '42501', null, 'users cannot claim exports themselves');
select pg_temp.act_as('expert');
select is((select count(*)::int from public.report_exports), 0, 'experts still read no export');

-- The files the annexes list, read with the user's rights ---------------------------
select pg_temp.act_as_server();
update public.deliverables set uploaded_at = now() where id = pg_temp.id('d1');
create or replace function pg_temp.report_files(report uuid) returns integer
language sql as $$
  select count(*)::integer
  from public.deliverables d
  join public.report_sections s on s.id = d.section_id
  where s.report_id = report and d.uploaded_at is not null;
$$;
select pg_temp.act_as('admin');
select is(pg_temp.report_files(pg_temp.id('r1')), 1, 'a manager reads the uploaded files of the report');
select pg_temp.act_as('outsider');
select is(pg_temp.report_files(pg_temp.id('r1')), 0, 'someone outside the workspace reads none');

select * from finish();
rollback;
