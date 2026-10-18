-- =============================================================================
-- KolabReport: the deliverables in annex of an export (Story KRB-215)
--
-- * report_exports.with_annexes says whether the export was asked with the
--   "Annexes" page, which lists the files of each section. The export buttons
--   send it, ticked by default, and the snapshot of a final report always has
--   it. "Exports récents" shows it, so a file with the annexes and one
--   without are told apart.
-- * Exports made before have no annexes, so the column is false for them.
--   False is also the default: the app version still running during the
--   deploy, or after a rollback, records its exports as they are, without
--   annexes. The new app always sends the value.
-- * claim_report_export takes p_with_annexes, false when left out for the
--   same reason. The five-argument version goes, so PostgREST has one
--   function to call.
-- * Nothing reuses an export: each claim adds a row, and each row has its own
--   file. The only unique index, one snapshot per finalization, stays as it
--   is, since a snapshot always has the annexes.
-- * RLS does not change.
-- =============================================================================

-- A constant default: no table rewrite, the lock is short.
alter table public.report_exports
  add column with_annexes boolean not null default false;

comment on column public.report_exports.with_annexes is
  'Asked with the "Annexes" page listing the files of each section (KRB-215). False for exports made before it.';

drop function public.claim_report_export(uuid, uuid, text, text, integer);

-- Same checks as before (master_report.sql). The new row records p_with_annexes.
create function public.claim_report_export(
  p_report_id    uuid,
  p_user_id      uuid,
  p_format       text,
  p_file_name    text,
  p_hourly_limit integer,
  p_with_annexes boolean default false
)
returns table (export_id uuid, refusal text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  report public.reports;
  recent integer;
  new_id uuid;
begin
  select * into report from public.reports r where r.id = p_report_id;
  if not found then
    return query select null::uuid, 'notFound'::text;
    return;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('report_exports/' || report.workspace_id::text || '/' || p_user_id::text, 0)
  );

  update public.report_exports e
  set status = 'failed', finished_at = now()
  where e.workspace_id = report.workspace_id
    and e.created_by = p_user_id
    and e.status = 'pending'
    and e.created_at < now() - interval '2 minutes';
  if exists (
    select 1 from public.report_exports e
    where e.workspace_id = report.workspace_id and e.created_by = p_user_id and e.status = 'pending'
  ) then
    return query select null::uuid, 'busy'::text;
    return;
  end if;

  select count(*) into recent
  from public.report_exports e
  where e.workspace_id = report.workspace_id
    and e.created_by = p_user_id
    and e.created_at > now() - interval '1 hour';
  if recent >= p_hourly_limit then
    return query select null::uuid, 'rateLimited'::text;
    return;
  end if;

  insert into public.report_exports (workspace_id, report_id, format, file_name, created_by, with_annexes)
  values (report.workspace_id, report.id, p_format, p_file_name, p_user_id, coalesce(p_with_annexes, false))
  returning id into new_id;
  return query select new_id, null::text;
end;
$$;

revoke all on function public.claim_report_export(uuid, uuid, text, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_report_export(uuid, uuid, text, text, integer, boolean)
  to service_role;
