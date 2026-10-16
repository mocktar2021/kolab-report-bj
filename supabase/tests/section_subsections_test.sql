-- Subsections, reordering by level, and deleting a section (KRB-195).
begin;
\ir fixtures.psql
select plan(37);

-- A second report in w1, to check that a parent stays in its own report.
insert into public.reports (id, workspace_id, title, created_by) values
  ('00000000-0000-4000-d000-000000000003', pg_temp.id('w1'), 'Rapport A bis', pg_temp.id('owner'));
insert into public.report_sections (id, workspace_id, report_id, title) values
  ('00000000-0000-4000-e000-000000000005', pg_temp.id('w1'), '00000000-0000-4000-d000-000000000003', 'Ailleurs');
update public.deliverables set uploaded_at = now() where id = pg_temp.id('d1');

-- Adding subsections ---------------------------------------------------------------
select pg_temp.act_as('owner');
select lives_ok(
  $$insert into public.report_sections (id, workspace_id, report_id, parent_id, title, position) values
    ('00000000-0000-4000-e000-0000000000a1', pg_temp.id('w1'), pg_temp.id('r1'), pg_temp.id('s1'), 'Objectifs', 0),
    ('00000000-0000-4000-e000-0000000000a2', pg_temp.id('w1'), pg_temp.id('r1'), pg_temp.id('s1'), 'Périmètre', 1)$$,
  'the owner adds two subsections under a section');
select is(
  (select count(*)::int from public.report_sections where parent_id = pg_temp.id('s1')), 2,
  'they belong to that section');
select throws_ok(
  $$insert into public.report_sections (workspace_id, report_id, parent_id, title) values
    (pg_temp.id('w1'), pg_temp.id('r1'), '00000000-0000-4000-e000-0000000000a1', 'Trop profond')$$,
  'KR051', null, 'a subsection has no subsections');
select throws_ok(
  $$insert into public.report_sections (workspace_id, report_id, parent_id, title) values
    (pg_temp.id('w1'), pg_temp.id('r1'), '00000000-0000-4000-e000-000000000005', 'Autre rapport')$$,
  'KR050', null, 'the parent must be in the same report');
select throws_ok(
  $$insert into public.report_sections (workspace_id, report_id, parent_id, title) values
    (pg_temp.id('w1'), pg_temp.id('r1'), pg_temp.id('s4'), 'Autre espace')$$,
  'KR050', 'La section parente n''est pas dans ce rapport',
  'a parent in another workspace answers like a missing one');
select throws_ok(
  $$insert into public.report_sections (id, workspace_id, report_id, parent_id, title) values
    ('00000000-0000-4000-e000-0000000000a9', pg_temp.id('w1'), pg_temp.id('r1'),
     '00000000-0000-4000-e000-0000000000a9', 'Elle-même')$$,
  'KR051', null, 'a section is not its own subsection');
select throws_ok(
  $$update public.report_sections set parent_id = pg_temp.id('s2') where id = pg_temp.id('s3')$$,
  '42501', null, 'the parent of a section does not change from the app');

select pg_temp.act_as('expert');
select throws_ok(
  $$insert into public.report_sections (workspace_id, report_id, parent_id, title) values
    (pg_temp.id('w1'), pg_temp.id('r1'), pg_temp.id('s1'), 'Par un expert')$$,
  '42501', null, 'an expert cannot add a subsection');

select pg_temp.act_as('outsider');
select throws_ok(
  $$insert into public.report_sections (workspace_id, report_id, parent_id, title) values
    (pg_temp.id('w1'), pg_temp.id('r1'), '00000000-0000-4000-e000-0000000000a1', 'Sonde')$$,
  '42501', null, 'someone outside the workspace gets the usual refusal, not the parent rules');
select throws_ok(
  $$insert into public.report_sections (workspace_id, report_id, parent_id, title) values
    (pg_temp.id('w1'), pg_temp.id('r1'), '00000000-0000-4000-e000-00000000ffff', 'Sonde')$$,
  '42501', null, 'whether the parent exists or not');

select pg_temp.act_as_server();
select throws_ok(
  $$update public.report_sections set parent_id = pg_temp.id('s2') where id = pg_temp.id('s1')$$,
  'KR051', null, 'even the server cannot put a section that has subsections under another one');

-- Title and instructions ------------------------------------------------------------
select pg_temp.act_as('admin');
select is(pg_temp.affected(
  $$update public.report_sections set title = 'Objectifs de l''étude', instructions = 'Rappeler les trois objectifs.'
    where id = '00000000-0000-4000-e000-0000000000a1'$$),
  1, 'an admin renames a subsection and writes its instructions');
select throws_ok(
  $$update public.report_sections set instructions = repeat('a', 4001) where id = pg_temp.id('s3')$$,
  '23514', null, 'instructions hold at most 4000 characters');
select ok(
  (select convalidated from pg_catalog.pg_constraint where conname = 'report_sections_instructions_length'),
  'and every row was checked when the limit came');

