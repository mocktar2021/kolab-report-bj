begin;
\ir fixtures.psql
select plan(37);

-- Object name for a file in a section folder: {workspace}/{section}/{file}.
create function pg_temp.obj(ws text, section text, file text) returns text
language sql immutable as $$
  select pg_temp.id(ws) || '/' || pg_temp.id(section) || '/' || file;
$$;
grant execute on function pg_temp.obj(text, text, text) to authenticated, anon;

-- Id of a file from its name in a section folder.
create function pg_temp.file(ws text, section text, file text) returns uuid
language sql stable as $$
  select id from public.deliverables where storage_path = pg_temp.obj(ws, section, file);
$$;
grant execute on function pg_temp.file(text, text, text) to authenticated, anon;

-- More files, added as postgres before any user claims are set.
-- x-own and x-kept are expert files in s1, x-e2 is an expert2 file in s1,
-- x-s3 is an expert file in s3 (nobody's section), x-viewer was uploaded by
-- viewer when they could still edit s1, x-out is an outsider file in w2.
insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
select pg_temp.id(f.ws), pg_temp.id(f.section), pg_temp.id(f.who), pg_temp.obj(f.ws, f.section, f.file),
  f.file, 'application/pdf', 10
from (values
  ('w1', 's1', 'expert',   'x-own.pdf'),
  ('w1', 's1', 'expert',   'x-kept.pdf'),
  ('w1', 's1', 'expert2',  'x-e2.pdf'),
  ('w1', 's3', 'expert',   'x-s3.pdf'),
  ('w1', 's1', 'viewer',   'x-viewer.pdf'),
  ('w2', 's4', 'outsider', 'x-out.pdf')
) as f (ws, section, who, file);

-- viewer also runs w2 as an admin. outsider cannot even see w1 rows, so this
-- is how we check that managing another workspace gives no delete in w1.
insert into public.workspace_members (workspace_id, user_id, role) values
  (pg_temp.id('w2'), pg_temp.id('viewer'), 'admin');

-- parse_status ----------------------------------------------------------------
select ok('skipped' = any (enum_range(null::public.parse_status)::text[]), 'parse_status has skipped');
select enum_has_labels('public', 'parse_status', array['pending', 'processing', 'parsed', 'failed', 'skipped'],
  'parse_status labels are pending, processing, parsed, failed, skipped in that order');

-- parse_meta ------------------------------------------------------------------
select has_column('public', 'deliverables', 'parse_meta', 'deliverables has parse_meta');
select col_type_is('public', 'deliverables', 'parse_meta', 'jsonb', 'parse_meta is jsonb');
select col_is_null('public', 'deliverables', 'parse_meta', 'parse_meta is nullable');
select col_hasnt_default('public', 'deliverables', 'parse_meta', 'parse_meta has no default');
select is((select parse_meta from public.deliverables where id = pg_temp.id('d1')), null::jsonb,
  'a file starts with parse_meta null');

-- Only the app writes parse_meta ----------------------------------------------
-- RLS lets expert insert into s1 and would let them see d1, so only the
-- column privileges refuse these.
select pg_temp.act_as('expert');
select throws_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, parse_meta)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.obj('w1', 's1', 'x-meta.pdf'), 'x-meta.pdf', 'application/pdf', 10, '{"kind": "pdf"}')$$,
  '42501', null, 'expert cannot set parse_meta on insert');
select throws_ok($$update public.deliverables set parse_meta = '{"kind": "docx"}' where id = pg_temp.id('d1')$$,
  '42501', null, 'expert cannot set parse_meta');

select pg_temp.act_as('admin');
select throws_ok($$update public.deliverables set parse_meta = '{"kind": "docx"}' where id = pg_temp.id('d1')$$,
  '42501', null, 'admin cannot set parse_meta either');

reset role;
select column_privs_are('public', 'deliverables', 'parse_meta', 'authenticated', array['SELECT'],
  'signed-in users can only read parse_meta');
select column_privs_are('public', 'deliverables', 'parse_meta', 'anon', array[]::text[],
  'anon cannot touch parse_meta');

