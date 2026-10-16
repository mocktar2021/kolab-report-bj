-- =============================================================================
-- KolabReport: subsections, and deleting a section (KRB-195)
--
-- * A section can have subsections, one level only: 1, 1.1, 1.2, 2. The
--   column report_sections.parent_id is in the initial schema but nothing used
--   it. A trigger now checks that the parent is a section of the same report
--   and is not itself a subsection. Users set it when they add a subsection;
--   they still can't change it afterwards (column grants of master_report.sql).
-- * position is the order among sections that have the same parent.
--   reorder_report_sections keeps its signature: it still takes every section
--   of the report in document order, and numbers each one among its siblings.
-- * A section is deleted through delete_report_section only, like a report
--   (KRB-180): it checks the rights, takes the draft lock, queues the stored
--   files of the section and its subsections, records the deletion in
--   private.audit_events, and deletes. The DELETE privilege and the delete
--   policy on report_sections go. section_deletion_preview says what goes,
--   for the confirmation dialog.
-- * Instructions for the AI are now written in the app: at most 4000
--   characters, the length the AI context keeps (src/lib/ai/context/build.ts).
-- =============================================================================

-- Rows that would break the parent rules: none is expected, since nothing set
-- parent_id before. Stop here rather than leave a report the app can't show.
do $$
begin
  if exists (
    select 1
    from public.report_sections s
    join public.report_sections p on p.id = s.parent_id
    where p.report_id <> s.report_id or p.workspace_id <> s.workspace_id or p.parent_id is not null
  ) then
    raise exception 'report_sections has subsections in another report or on two levels';
  end if;
end;
$$;

create index if not exists report_sections_parent_id_idx
  on public.report_sections (parent_id)
  where parent_id is not null;

alter table public.report_sections drop constraint if exists report_sections_instructions_length;
alter table public.report_sections add constraint report_sections_instructions_length
  check (instructions is null or char_length(instructions) <= 4000) not valid;

-- -----------------------------------------------------------------------------
-- Parent rules
-- -----------------------------------------------------------------------------
-- Security definer: the parent is read whatever the caller may see, so a
-- section of another workspace answers like a missing one (KR050) and the
-- message gives nothing away.
create or replace function private.check_section_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.report_sections;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Une section ne peut pas être sa propre sous-section' using errcode = 'KR051';
  end if;
  select p.* into v_parent from public.report_sections p where p.id = new.parent_id;
  if not found or v_parent.report_id <> new.report_id or v_parent.workspace_id <> new.workspace_id then
    raise exception 'La section parente n''est pas dans ce rapport' using errcode = 'KR050';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'Une sous-section ne peut pas avoir de sous-sections' using errcode = 'KR051';
  end if;
  if tg_op = 'UPDATE' and exists (select 1 from public.report_sections c where c.parent_id = new.id) then
    raise exception 'Une section qui a des sous-sections ne peut pas devenir une sous-section'
      using errcode = 'KR051';
  end if;
  return new;
end;
$$;

drop trigger if exists check_parent on public.report_sections;
create trigger check_parent
  before insert or update of parent_id, report_id, workspace_id on public.report_sections
  for each row execute function private.check_section_parent();

-- -----------------------------------------------------------------------------
-- Reordering
-- -----------------------------------------------------------------------------
-- p_section_ids lists every section of the report, once, in document order
-- (a section, then its subsections). Any other list means the page is out of
-- date (40001): the user reloads. Each section is numbered among the sections
-- that have the same parent, so the order of a subsection only counts within
-- its section. The parents do not change here.
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
  set position = o.pos
  from (
    select x.id,
      (row_number() over (partition by p.parent_id order by x.idx) - 1)::integer as pos
    from unnest(p_section_ids) with ordinality as x (id, idx)
    join public.report_sections p on p.id = x.id
  ) o
  where s.id = o.id and s.position is distinct from o.pos;
end;
$$;

