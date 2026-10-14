begin;
\ir fixtures.psql
select plan(46);

create temp table versions (name text primary key, at timestamptz);
grant all on versions to authenticated, anon;

create or replace function pg_temp.version_of(section uuid) returns timestamptz
language sql as $$ select content_updated_at from public.report_sections where id = section $$;

create or replace function pg_temp.keep(name text, at timestamptz) returns void
language sql as $$ insert into versions values (name, at) on conflict (name) do update set at = excluded.at $$;

create or replace function pg_temp.kept(name text) returns timestamptz
language sql as $$ select at from versions where versions.name = $1 $$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- Text version --------------------------------------------------------------------
select has_column('public', 'report_sections', 'content_updated_at', 'sections keep the version of their text');

select pg_temp.keep('s1', pg_temp.version_of(pg_temp.id('s1')));
update public.report_sections set position = 7, title = 'Contexte general' where id = pg_temp.id('s1');
select is(pg_temp.version_of(pg_temp.id('s1')), pg_temp.kept('s1'),
  'moving or renaming a section keeps its text version');

update public.report_sections set content = 'Nouveau texte' where id = pg_temp.id('s1');
select ok(pg_temp.version_of(pg_temp.id('s1')) > pg_temp.kept('s1'), 'changing the text moves the version');
select pg_temp.keep('s1', pg_temp.version_of(pg_temp.id('s1')));

select pg_temp.act_as('expert');
select throws_ok($$update public.report_sections set content_updated_at = '2000-01-01' where id = pg_temp.id('s1')$$,
  '42501', null, 'users cannot set the version themselves');
select throws_ok($$update public.report_sections set content = 'Sans version' where id = pg_temp.id('s1')$$,
  '42501', null, 'users cannot write the text without the version check');

reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$update public.report_sections set content = repeat('a', 100001) where id = pg_temp.id('s1')$$,
  '23514', null, 'the table refuses text longer than 100 000 characters');

-- Saving the text -----------------------------------------------------------------
reset role;
update public.report_sections set content = null, status = 'not_started' where id = pg_temp.id('s1');
select pg_temp.keep('s1', pg_temp.version_of(pg_temp.id('s1')));

select pg_temp.act_as('expert');
select ok(
  public.save_section_content(pg_temp.id('s1'), 'Premier jet', pg_temp.kept('s1')) > pg_temp.kept('s1'),
  'the assigned expert saves the text and gets the new version');
select results_eq(
  $$select content, status::text from public.report_sections where id = pg_temp.id('s1')$$,
  $$values ('Premier jet', 'in_progress')$$,
  'the text is saved and a section not started moves to in progress');
select throws_ok(
  $$select public.save_section_content(pg_temp.id('s1'), 'Texte perime', pg_temp.kept('s1'))$$,
  '40001', null, 'saving over a newer version is refused');
select is((select content from public.report_sections where id = pg_temp.id('s1')), 'Premier jet',
  'the refused save wrote nothing');
select throws_ok(
  $$select public.save_section_content(pg_temp.id('s1'), 'x', null)$$,
  '40001', null, 'a save without a version is refused');

select pg_temp.act_as('expert2');
select throws_ok(
  $$select public.save_section_content(pg_temp.id('s1'), 'x', pg_temp.version_of(pg_temp.id('s1')))$$,
  '42501', null, 'another expert cannot save a section that is not theirs');
select pg_temp.act_as('viewer');
select throws_ok(
  $$select public.save_section_content(pg_temp.id('s1'), 'x', pg_temp.version_of(pg_temp.id('s1')))$$,
  '42501', null, 'a viewer cannot save');
select pg_temp.act_as('outsider');
select throws_ok(
  $$select public.save_section_content(pg_temp.id('s1'), 'x', now())$$,
  'P0002', null, 'another workspace does not see the section');
