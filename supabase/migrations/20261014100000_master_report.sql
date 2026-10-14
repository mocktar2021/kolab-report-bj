-- =============================================================================
-- KolabReport: master report (Story KRB-18)
--
-- * report_sections.content_updated_at: the version of a section's text. It
--   moves only when the text changes, so reordering or reassigning a section
--   does not make an open editor think someone else saved over it.
-- * save_section_content: saves the text of a section if nobody saved it
--   since the editor loaded it (optimistic concurrency, error 40001).
-- * reorder_report_sections: new order of a report's sections, in one
--   statement, for owners and admins.
-- * Section text is written through those functions only: users lose direct
--   UPDATE on the text columns, and the text is capped at 100 000 characters.
-- * report_exports and the private "exports" bucket: every .docx or PDF
--   export, kept for download through signed links. The app claims a slot
--   (claim_report_export), builds the file, then stores it with the service
--   role, after checking the user manages the workspace.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Section text version
-- -----------------------------------------------------------------------------
alter table public.report_sections add column content_updated_at timestamptz;
-- The backfill must not look like an edit of every section.
alter table public.report_sections disable trigger set_updated_at;
update public.report_sections set content_updated_at = updated_at;
alter table public.report_sections enable trigger set_updated_at;
alter table public.report_sections
  alter column content_updated_at set not null,
  alter column content_updated_at set default clock_timestamp();

comment on column public.report_sections.content_updated_at is
  'When the text last changed. Editors send it back to save (optimistic concurrency).';

-- Set by the database only. clock_timestamp(), not now(): two saves in the
-- same transaction still get different versions.
create or replace function private.set_content_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.content_updated_at := clock_timestamp();
  elsif new.content is distinct from old.content then
    new.content_updated_at := clock_timestamp();
  else
    new.content_updated_at := old.content_updated_at;
  end if;
  return new;
end;
$$;

create trigger set_content_updated_at
  before insert or update on public.report_sections
  for each row execute function private.set_content_updated_at();

revoke all on function private.set_content_updated_at() from public, anon;

-- The text, its version and the accepted AI draft change only through
-- save_section_content and accept_ai_generation, which check the version and
-- the length. Users keep direct UPDATE on the other columns their role
-- allows; RLS and the expert guard still apply. NOT VALID: rows saved before
-- this check are not scanned.
revoke update on public.report_sections from authenticated;
grant update (title, instructions, position, status, weight, assigned_to)
  on public.report_sections to authenticated;
alter table public.report_sections
  add constraint report_sections_content_length
  check (content is null or char_length(content) <= 100000) not valid;