-- -----------------------------------------------------------------------------
-- Deleting a section
-- -----------------------------------------------------------------------------
-- What a section holds with its subsections: the subsections, the files sent,
-- and how many of them have text.
create or replace function private.section_contents(p_section_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with scope as (
    select s.id, s.parent_id, s.content
    from public.report_sections s
    where s.id = p_section_id or s.parent_id = p_section_id
  )
  select jsonb_build_object(
    'subsections', (select count(*) from scope where scope.parent_id = p_section_id),
    'files', (
      select count(*)
      from public.deliverables d
      where d.section_id in (select scope.id from scope) and d.uploaded_at is not null
    ),
    'with_text', (select count(*) from scope where nullif(btrim(scope.content), '') is not null)
  );
$$;

-- Queues the stored files of some sections before their rows go: the
-- deliverables the rows point at, and every object under the sections'
-- folders, such as a file whose upload never finished. Same path shape and
-- upload window as private.queue_scope_files. Returns how many paths are
-- queued.
create or replace function private.queue_section_files(p_workspace_id uuid, p_section_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queued integer;
begin
  with files as (
    -- A signed upload link works 2 hours after its row was made.
    select 'deliverables'::text as bucket, d.storage_path as path,
      greatest(now(), d.created_at + interval '2 hours 15 minutes') as not_before
    from public.deliverables d
    where d.workspace_id = p_workspace_id and d.section_id = any (p_section_ids)
    union all
    select o.bucket_id, o.name, now()
    from storage.objects o
    where o.bucket_id = 'deliverables'
      and o.name like p_workspace_id::text || '/%'
      and split_part(o.name, '/', 2) in (select x::text from unnest(p_section_ids) x)
  )
  insert into private.storage_cleanup_queue as q (bucket, path, not_before)
  select f.bucket, f.path, max(f.not_before)
  from files f
  where f.path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/.][^/]*$'
  group by f.bucket, f.path
  on conflict (bucket, path) do update
    set not_before = greatest(q.not_before, excluded.not_before);
  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

-- What deleting a section takes, for the owners and admins of its workspace.
-- Null for anyone else.
create or replace function public.section_deletion_preview(p_section_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_section public.report_sections;
  v_status public.report_status;
begin
  select s.* into v_section from public.report_sections s where s.id = p_section_id;
  if not found
     or not private.has_workspace_role(v_section.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    return null;
  end if;
  select r.status into v_status from public.reports r where r.id = v_section.report_id;
  return jsonb_build_object(
    'section_id', v_section.id,
    'workspace_id', v_section.workspace_id,
    'report_id', v_section.report_id,
    'parent_id', v_section.parent_id,
    'title', v_section.title,
    'report_status', v_status
  ) || private.section_contents(v_section.id);
end;
$$;

-- Owners and admins delete a section, with its subsections, while the report
-- is not final. Its files are queued for removal; AI generations stay with
-- section_id set to null, so their usage still counts. Returns what went,
-- which is also what the audit event keeps.
create or replace function public.delete_report_section(p_section_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_section  public.report_sections;
  v_report   public.reports;
  v_org      uuid;
  v_role     public.workspace_role;
  v_ids      uuid[];
  v_details  jsonb;
begin
  if v_actor is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  -- A section the caller cannot see answers like a missing one.
  select s.* into v_section from public.report_sections s where s.id = p_section_id;
  if not found or not private.is_workspace_member(v_section.workspace_id) then
    raise exception 'Section introuvable' using errcode = 'P0002';
  end if;

  -- A draft starting in this workspace finishes first, or waits. Then the
  -- report, so it can't become final meanwhile, and the section, read again.
  perform private.lock_workspace_drafts(v_section.workspace_id);
  select r.* into v_report from public.reports r where r.id = v_section.report_id for share;
  select s.* into v_section from public.report_sections s where s.id = p_section_id for update;
  if not found then
    raise exception 'Section introuvable' using errcode = 'P0002';
  end if;

  select m.role into v_role
  from public.workspace_members m
  where m.workspace_id = v_section.workspace_id and m.user_id = v_actor;
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Seuls les propriétaires et administrateurs de l''espace suppriment une section'
      using errcode = '42501';
  end if;
  if v_report.status = 'final' then
    raise exception 'Ce rapport est final : rouvrez-le pour le modifier' using errcode = 'KR020';
  end if;

  select array_agg(s.id) into v_ids
  from public.report_sections s
  where s.id = v_section.id or s.parent_id = v_section.id;

  select w.organization_id into v_org from public.workspaces w where w.id = v_section.workspace_id;
  -- Ids and counts only, like the other deletions: no title, no text.
  v_details := jsonb_build_object(
      'section_id', v_section.id,
      'parent_id', v_section.parent_id,
      'actor_role', v_role
    )
    || private.section_contents(v_section.id)
    || jsonb_build_object('files_queued', private.queue_section_files(v_section.workspace_id, v_ids));

  -- Subsections and files go with it (on delete cascade).
  delete from public.report_sections s where s.id = v_section.id;

  insert into private.audit_events (action, actor_id, organization_id, workspace_id, report_id, details)
  values ('section_deleted', v_actor, v_org, v_section.workspace_id, v_section.report_id, v_details);
  return v_details;
end;
$$;

alter table private.audit_events drop constraint if exists audit_events_action_check;
alter table private.audit_events add constraint audit_events_action_check
  check (action in (
    'report_deleted', 'workspace_deleted', 'organization_deleted', 'organization_transferred',
    'section_deleted'
  ));

-- Every deletion of a section goes through delete_report_section. The
-- foreign keys still delete sections with their report or their parent.
drop policy if exists "report_sections: managers delete open sections" on public.report_sections;
revoke delete on public.report_sections from authenticated;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.check_section_parent() from public, anon, authenticated;
revoke all on function private.section_contents(uuid) from public, anon, authenticated;
revoke all on function private.queue_section_files(uuid, uuid[]) from public, anon, authenticated;

revoke all on function public.reorder_report_sections(uuid, uuid[]) from public, anon;
revoke all on function public.section_deletion_preview(uuid) from public, anon;
revoke all on function public.delete_report_section(uuid) from public, anon;
grant execute on function public.reorder_report_sections(uuid, uuid[]) to authenticated;
grant execute on function public.section_deletion_preview(uuid) to authenticated;
grant execute on function public.delete_report_section(uuid) to authenticated;