select pg_temp.act_as_anon();
select throws_ok(
  $$select public.save_section_content(pg_temp.id('s1'), 'x', now())$$,
  '42501', null, 'visitors cannot call it');

reset role;
select pg_temp.keep('s1', pg_temp.version_of(pg_temp.id('s1')));
select pg_temp.act_as('admin');
select lives_ok(
  $$select public.save_section_content(pg_temp.id('s1'), 'Relu par l''admin', pg_temp.kept('s1'))$$,
  'an admin saves any section of the workspace');
select throws_ok(
  $$select public.save_section_content(pg_temp.id('s1'), repeat('a', 100001), pg_temp.version_of(pg_temp.id('s1')))$$,
  '22023', null, 'text longer than 100 000 characters is refused');
select lives_ok(
  $$select public.save_section_content(pg_temp.id('s1'), '   ', pg_temp.version_of(pg_temp.id('s1')))$$,
  'blank text clears the section');
select results_eq(
  $$select content, status::text from public.report_sections where id = pg_temp.id('s1')$$,
  $$values (null::text, 'in_progress')$$,
  'the section is empty and keeps its status');

-- Two sections, two people ---------------------------------------------------------
select pg_temp.act_as('expert2');
select lives_ok(
  $$select public.save_section_content(pg_temp.id('s2'), 'Analyse detaillee', pg_temp.version_of(pg_temp.id('s2')))$$,
  'another expert saves their own section meanwhile');
select pg_temp.act_as('expert');
select lives_ok(
  $$select public.save_section_content(pg_temp.id('s1'), 'Contexte complet', pg_temp.version_of(pg_temp.id('s1')))$$,
  'saving one section does not block another');
select results_eq(
  $$select content from public.report_sections where id in (pg_temp.id('s1'), pg_temp.id('s2')) order by id$$,
  $$values ('Contexte complet'), ('Analyse detaillee')$$,
  'each section keeps its own text');

-- Reordering ------------------------------------------------------------------------
reset role;
select pg_temp.keep('s1', pg_temp.version_of(pg_temp.id('s1')));
select pg_temp.act_as('expert');
select throws_ok(
  $$select public.reorder_report_sections(pg_temp.id('r1'), array[pg_temp.id('s3'), pg_temp.id('s1'), pg_temp.id('s2')])$$,
  '42501', null, 'an expert cannot reorder');
select pg_temp.act_as('viewer');
select throws_ok(
  $$select public.reorder_report_sections(pg_temp.id('r1'), array[pg_temp.id('s3'), pg_temp.id('s1'), pg_temp.id('s2')])$$,
  '42501', null, 'a viewer cannot reorder');
select pg_temp.act_as('outsider');
select throws_ok(
  $$select public.reorder_report_sections(pg_temp.id('r1'), array[pg_temp.id('s3'), pg_temp.id('s1'), pg_temp.id('s2')])$$,
  'P0002', null, 'another workspace does not see the report');

select pg_temp.act_as('admin');
select lives_ok(
  $$select public.reorder_report_sections(pg_temp.id('r1'), array[pg_temp.id('s3'), pg_temp.id('s1'), pg_temp.id('s2')])$$,
  'an admin reorders the sections');
select results_eq(
  $$select id from public.report_sections where report_id = pg_temp.id('r1') order by position$$,
  $$values (pg_temp.id('s3')), (pg_temp.id('s1')), (pg_temp.id('s2'))$$,
  'the new order is saved');
select is(pg_temp.version_of(pg_temp.id('s1')), pg_temp.kept('s1'), 'reordering keeps the text versions');
select throws_ok(
  $$select public.reorder_report_sections(pg_temp.id('r1'), array[pg_temp.id('s3'), pg_temp.id('s1')])$$,
  '40001', null, 'a list missing a section is stale');
select throws_ok(
  $$select public.reorder_report_sections(pg_temp.id('r1'), array[pg_temp.id('s3'), pg_temp.id('s1'), pg_temp.id('s1')])$$,
  '40001', null, 'a list with a section twice is stale');