-- Saves the text of a section for its assigned expert or a manager, if its
-- version is still p_expected_version. Empty text clears the section. A
-- section not started yet moves to in progress. Returns the new version.
create or replace function public.save_section_content(
  p_section_id       uuid,
  p_content          text,
  p_expected_version timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  section public.report_sections;
  new_content text := nullif(btrim(p_content), '');
  saved_at timestamptz;
begin
  select * into section from public.report_sections s where s.id = p_section_id for update;
  if not found or not private.is_workspace_member(section.workspace_id) then
    raise exception 'Section introuvable' using errcode = 'P0002';
  end if;
  if not private.can_edit_section(section.id) then
    raise exception 'Seules les personnes qui rédigent la section peuvent modifier son texte'
      using errcode = '42501';
  end if;
  if p_content is not null and char_length(p_content) > 100000 then
    raise exception 'Le texte d''une section compte au plus 100 000 caractères' using errcode = '22023';
  end if;
  if p_expected_version is null or section.content_updated_at <> p_expected_version then
    raise exception 'Quelqu''un a modifié cette section depuis l''ouverture de l''éditeur'
      using errcode = '40001';
  end if;

  update public.report_sections s
  set content = case when new_content is null then null else p_content end,
      status = case
        when s.status = 'not_started' and new_content is not null then 'in_progress'::public.section_status
        else s.status
      end
  where s.id = section.id
  returning s.content_updated_at into saved_at;
  return saved_at;
end;
$$;

revoke all on function public.save_section_content(uuid, text, timestamptz) from public, anon;
grant execute on function public.save_section_content(uuid, text, timestamptz) to authenticated;

-- Accepting a draft checks the text version too. The app version still
-- running during a deploy sends updated_at: that value is accepted when it
-- is still current, since then nothing changed at all.
create or replace function public.accept_ai_generation(
  p_generation_id      uuid,
  p_content            text,
  p_edit_distance      integer,
  p_section_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.ai_generations;
  section  public.report_sections;
  saved_at timestamptz;
begin
  proposal := private.lock_proposal(p_generation_id);

  if p_content is null or char_length(btrim(p_content)) = 0 or char_length(p_content) > 100000 then
    raise exception 'Le texte accepté doit compter entre 1 et 100 000 caractères' using errcode = '22023';
  end if;
  if p_edit_distance is null or p_edit_distance < 0 then
    raise exception 'Distance d''édition invalide' using errcode = '22023';
  end if;

  select * into section from public.report_sections s where s.id = proposal.section_id for update;
  if p_section_updated_at is not null
     and p_section_updated_at is distinct from section.content_updated_at
     and p_section_updated_at is distinct from section.updated_at then
    raise exception 'La section a changé depuis le chargement de la page' using errcode = '40001';
  end if;

  update public.report_sections s
  set content = p_content,
      status = case when s.status = 'not_started' then 'in_progress'::public.section_status else s.status end,
      ai_draft = proposal.output,
      ai_generated_at = proposal.completed_at
  where s.id = proposal.section_id
  returning s.content_updated_at into saved_at;

  update public.ai_generations g
  set accepted = true, decided_at = now(), edit_distance = p_edit_distance
  where g.id = proposal.id;

  return saved_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reordering
-- -----------------------------------------------------------------------------
-- p_section_ids lists every section of the report, once, in the new order.
-- Any other list means the page is out of date (40001): the user reloads.
create or replace function public.reorder_report_sections(p_report_id uuid, p_section_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  report public.reports;
  current_ids uuid[];
  given_ids uuid[];
begin
  select * into report from public.reports r where r.id = p_report_id;
  if not found or not private.is_workspace_member(report.workspace_id) then
    raise exception 'Rapport introuvable' using errcode = 'P0002';
  end if;
  if not private.is_workspace_manager(report.workspace_id) then
    raise exception 'Seuls les propriétaires et administrateurs changent l''ordre des sections'
      using errcode = '42501';
  end if;

  -- Two reorders of the same report run one after the other.
  perform 1 from public.report_sections s where s.report_id = report.id order by s.id for update;
  select coalesce(array_agg(s.id order by s.id), '{}') into current_ids
  from public.report_sections s where s.report_id = report.id;
  select coalesce(array_agg(x order by x), '{}') into given_ids from unnest(p_section_ids) x;
  if p_section_ids is null or given_ids is distinct from current_ids then
    raise exception 'La liste des sections a changé, rechargez la page' using errcode = '40001';
  end if;

  update public.report_sections s
  set position = (o.idx - 1)::integer
  from unnest(p_section_ids) with ordinality as o(id, idx)
  where s.id = o.id and s.position is distinct from (o.idx - 1)::integer;
end;
$$;

revoke all on function public.reorder_report_sections(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_report_sections(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Exports
-- -----------------------------------------------------------------------------
create table public.report_exports (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  report_id      uuid not null,
  format         text not null check (format in ('docx', 'pdf')),
  file_name      text not null check (char_length(file_name) between 1 and 120),
  -- pending while the file is built, ready once stored, failed otherwise.
  -- Every attempt counts toward the hourly limit.
  status         text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  -- {workspace_id}/{report_id}/{id}.{format} in the "exports" bucket.
  storage_path   text unique,
  size_bytes     bigint check (size_bytes > 0),
  section_count  integer check (section_count >= 0),
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz,
  foreign key (report_id, workspace_id)
    references public.reports (id, workspace_id) on delete cascade,
  check (
    status <> 'ready'
    or (storage_path is not null and size_bytes is not null and section_count is not null and finished_at is not null)
  )
);

comment on table public.report_exports is
  'Exports of a master report (Story KRB-18). Written by the app with the service role.';

create index report_exports_report_idx on public.report_exports (report_id, created_at desc);
create index report_exports_workspace_idx on public.report_exports (workspace_id, created_by, created_at desc);

alter table public.report_exports enable row level security;

-- Exporting is for owners and admins, so is the list of exports.
create policy "report_exports: managers read"
  on public.report_exports for select to authenticated
  using (private.is_workspace_manager(workspace_id));

revoke all on public.report_exports from anon, authenticated;
grant select on public.report_exports to authenticated;

-- Reserves an export for p_user_id, whom the app checked manages the report's
-- workspace, before the file is built. One export at a time per person and
-- workspace, and p_hourly_limit per hour, failed ones included. A pending
-- export older than two minutes is past the route's time limit: it died.
-- Returns the new export id, or why there is none: notFound, busy or
-- rateLimited.
create or replace function public.claim_report_export(
  p_report_id    uuid,
  p_user_id      uuid,
  p_format       text,
  p_file_name    text,
  p_hourly_limit integer
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

  insert into public.report_exports (workspace_id, report_id, format, file_name, created_by)
  values (report.workspace_id, report.id, p_format, p_file_name, p_user_id)
  returning id into new_id;
  return query select new_id, null::text;
end;
$$;

revoke all on function public.claim_report_export(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_report_export(uuid, uuid, text, text, integer) to service_role;

-- Private bucket, no policies: the app uploads with the service role and
-- hands out short signed links after its own checks.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exports',
  'exports',
  false,
  52428800, -- 50 MB
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf'
  ]
)
-- A bucket already there, from a manual setup, is made private as well.
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