select pg_temp.act_as('expert');
select throws_ok(
  $$update public.report_sections set instructions = 'Autre consigne' where id = pg_temp.id('s1')$$,
  '42501', null, 'an expert cannot change the instructions of their section');

-- Reordering, level by level --------------------------------------------------------
select pg_temp.act_as('owner');
select lives_ok(
  $$select public.reorder_report_sections(pg_temp.id('r1'), array[
      pg_temp.id('s2'), pg_temp.id('s1'),
      '00000000-0000-4000-e000-0000000000a2'::uuid, '00000000-0000-4000-e000-0000000000a1'::uuid,
      pg_temp.id('s3')])$$,
  'the owner reorders sections and subsections in one list');
select results_eq(
  $$select title, position from public.report_sections where report_id = pg_temp.id('r1') and parent_id is null
    order by position$$,
  $$values ('Analyse'::text, 0), ('Contexte', 1), ('Annexes', 2)$$,
  'sections are numbered among sections');
select results_eq(
  $$select title, position from public.report_sections where parent_id = pg_temp.id('s1') order by position$$,
  $$values ('Périmètre'::text, 0), ('Objectifs de l''étude', 1)$$,
  'subsections are numbered within their section');
select throws_ok(
  $$select public.reorder_report_sections(pg_temp.id('r1'), array[pg_temp.id('s1'), pg_temp.id('s2'), pg_temp.id('s3')])$$,
  '40001', null, 'a list without the subsections is out of date');

-- Deleting ------------------------------------------------------------------------
select throws_ok(
  $$delete from public.report_sections where id = pg_temp.id('s3')$$,
  '42501', null, 'a section is not deleted directly');
select is(
  (select public.section_deletion_preview(pg_temp.id('s1')) - 'section_id' - 'workspace_id' - 'report_id'),
  jsonb_build_object('parent_id', null, 'title', 'Contexte', 'report_status', 'draft',
    'subsections', 2, 'files', 1, 'with_text', 0),
  'the preview names the subsections and files that go with a section');

select pg_temp.act_as('expert');
select is(public.section_deletion_preview(pg_temp.id('s1')), null, 'an expert gets no preview');
select throws_ok($$select public.delete_report_section(pg_temp.id('s1'))$$,
  '42501', null, 'an expert cannot delete their section');

select pg_temp.act_as('outsider');
select throws_ok($$select public.delete_report_section(pg_temp.id('s1'))$$,
  'P0002', null, 'someone outside the workspace finds no section');

select pg_temp.act_as('admin');
select is(
  (select public.delete_report_section('00000000-0000-4000-e000-0000000000a2') ->> 'subsections')::int, 0,
  'an admin deletes a subsection');
select is(
  (select count(*)::int from public.report_sections where parent_id = pg_temp.id('s1')), 1,
  'its section keeps the other subsection');

select pg_temp.act_as('owner');
select is(
  (select public.delete_report_section(pg_temp.id('s1')) - 'section_id' - 'actor_role'),
  jsonb_build_object('parent_id', null,
    'subsections', 1, 'files', 1, 'with_text', 0, 'files_queued', 1),
  'the owner deletes a section with its subsection and its file');
select is(
  (select count(*)::int from public.report_sections
   where id in (pg_temp.id('s1'), '00000000-0000-4000-e000-0000000000a1')), 0,
  'the section and its subsection are gone');
select is((select count(*)::int from public.deliverables where id = pg_temp.id('d1')), 0, 'and so is the file row');

select pg_temp.act_as_server();
select is(
  (select count(*)::int from private.storage_cleanup_queue
   where bucket = 'deliverables' and path = pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/d1-plan.docx'),
  1, 'the stored file is queued for removal');
select is(
  (select count(*)::int from private.audit_events
   where action = 'section_deleted' and report_id = pg_temp.id('r1') and actor_id = pg_temp.id('owner')),
  1, 'the deletion is recorded');
select is(
  (select count(*)::int from private.audit_events where action = 'section_deleted' and report_id = pg_temp.id('r1')),
  2, 'one record per deletion');
select is(
  (select count(*)::int from private.audit_events
   where action = 'section_deleted' and report_id = pg_temp.id('r1') and details ? 'title'),
  0, 'without the title of the section');

-- A final report keeps its sections -----------------------------------------------
update public.reports set status = 'final' where id = pg_temp.id('r1');
select pg_temp.act_as('owner');
select throws_ok($$select public.delete_report_section(pg_temp.id('s3'))$$,
  'KR020', null, 'nobody deletes a section of a final report');
select throws_ok(
  $$insert into public.report_sections (workspace_id, report_id, parent_id, title) values
    (pg_temp.id('w1'), pg_temp.id('r1'), pg_temp.id('s2'), 'Ajout tardif')$$,
  'KR020', null, 'nor adds a subsection to it');
select is(
  (select (public.section_deletion_preview(pg_temp.id('s3')) ->> 'report_status')), 'final',
  'the preview says the report is final');

select pg_temp.act_as_anon();
select throws_ok($$select public.delete_report_section(pg_temp.id('s3'))$$,
  '42501', null, 'a visitor cannot call the deletion');

select * from finish();
rollback;
