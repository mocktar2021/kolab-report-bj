-- =============================================================================
-- KolabReport: remove the stored files of deleted rows (KRB-166, KRB-24)
--
-- Deleting a deliverable, an export, a report or a workspace deletes rows of
-- deliverables and report_exports, through foreign keys for the last two.
-- Their files stayed in the "deliverables" and "exports" buckets, with the
-- full text of the report.
--
-- * A trigger on each table puts the path of every deleted row in
--   private.storage_cleanup_queue. Cascaded deletes fire it too.
-- * GET /api/cron/storage-cleanup (Vercel Cron, once a day) takes the queue
--   in batches with claim_storage_cleanup, removes the objects with the
--   service role, and reports back with finish_storage_cleanup.
-- * Exports someone asked for are kept 90 days: the same job deletes older
--   rows with expire_report_exports, and the trigger queues their files. The
--   PDF stored when a report became final stays as long as the report.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Queue
-- -----------------------------------------------------------------------------
-- Not tenant data: paths of objects no row points at any more. Only the
-- functions below read or write it, so it has no workspace_id and no policy.
-- RLS stays on in case someone grants access to it by mistake.
create table private.storage_cleanup_queue (
  id          bigint generated always as identity primary key,
  bucket      text not null check (bucket in ('deliverables', 'exports')),
  path        text not null check (char_length(path) between 1 and 1024),
  enqueued_at timestamptz not null default now(),
  -- Not removed before this time. A claim also moves it forward, so two runs
  -- never take the same path at once.
  not_before  timestamptz not null default now(),
  attempts    integer not null default 0,
  last_error  text,
  unique (bucket, path)
);

comment on table private.storage_cleanup_queue is
  'Stored files whose row was deleted, waiting for /api/cron/storage-cleanup to remove them (KRB-166).';

create index storage_cleanup_queue_due_idx on private.storage_cleanup_queue (not_before, id);

alter table private.storage_cleanup_queue enable row level security;
-- authenticated has USAGE on the private schema: it must get nothing here.
revoke all on private.storage_cleanup_queue from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Queueing on delete
-- -----------------------------------------------------------------------------
-- TG_ARGV[0] is the bucket. TG_ARGV[1] is how long after the row was created
-- a file can still arrive at its path: the removal waits until then, or the
-- late file would stay behind. A path queued twice keeps the later time.
create or replace function private.queue_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only paths the app writes: {workspace}/{section or report}/{file}, with no
  -- "." or ".." segment. Anything else is not removed by the service role.
  if old.storage_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/.][^/]*$' then
    return null;
  end if;
  insert into private.storage_cleanup_queue as q (bucket, path, not_before)
  values (tg_argv[0], old.storage_path, greatest(now(), old.created_at + tg_argv[1]::interval))
  on conflict (bucket, path) do update
    set not_before = greatest(q.not_before, excluded.not_before);
  return null;
end;
$$;

revoke all on function private.queue_storage_cleanup() from public, anon, authenticated;

-- Signed upload URLs last 2 hours from when the file is registered, so a
-- file can still land at the path of a deleted row until then. The row is
-- queued even when the upload never finished: removing a missing object is
-- harmless.
-- Users register deliverable paths themselves (the upload-url route builds
-- them, but PostgREST takes any value under their section's prefix). Keep
-- them to the shape the app writes, so a path can never reach outside its
-- section once the job removes it. NOT VALID: rows already there are not
-- scanned; every row the app wrote matches.
alter table public.deliverables
  add constraint deliverables_storage_path_shape
  check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/.][^/]*$') not valid;

create trigger queue_storage_cleanup
  after delete on public.deliverables
  for each row
  when (old.storage_path is not null)
  execute function private.queue_storage_cleanup('deliverables', '2 hours 15 minutes');

-- The app stores an export with the service role during the request that
-- made its row, and sets storage_path only once the file is stored. A
-- pending export has no path to queue: storeExportFile removes the file
-- itself when the row is gone by then.
create trigger queue_storage_cleanup
  after delete on public.report_exports
  for each row
  when (old.storage_path is not null)
  execute function private.queue_storage_cleanup('exports', '0 seconds');

-- -----------------------------------------------------------------------------
-- Functions of the cleanup job (service role only)
-- -----------------------------------------------------------------------------
-- The queue is global by design: the job empties it for every workspace, so
-- nothing below filters on workspace_id.

-- Takes up to p_limit paths that are due, oldest first, and holds them for
-- 15 minutes: when a run dies, the next one picks them up again. The caller
-- removes the objects, then calls finish_storage_cleanup.
create or replace function public.claim_storage_cleanup(p_limit integer)
returns table (id bigint, bucket text, path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'p_limit must be between 1 and 1000' using errcode = '22023';
  end if;

  return query
  with due as (
    select q.id
    from private.storage_cleanup_queue q
    where q.not_before <= now()
    order by q.not_before, q.id
    limit p_limit
    for update skip locked
  )
  update private.storage_cleanup_queue q
  set attempts = q.attempts + 1,
      not_before = now() + interval '15 minutes'
  from due
  where q.id = due.id
  returning q.id, q.bucket, q.path;
end;
$$;

-- Without p_error the objects are gone: their paths leave the queue. With
-- p_error they stay, keep the error, and come back once their hold ends.
-- Returns how many queued paths it found.
create or replace function public.finish_storage_cleanup(p_ids bigint[], p_error text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched integer;
begin
  if p_error is null then
    delete from private.storage_cleanup_queue q where q.id = any (p_ids);
  else
    update private.storage_cleanup_queue q
    set last_error = left(p_error, 500)
    where q.id = any (p_ids);
  end if;
  get diagnostics touched = row_count;
  return touched;
end;
$$;

-- For the daily expiry below.
create index report_exports_manual_created_idx on public.report_exports (created_at) where kind = 'manual';

-- Deletes the exports someone asked for that are more than p_days old,
-- whatever their status. The trigger queues their files. A final report's
-- snapshot (kind final) stays as long as the report. Returns how many rows
-- it deleted.
create or replace function public.expire_report_exports(p_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired integer;
begin
  if p_days is null or p_days < 1 then
    raise exception 'p_days must be at least 1' using errcode = '22023';
  end if;

  delete from public.report_exports e
  where e.kind = 'manual'
    and e.created_at < now() - make_interval(days => p_days);
  get diagnostics expired = row_count;
  return expired;
end;
$$;

revoke all on function public.claim_storage_cleanup(integer) from public, anon, authenticated;
revoke all on function public.finish_storage_cleanup(bigint[], text) from public, anon, authenticated;
revoke all on function public.expire_report_exports(integer) from public, anon, authenticated;
grant execute on function public.claim_storage_cleanup(integer) to service_role;
grant execute on function public.finish_storage_cleanup(bigint[], text) to service_role;
grant execute on function public.expire_report_exports(integer) to service_role;