-- The app keeps a PDF without reading it.
set local role service_role;
select is(pg_temp.affected($$update public.deliverables
  set parse_status = 'skipped', parse_meta = '{"kind": "pdf"}'
  where id = pg_temp.file('w1', 's1', 'x-kept.pdf')$$),
  1, 'service role marks a file skipped and writes parse_meta');
select is((select parse_status::text from public.deliverables where id = pg_temp.file('w1', 's1', 'x-kept.pdf')),
  'skipped', 'the file is skipped');
select is((select parse_meta from public.deliverables where id = pg_temp.file('w1', 's1', 'x-kept.pdf')),
  '{"kind": "pdf"}'::jsonb, 'parse_meta is stored');

-- Deleting files --------------------------------------------------------------
select pg_temp.act_as('expert');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's1', 'x-own.pdf')$$),
  1, 'expert deletes their own file in their section');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's3', 'x-s3.pdf')$$),
  0, 'expert cannot delete their own file in a section that is not theirs');

select pg_temp.act_as('expert2');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's1', 'x-kept.pdf')$$),
  0, 'expert2 cannot delete a file expert uploaded in s1');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's1', 'x-e2.pdf')$$),
  0, 'expert2 cannot delete their own file in s1 while s1 is not theirs');

select pg_temp.act_as('viewer');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's1', 'x-kept.pdf')$$),
  0, 'viewer cannot delete a file, even as an admin of w2');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's1', 'x-viewer.pdf')$$),
  0, 'viewer cannot delete a file they uploaded when they could edit');

select pg_temp.act_as('outsider');
select is(pg_temp.affected($$delete from public.deliverables where workspace_id = pg_temp.id('w1')$$),
  0, 'outsider, a manager of w2 only, cannot delete w1 files');

select pg_temp.act_as('stranger');
select is(pg_temp.affected($$delete from public.deliverables where workspace_id = pg_temp.id('w1')$$),
  0, 'stranger cannot delete w1 files');

-- anon has no table privilege on deliverables at all.
select pg_temp.act_as_anon();
select throws_ok($$delete from public.deliverables where storage_path = pg_temp.obj('w1', 's1', 'x-kept.pdf')$$,
  '42501', null, 'anon cannot delete a file');

-- The owner gives s1 to expert2 through RLS. As postgres, the claims left by
-- act_as would still trip the section guard trigger.
select pg_temp.act_as('owner');
select is(pg_temp.affected($$update public.report_sections set assigned_to = pg_temp.id('expert2') where id = pg_temp.id('s1')$$),
  1, 'owner gives s1 to expert2');

select pg_temp.act_as('expert');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's1', 'x-kept.pdf')$$),
  0, 'expert cannot delete their file once s1 is no longer theirs');

select pg_temp.act_as('expert2');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's1', 'x-kept.pdf')$$),
  0, 'expert2, now on s1, cannot delete a file expert uploaded');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's1', 'x-e2.pdf')$$),
  1, 'expert2 deletes their own file now that s1 is theirs');

select pg_temp.act_as('admin');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's1', 'x-kept.pdf')$$),
  1, 'admin deletes a file another member uploaded');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's1', 'x-viewer.pdf')$$),
  1, 'admin deletes a file from a member who can no longer edit');

select pg_temp.act_as('owner');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w1', 's3', 'x-s3.pdf')$$),
  1, 'owner deletes a file in a section nobody holds');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.id('d1')$$),
  1, 'owner deletes a file another member uploaded');

select pg_temp.act_as('outsider');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.file('w2', 's4', 'x-out.pdf')$$),
  1, 'outsider deletes their own file in w2');

reset role;
select is((select count(*)::int from public.deliverables where workspace_id in (pg_temp.id('w1'), pg_temp.id('w2'))),
  0, 'every test file is gone');

-- Policies --------------------------------------------------------------------
select policies_are('public', 'deliverables',
  array['deliverables: members read', 'deliverables: section editors upload', 'deliverables: section editors delete'],
  'deliverables has a read, an upload and a delete policy and no update policy');
select policy_cmd_is('public', 'deliverables', 'deliverables: section editors delete', 'delete',
  'the delete policy is for delete');
select policy_roles_are('public', 'deliverables', 'deliverables: section editors delete', array['authenticated'],
  'the delete policy only applies to signed-in users');

select * from finish();
rollback;
