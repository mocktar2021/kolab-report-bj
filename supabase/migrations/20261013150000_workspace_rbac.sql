-- =============================================================================
-- KolabReport: workspace management and RBAC (Story KRB-11)
--
-- 1. create_workspace_with_owner() creates an organization, a workspace and a
--    first report in one transaction. The creation wizard calls it.
-- 2. A workspace always keeps at least one owner.
-- 3. Admins manage admins, experts and viewers, never owners. Only the role
--    column of a membership can be updated.
-- 4. A section can only be assigned to an owner, admin or expert of its
--    workspace. It loses its assignee when that person leaves the workspace
--    or becomes a viewer.
--
-- Custom error codes, mapped to French messages in the app:
--   KR001  the change would leave the workspace without an owner
--   KR002  the assignee is not an owner, admin or expert of the workspace
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Workspace creation
-- -----------------------------------------------------------------------------

-- "Cabinet Énergie & Associés" -> "cabinet-energie-associes". Upper-case
-- accents are translated too because lower() only folds ASCII under the C
-- collation.
create or replace function private.slugify(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from left(
        trim(both '-' from regexp_replace(
          lower(translate(
            replace(replace(replace(replace(value, 'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'Æ', 'AE'),
            'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ',
            'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYY'
          )),
          '[^a-z0-9]+', '-', 'g'
        )),
        48
      )),
      ''
    ),
    'organisation'
  );
$$;

create or replace function public.create_workspace_with_owner(
  organization_name text,
  workspace_name text,
  report_title text
)
returns table (organization_id uuid, workspace_id uuid, report_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user         uuid := (select auth.uid());
  -- Trim every kind of whitespace, not only spaces (btrim's default).
  v_org_name     text := regexp_replace(coalesce(organization_name, ''), '^\s+|\s+$', '', 'g');
  v_ws_name      text := regexp_replace(coalesce(workspace_name, ''), '^\s+|\s+$', '', 'g');
  v_report_title text := regexp_replace(coalesce(report_title, ''), '^\s+|\s+$', '', 'g');
  v_slug         text;
  v_attempt      integer := 0;
  v_org          uuid;
  v_ws           uuid;
  v_report       uuid;
begin
  if v_user is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if char_length(v_org_name) not between 2 and 120 then
    raise exception 'Le nom de l''organisation doit faire entre 2 et 120 caractères' using errcode = '22023';
  end if;
  if char_length(v_ws_name) not between 2 and 120 then
    raise exception 'Le nom de l''espace de travail doit faire entre 2 et 120 caractères' using errcode = '22023';
  end if;
  if char_length(v_report_title) not between 2 and 200 then
    raise exception 'Le titre du rapport doit faire entre 2 et 200 caractères' using errcode = '22023';
  end if;

  -- A taken slug gets a random suffix. Retrying on the unique violation also
  -- covers two users creating the same name at the same time.
  v_slug := private.slugify(v_org_name);
  loop
    begin
      insert into public.organizations (name, slug, owner_id)
      values (v_org_name, v_slug, v_user)
      returning id into v_org;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 5 then
        raise;
      end if;
      v_slug := rtrim(left(private.slugify(v_org_name), 40), '-') || '-'
        || left(replace(gen_random_uuid()::text, '-', ''), 6);
    end;
  end loop;

  -- The on_workspace_created trigger makes the creator the owner.
  insert into public.workspaces (organization_id, name, created_by)
  values (v_org, v_ws_name, v_user)
  returning id into v_ws;

  insert into public.reports (workspace_id, title, created_by)
  values (v_ws, v_report_title, v_user)
  returning id into v_report;

  return query select v_org, v_ws, v_report;
end;
$$;

revoke all on function public.create_workspace_with_owner(text, text, text) from public, anon;
grant execute on function public.create_workspace_with_owner(text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. A workspace always keeps at least one owner
-- -----------------------------------------------------------------------------
create or replace function private.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only changes that take the owner role away from someone matter.
  if tg_op = 'UPDATE' then
    if old.role <> 'owner' or new.role = 'owner' then
      return new;
    end if;
  elsif old.role <> 'owner' then
    return old;
  end if;

  -- Deleting the workspace or the user's profile cascades here.
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id)
     or not exists (select 1 from public.profiles p where p.id = old.user_id) then
    return old;
  end if;

  -- Lock the workspace so two owners cannot demote each other at the same time.
  perform 1 from public.workspaces w where w.id = old.workspace_id for update;

  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = old.workspace_id
      and m.role = 'owner'
      and m.user_id <> old.user_id
  ) then
    raise exception 'Un espace de travail doit garder au moins un propriétaire' using errcode = 'KR001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger guard_last_owner
  before update of role or delete on public.workspace_members
  for each row execute function private.guard_last_owner();

-- -----------------------------------------------------------------------------
-- 3. Admins never touch owners; memberships only change role
-- -----------------------------------------------------------------------------
drop policy "workspace_members: managers change roles" on public.workspace_members;
create policy "workspace_members: managers change roles"
  on public.workspace_members for update to authenticated
  using (
    private.is_workspace_manager(workspace_id)
    and (role <> 'owner' or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  )
  with check (
    private.is_workspace_manager(workspace_id)
    and (role <> 'owner' or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  );

drop policy "workspace_members: managers remove or members leave" on public.workspace_members;
create policy "workspace_members: managers remove or members leave"
  on public.workspace_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (
      private.is_workspace_manager(workspace_id)
      and (role <> 'owner' or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
    )
  );

-- Moving a membership to another workspace or user is an add plus a remove,
-- so it goes through the insert and delete policies instead.
revoke update on public.workspace_members from authenticated;
grant update (role) on public.workspace_members to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Section assignees
-- -----------------------------------------------------------------------------
create or replace function private.check_section_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only a new or changed assignee is checked, so saving a section that
  -- sends its current assignee back never fails.
  if tg_op = 'UPDATE'
     and new.assigned_to is not distinct from old.assigned_to
     and new.workspace_id is not distinct from old.workspace_id then
    return new;
  end if;

  if new.assigned_to is not null and not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = new.workspace_id
      and m.user_id = new.assigned_to
      and m.role in ('owner', 'admin', 'expert')
  ) then
    raise exception 'Une section ne peut être attribuée qu''à un propriétaire, un administrateur ou un expert de l''espace de travail'
      using errcode = 'KR002';
  end if;
  return new;
end;
$$;

create trigger check_assignee
  before insert or update of assigned_to, workspace_id on public.report_sections
  for each row execute function private.check_section_assignee();

-- Sections assigned to someone who leaves the workspace or becomes a viewer
-- go back to "unassigned".
create or replace function private.unassign_former_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.role <> 'viewer' then
    return null;
  end if;
  -- The workspace is being deleted: its sections go with it.
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return null;
  end if;

  update public.report_sections s
  set assigned_to = null
  where s.workspace_id = old.workspace_id and s.assigned_to = old.user_id;
  return null;
end;
$$;

create trigger unassign_former_member
  after delete or update of role on public.workspace_members
  for each row execute function private.unassign_former_member();

-- The expert guard now ignores updates made by other triggers
-- (pg_trigger_depth() > 1), such as unassign_former_member when an expert
-- leaves. Direct updates from users are checked as before.
create or replace function private.guard_expert_section_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1
     and (select auth.uid()) is not null
     and not private.is_workspace_manager(old.workspace_id) then
    if new.assigned_to is distinct from old.assigned_to
       or new.weight      is distinct from old.weight
       or new.position    is distinct from old.position
       or new.parent_id   is distinct from old.parent_id
       or new.report_id   is distinct from old.report_id
       or new.workspace_id is distinct from old.workspace_id
       or new.title       is distinct from old.title then
      raise exception 'Seuls les propriétaires et administrateurs peuvent modifier la structure d''une section'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Sections already assigned to a viewer or to someone outside the workspace
-- go back to "unassigned", so existing data follows the new rule.
update public.report_sections s
set assigned_to = null
where s.assigned_to is not null
  and not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = s.workspace_id
      and m.user_id = s.assigned_to
      and m.role in ('owner', 'admin', 'expert')
  );

revoke all on function private.slugify(text) from public;
revoke all on function private.guard_last_owner() from public;
revoke all on function private.check_section_assignee() from public;
revoke all on function private.unassign_former_member() from public;
