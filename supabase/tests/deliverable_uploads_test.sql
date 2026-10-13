begin;
\ir fixtures.psql
select plan(44);

-- Object name for a file in a section folder: {workspace}/{section}/{file}.
create function pg_temp.obj(ws text, section text, file text) returns text
language sql immutable as $$
  select pg_temp.id(ws) || '/' || pg_temp.id(section) || '/' || file;
$$;
grant execute on function pg_temp.obj(text, text, text) to authenticated, anon;

-- uploaded_at -----------------------------------------------------------------
select has_column('public', 'deliverables', 'uploaded_at', 'deliverables has uploaded_at');
select col_type_is('public', 'deliverables', 'uploaded_at', 'timestamp with time zone', 'uploaded_at is a timestamptz');
select col_is_null('public', 'deliverables', 'uploaded_at', 'uploaded_at is nullable');

-- Registering a file ----------------------------------------------------------
select pg_temp.act_as('expert');
select lives_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.obj('w1', 's1', 'new.pdf'), 'new.pdf', 'application/pdf', 10)$$,
  'expert registers a file with the allowed columns');
select is((select uploaded_at from public.deliverables where storage_path = pg_temp.obj('w1', 's1', 'new.pdf')),
  null, 'a new file starts with uploaded_at null');
select is((select parse_status::text from public.deliverables where storage_path = pg_temp.obj('w1', 's1', 'new.pdf')),
  'pending', 'a new file starts with parse_status pending');

-- Each row below passes RLS, so only the column privileges refuse it.
select throws_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, uploaded_at)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.obj('w1', 's1', 'i1.pdf'), 'i1.pdf', 'application/pdf', 10, now())$$,
  '42501', null, 'expert cannot set uploaded_at on insert');
select throws_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, parse_status)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.obj('w1', 's1', 'i2.pdf'), 'i2.pdf', 'application/pdf', 10, 'parsed')$$,
  '42501', null, 'expert cannot set parse_status on insert');
select throws_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, parsed_content)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.obj('w1', 's1', 'i3.pdf'), 'i3.pdf', 'application/pdf', 10, 'texte')$$,
  '42501', null, 'expert cannot set parsed_content on insert');
select throws_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, parse_error)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.obj('w1', 's1', 'i4.pdf'), 'i4.pdf', 'application/pdf', 10, 'erreur')$$,
  '42501', null, 'expert cannot set parse_error on insert');
select throws_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, parsed_at)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.obj('w1', 's1', 'i5.pdf'), 'i5.pdf', 'application/pdf', 10, now())$$,
  '42501', null, 'expert cannot set parsed_at on insert');