select throws_ok(
  $$select public.reorder_report_sections(pg_temp.id('r1'), array[pg_temp.id('s3'), pg_temp.id('s1'), pg_temp.id('s4')])$$,
  '40001', null, 'a section of another report does not fit');
select throws_ok(
  $$select public.reorder_report_sections(pg_temp.id('r1'), null)$$,
  '40001', null, 'no list is stale too');

-- Exports ---------------------------------------------------------------------------
reset role;
insert into public.report_exports (workspace_id, report_id, format, file_name, status, storage_path, size_bytes, section_count, created_by, finished_at)
values (pg_temp.id('w1'), pg_temp.id('r1'), 'docx', 'rapport-a-2026-10-14.docx', 'ready',
        pg_temp.id('w1') || '/' || pg_temp.id('r1') || '/x.docx', 1200, 3, pg_temp.id('admin'), now());

select pg_temp.act_as('admin');
select is((select count(*)::int from public.report_exports), 1, 'owners and admins see the exports of their workspace');
select pg_temp.act_as('expert');
select is((select count(*)::int from public.report_exports), 0, 'experts do not');
select pg_temp.act_as('outsider');
select is((select count(*)::int from public.report_exports), 0, 'another workspace does not');
select pg_temp.act_as('admin');
select throws_ok(
  $$insert into public.report_exports (workspace_id, report_id, format, file_name, storage_path, size_bytes, section_count)
    values (pg_temp.id('w1'), pg_temp.id('r1'), 'pdf', 'x.pdf', 'w/r/y.pdf', 10, 1)$$,
  '42501', null, 'users cannot record an export themselves');

-- Claiming an export --------------------------------------------------------------
create temp table claims (name text primary key, id uuid);
create or replace function pg_temp.claim(name text, who text, hourly integer) returns text
language plpgsql as $$
declare
  result record;
begin
  select * into result from public.claim_report_export(pg_temp.id('r1'), pg_temp.id(who), 'pdf', 'rapport-a.pdf', hourly);
  if result.export_id is not null then
    insert into claims values (name, result.export_id);
    return 'claimed';
  end if;
  return result.refusal;
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.claim('a', 'admin', 3), 'claimed', 'a manager gets an export slot');
select is(pg_temp.claim('x', 'admin', 3), 'busy', 'one export at a time per person');
update public.report_exports set status = 'failed', finished_at = now() where id = (select id from claims where name = 'a');
select is(pg_temp.claim('b', 'admin', 3), 'claimed', 'the next one starts once the last ended');
update public.report_exports set status = 'failed', finished_at = now() where id = (select id from claims where name = 'b');
select is(pg_temp.claim('c', 'admin', 3), 'rateLimited', 'failed exports count toward the hourly limit');

select is(pg_temp.claim('d', 'owner', 3), 'claimed', 'the limit is per person');
update public.report_exports set created_at = now() - interval '3 minutes' where id = (select id from claims where name = 'd');
select is(pg_temp.claim('e', 'owner', 3), 'claimed', 'an export stuck for more than two minutes no longer blocks');
select is((select status from public.report_exports where id = (select id from claims where name = 'd')), 'failed',
  'the stuck export is marked failed');
select is(
  (select refusal from public.claim_report_export(gen_random_uuid(), pg_temp.id('admin'), 'pdf', 'x.pdf', 3)),
  'notFound', 'an unknown report has no export');
select pg_temp.act_as('admin');
select throws_ok(
  $$select * from public.claim_report_export(pg_temp.id('r1'), pg_temp.id('admin'), 'pdf', 'x.pdf', 3)$$,
  '42501', null, 'users cannot claim exports themselves');

reset role;
select results_eq(
  $$select public, file_size_limit from storage.buckets where id = 'exports'$$,
  $$values (false, 52428800::bigint)$$,
  'exports go to a private bucket');

select * from finish();
rollback;
