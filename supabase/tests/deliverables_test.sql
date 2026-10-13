begin;
\ir fixtures.psql
select plan(8);

select pg_temp.act_as('expert');
select lives_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/x-note.pdf', 'note.pdf', 'application/pdf', 10)$$,
  'expert can add a deliverable to their section');
select throws_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
  values (pg_temp.id('w1'), pg_temp.id('s2'), pg_temp.id('expert'), pg_temp.id('w1') || '/' || pg_temp.id('s2') || '/x-note.pdf', 'note.pdf', 'application/pdf', 10)$$,
  '42501', null, 'expert cannot add a deliverable to another section');
select throws_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), 'ailleurs/x-note.pdf', 'note.pdf', 'application/pdf', 10)$$,
  '23514', null, 'storage_path must start with the workspace and section ids');

select pg_temp.act_as('expert2');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.id('d1')$$), 0, 'another expert cannot delete the deliverable');

select pg_temp.act_as('viewer');
select is((select count(*)::int from public.deliverables), 2, 'viewer can see both w1 deliverables');
select throws_ok($$insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('viewer'), pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/v.pdf', 'v.pdf', 'application/pdf', 10)$$,
  '42501', null, 'viewer cannot upload');

select pg_temp.act_as('admin');
select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.id('d1')$$), 1, 'admin can delete a deliverable');

select pg_temp.act_as('outsider');
select is((select count(*)::int from public.deliverables where workspace_id = pg_temp.id('w1')), 0, 'outsider cannot see w1 deliverables');

select * from finish();
rollback;
