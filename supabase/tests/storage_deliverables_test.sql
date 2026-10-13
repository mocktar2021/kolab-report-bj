begin;
-- Needs the storage service. Skipped when it is not running locally.
select plan(46);

select case when to_regclass('storage.objects') is null then 1 else 0 end as storage_missing \gset

\if :storage_missing
  select skip('storage schema not available (storage service not running)', 46);
\else
  \ir fixtures.psql

  -- Object name for a file in a section folder: {workspace}/{section}/{file}.
  create function pg_temp.obj(ws text, section text, file text) returns text
  language sql immutable as $$
    select pg_temp.id(ws) || '/' || pg_temp.id(section) || '/' || file;
  $$;
  -- The statement storage runs to sign an upload URL with upsert on.
  create function pg_temp.upsert(path text, owner_id uuid) returns text
  language sql immutable as $$
    select format($sql$insert into storage.objects (bucket_id, name, owner_id) values ('deliverables', %L, %L)
      on conflict (bucket_id, name collate "C") where archived_at is null
      do update set version = excluded.version returning *$sql$, path, owner_id);
  $$;
  grant execute on function pg_temp.obj(text, text, text), pg_temp.upsert(text, uuid) to authenticated, anon;

  -- Files registered through the app. d1 (expert, s1) is pending too.
  insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, uploaded_at) values
    (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('admin'), pg_temp.obj('w1', 's1', 'adm-note.pdf'), 'note.pdf', 'application/pdf', 10, null),
    (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.obj('w1', 's1', 'e-done.pdf'), 'done.pdf', 'application/pdf', 10, now()),
    (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), pg_temp.obj('w1', 's1', 'e-late.pdf'), 'late.pdf', 'application/pdf', 10, null),
    (pg_temp.id('w2'), pg_temp.id('s4'), pg_temp.id('outsider'), pg_temp.obj('w2', 's4', 'out-plan.pdf'), 'plan.pdf', 'application/pdf', 10, null);

  -- A second bucket, to check the policies stay inside the deliverables one.
  insert into storage.buckets (id, name, public) values ('other', 'other', false);

  -- Uploads -------------------------------------------------------------------
  -- Storage signs an upload URL after trying the insert as the user: a plain
  -- insert without upsert, or the upsert below with it.
  select pg_temp.act_as('expert');
  select lives_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'd1-plan.docx'), pg_temp.id('expert')::text)$$,
    'expert uploads the file they registered');
  select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'free.pdf'), pg_temp.id('expert')::text)$$,
    '42501', null, 'expert cannot upload to a path nobody registered, even in their section');
  select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'adm-note.pdf'), pg_temp.id('expert')::text)$$,
    '42501', null, 'expert cannot upload a file someone else registered');
  select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'e-done.pdf'), pg_temp.id('expert')::text)$$,
    '42501', null, 'expert cannot upload a file the app already checked');
  select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('other', pg_temp.obj('w1', 's1', 'e-late.pdf'), pg_temp.id('expert')::text)$$,
    '42501', null, 'a registered path only opens the deliverables bucket');
  -- The upsert returns the new row, so it also needs the read policy, which
  -- requires a checked file. It can never pass for a pending one.
  select throws_ok(pg_temp.upsert(pg_temp.obj('w1', 's1', 'e-late.pdf'), pg_temp.id('expert')),
    '42501', null, 'expert cannot upsert their pending file');
  select throws_ok(pg_temp.upsert(pg_temp.obj('w1', 's1', 'd1-plan.docx'), pg_temp.id('expert')),
    '42501', null, 'expert cannot upsert over their pending object');

  select pg_temp.act_as('admin');
  select lives_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'adm-note.pdf'), pg_temp.id('admin')::text)$$,
    'admin uploads the file they registered');
  select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's3', 'free.pdf'), pg_temp.id('admin')::text)$$,
    '42501', null, 'admin cannot upload to a path nobody registered either');
  select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'e-late.pdf'), pg_temp.id('admin')::text)$$,
    '42501', null, 'admin cannot upload a file expert registered');

  select pg_temp.act_as('outsider');
  select lives_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w2', 's4', 'out-plan.pdf'), pg_temp.id('outsider')::text)$$,
    'outsider uploads the file they registered in w2');

  -- The owner takes s1 away from expert, then gives it back.
  select pg_temp.act_as('owner');
  update public.report_sections set assigned_to = null where id = pg_temp.id('s1');
  select pg_temp.act_as('expert');
  select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'e-late.pdf'), pg_temp.id('expert')::text)$$,
    '42501', null, 'expert cannot upload their pending file once the section is no longer theirs');
  select pg_temp.act_as('owner');
  update public.report_sections set assigned_to = pg_temp.id('expert') where id = pg_temp.id('s1');

  select pg_temp.act_as('viewer');
  select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'e-late.pdf'), pg_temp.id('viewer')::text)$$,
    '42501', null, 'viewer cannot upload');
  select pg_temp.act_as('expert2');
  select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'e-late.pdf'), pg_temp.id('expert2')::text)$$,
    '42501', null, 'expert2 cannot upload a file registered by expert');
  select pg_temp.act_as('outsider');
  select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'e-late.pdf'), pg_temp.id('outsider')::text)$$,
    '42501', null, 'outsider cannot upload into w1');
  select pg_temp.act_as('stranger');
  select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'e-late.pdf'), pg_temp.id('stranger')::text)$$,
    '42501', null, 'stranger cannot upload');
  select pg_temp.act_as_anon();
  select throws_ok($$insert into storage.objects (bucket_id, name)
    values ('deliverables', pg_temp.obj('w1', 's1', 'e-late.pdf'))$$,
    '42501', null, 'anon cannot upload');

  select pg_temp.act_as('expert');
  select lives_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.obj('w1', 's1', 'e-late.pdf'), pg_temp.id('expert')::text)$$,
    'expert uploads their pending file again once s1 is back');

  -- Pending files -------------------------------------------------------------
  -- d1-plan, adm-note, e-late and out-plan are stored, none is checked yet.
  select is((select count(*)::int from storage.objects), 0, 'expert cannot read their pending files');
  select pg_temp.act_as('admin');
  select is((select count(*)::int from storage.objects), 0, 'admin cannot read pending files');
  select pg_temp.act_as('owner');
  select is((select count(*)::int from storage.objects), 0, 'owner cannot read pending files');

  -- The app checks d1-plan, adm-note and out-plan. e-late stays pending.
  reset role;
  update public.deliverables set uploaded_at = now()
  where storage_path in (pg_temp.obj('w1', 's1', 'd1-plan.docx'), pg_temp.obj('w1', 's1', 'adm-note.pdf'), pg_temp.obj('w2', 's4', 'out-plan.pdf'));
  -- A file whose row is gone, like the leftover of a failed upload.
  insert into storage.objects (bucket_id, name, owner_id)
  values ('deliverables', pg_temp.obj('w1', 's1', 'orphan.pdf'), pg_temp.id('expert')::text);
  -- The path of a checked file in another bucket.
  insert into storage.objects (bucket_id, name, owner_id)
  values ('other', pg_temp.obj('w1', 's1', 'd1-plan.docx'), pg_temp.id('expert')::text);

  -- Checked files -------------------------------------------------------------
  select pg_temp.act_as('expert');
  select throws_ok(pg_temp.upsert(pg_temp.obj('w1', 's1', 'd1-plan.docx'), pg_temp.id('expert')),
    '42501', null, 'expert cannot upsert over their checked file');

  -- There is no update policy, so an update finds no row instead of failing.
  select is(pg_temp.affected($$update storage.objects set metadata = '{"size": 1}'
    where bucket_id = 'deliverables' and name = pg_temp.obj('w1', 's1', 'd1-plan.docx')$$),
    0, 'expert cannot replace their checked file');
  select pg_temp.act_as('admin');
  select is(pg_temp.affected($$update storage.objects set metadata = '{"size": 1}'
    where bucket_id = 'deliverables' and name = pg_temp.obj('w1', 's1', 'd1-plan.docx')$$),
    0, 'admin cannot replace a checked file');
  select pg_temp.act_as('owner');
  select is(pg_temp.affected($$update storage.objects set metadata = '{"size": 1}'
    where bucket_id = 'deliverables' and name = pg_temp.obj('w1', 's1', 'adm-note.pdf')$$),
    0, 'owner cannot replace a checked file');

  -- Members read d1-plan and adm-note, nothing else in any bucket.
  select pg_temp.act_as('owner');
  select is((select count(*)::int from storage.objects), 2, 'owner reads the checked w1 files');
  select pg_temp.act_as('admin');
  select is((select count(*)::int from storage.objects), 2, 'admin reads the checked w1 files');
  select pg_temp.act_as('expert');
  select is((select count(*)::int from storage.objects), 2, 'expert reads the checked w1 files');
  select pg_temp.act_as('expert2');
  select is((select count(*)::int from storage.objects), 2, 'expert2 reads the checked w1 files');
  select pg_temp.act_as('viewer');
  select is((select count(*)::int from storage.objects), 2, 'viewer reads the checked w1 files');
  select pg_temp.act_as('outsider');
  select is((select count(*)::int from storage.objects), 1, 'outsider only reads the checked w2 file');
  select pg_temp.act_as('stranger');
  select is((select count(*)::int from storage.objects), 0, 'stranger reads no file');
  select pg_temp.act_as_anon();
  select is((select count(*)::int from storage.objects), 0, 'anon reads no file');

  -- Orphan files --------------------------------------------------------------
  select pg_temp.act_as('expert');
  select is(pg_temp.affected($$delete from public.deliverables where id = pg_temp.id('d1')$$),
    1, 'expert deletes the d1 row');
  select is((select count(*)::int from storage.objects
    where name in (pg_temp.obj('w1', 's1', 'd1-plan.docx'), pg_temp.obj('w1', 's1', 'orphan.pdf'))),
    0, 'expert cannot read their files once the rows are gone');
  select pg_temp.act_as('admin');
  select is((select count(*)::int from storage.objects
    where name in (pg_temp.obj('w1', 's1', 'd1-plan.docx'), pg_temp.obj('w1', 's1', 'orphan.pdf'))),
    0, 'admin cannot read orphan files');
  select pg_temp.act_as('owner');
  select is((select count(*)::int from storage.objects
    where name in (pg_temp.obj('w1', 's1', 'd1-plan.docx'), pg_temp.obj('w1', 's1', 'orphan.pdf'))),
    0, 'owner cannot read orphan files');

  -- Deletes -------------------------------------------------------------------
  -- storage.protect_delete blocks SQL deletes unless this flag is on. Turn it
  -- on so only the policies decide. The deletes have no WHERE clause, so the
  -- read policy does not hide anything: only a delete policy could let a row
  -- through.
  reset role;
  select set_config('storage.allow_delete_query', 'true', true);

  select pg_temp.act_as('owner');
  select is(pg_temp.affected('delete from storage.objects'), 0, 'owner cannot delete any file');
  select pg_temp.act_as('admin');
  select is(pg_temp.affected('delete from storage.objects'), 0, 'admin cannot delete any file');
  select pg_temp.act_as('expert');
  select is(pg_temp.affected('delete from storage.objects'), 0, 'expert cannot delete any file, orphans included');
  select pg_temp.act_as('outsider');
  select is(pg_temp.affected('delete from storage.objects'), 0, 'outsider cannot delete their w2 file');

  -- Policies ------------------------------------------------------------------
  -- A policy on storage.objects without a bucket filter would also apply to
  -- this bucket, so the full list is checked.
  reset role;
  select policies_are('storage', 'objects',
    array['deliverables bucket: members read checked files', 'deliverables bucket: upload a registered file'],
    'storage.objects has no update or delete policy');
  select policy_cmd_is('storage', 'objects', 'deliverables bucket: members read checked files', 'select',
    'the read policy is for select');
  select policy_cmd_is('storage', 'objects', 'deliverables bucket: upload a registered file', 'insert',
    'the upload policy is for insert');
  select policy_roles_are('storage', 'objects', 'deliverables bucket: members read checked files', array['authenticated'],
    'the read policy only applies to signed-in users');
  select policy_roles_are('storage', 'objects', 'deliverables bucket: upload a registered file', array['authenticated'],
    'the upload policy only applies to signed-in users');
\endif

select * from finish();
rollback;