select throws_ok($$insert into public.deliverables (id, workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
  values (gen_random_uuid(), pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.obj('w1', 's1', 'i6.pdf'), 'i6.pdf', 'application/pdf', 10)$$,
  '42501', null, 'expert cannot choose the id on insert');

-- Changing a file -------------------------------------------------------------
select is(pg_temp.affected($$update public.deliverables set file_name = 'plan-v2.docx' where id = pg_temp.id('d1')$$),
  1, 'expert renames their file');

-- RLS lets expert update d1, so only the column privileges refuse these.
select throws_ok($$update public.deliverables set uploaded_at = now() where id = pg_temp.id('d1')$$,
  '42501', null, 'expert cannot set uploaded_at');
select throws_ok($$update public.deliverables set parse_status = 'parsed' where id = pg_temp.id('d1')$$,
  '42501', null, 'expert cannot set parse_status');
select throws_ok($$update public.deliverables set parsed_content = 'texte' where id = pg_temp.id('d1')$$,
  '42501', null, 'expert cannot set parsed_content');
select throws_ok($$update public.deliverables set storage_path = pg_temp.obj('w1', 's1', 'd1-other.docx') where id = pg_temp.id('d1')$$,
  '42501', null, 'expert cannot point the row at another object');
select throws_ok($$update public.deliverables set mime_type = 'application/pdf' where id = pg_temp.id('d1')$$,
  '42501', null, 'expert cannot change mime_type');
select throws_ok($$update public.deliverables set size_bytes = 2 where id = pg_temp.id('d1')$$,
  '42501', null, 'expert cannot change size_bytes');
-- Same value, so the section and path checks still pass.
select throws_ok($$update public.deliverables set section_id = section_id where id = pg_temp.id('d1')$$,
  '42501', null, 'expert cannot change section_id');
select throws_ok($$update public.deliverables set uploaded_by = pg_temp.id('expert2') where id = pg_temp.id('d1')$$,
  '42501', null, 'expert cannot hand the file to someone else');

select pg_temp.act_as('admin');
select throws_ok($$update public.deliverables set uploaded_at = now() where id = pg_temp.id('d1')$$,
  '42501', null, 'admin cannot set uploaded_at either');

-- The app checks the file with the service role, which sets uploaded_at
-- and the parse results.
reset role;
set local role service_role;
select is(pg_temp.affected($$update public.deliverables set uploaded_at = now() where id = pg_temp.id('d1')$$),
  1, 'service role sets uploaded_at');
select is(pg_temp.affected($$update public.deliverables
  set parse_status = 'parsed', parsed_content = 'texte', parsed_at = now() where id = pg_temp.id('d1')$$),
  1, 'service role writes the parse results');

select pg_temp.act_as_anon();
select throws_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.obj('w1', 's1', 'anon.pdf'), 'anon.pdf', 'application/pdf', 10)$$,
  '42501', null, 'anon cannot register a file');
select throws_ok('select * from public.deliverables', '42501', null, 'anon cannot read deliverables');

-- Storage helpers -------------------------------------------------------------
reset role;
select hasnt_function('private', 'can_upload_to_path', array['text'], 'can_upload_to_path is gone');
select hasnt_function('private', 'storage_section_id', array['text'], 'storage_section_id is gone');
select hasnt_function('private', 'storage_workspace_id', array['text'], 'storage_workspace_id is gone');
select hasnt_function('private', 'deliverable_object_in_use', array['text'], 'deliverable_object_in_use is gone');
select has_function('private', 'can_upload_deliverable', array['text'], 'can_upload_deliverable exists');
select has_function('private', 'can_read_deliverable', array['text'], 'can_read_deliverable exists');
select is_definer('private', 'can_upload_deliverable', array['text'], 'can_upload_deliverable is security definer');
select is_definer('private', 'can_read_deliverable', array['text'], 'can_read_deliverable is security definer');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'private.can_upload_deliverable(text)'::regprocedure),
  'can_upload_deliverable has an empty search_path');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'private.can_read_deliverable(text)'::regprocedure),
  'can_read_deliverable has an empty search_path');
select function_privs_are('private', 'can_upload_deliverable', array['text'], 'anon', array[]::text[],
  'anon cannot run can_upload_deliverable');
select function_privs_are('private', 'can_read_deliverable', array['text'], 'anon', array[]::text[],
  'anon cannot run can_read_deliverable');
select function_privs_are('private', 'can_upload_deliverable', array['text'], 'authenticated', array['EXECUTE'],
  'signed-in users can run can_upload_deliverable');
select function_privs_are('private', 'can_read_deliverable', array['text'], 'authenticated', array['EXECUTE'],
  'signed-in users can run can_read_deliverable');

-- Bucket ----------------------------------------------------------------------
select ok((select allowed_mime_types @> array['application/vnd.ms-visio.drawing.main+xml'] from storage.buckets where id = 'deliverables'),
  'the bucket accepts Visio files');
select ok((select allowed_mime_types @> array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
    'application/vnd.jgraph.mxfile'
  ] from storage.buckets where id = 'deliverables'),
  'the bucket still accepts the earlier types');
select is((select file_size_limit from storage.buckets where id = 'deliverables'), 52428800::bigint, 'the bucket keeps its 50 MB limit');
select is((select public from storage.buckets where id = 'deliverables'), false, 'the bucket stays private');

select * from finish();
rollback;
