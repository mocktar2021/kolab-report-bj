begin;
-- Needs the storage service. Skipped when it is not running locally.
select plan(5);

select case when to_regclass('storage.objects') is null then 1 else 0 end as storage_missing \gset

\if :storage_missing
  select skip('storage schema not available (storage service not running)', 5);
\else
  \ir fixtures.psql

  select pg_temp.act_as('expert');
  select lives_ok($$insert into storage.objects (bucket_id, name, owner_id)
    values ('deliverables', pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/a-plan.docx', pg_temp.id('expert')::text)$$,
    'expert can upload into their section folder');
  select throws_ok($$insert into storage.objects (bucket_id, name) values ('deliverables', pg_temp.id('w1') || '/' || pg_temp.id('s2') || '/b.docx')$$,
    '42501', null, 'expert cannot upload into another section folder');
  select throws_ok($$insert into storage.objects (bucket_id, name) values ('deliverables', pg_temp.id('w2') || '/' || pg_temp.id('s1') || '/c.docx')$$,
    '42501', null, 'a section id under another workspace folder is refused');

  select pg_temp.act_as('viewer');
  select is((select count(*)::int from storage.objects where bucket_id = 'deliverables'), 1, 'viewer can list w1 files');

  select pg_temp.act_as('outsider');
  select is((select count(*)::int from storage.objects where bucket_id = 'deliverables'), 0, 'outsider cannot list w1 files');
\endif

select * from finish();
rollback;
