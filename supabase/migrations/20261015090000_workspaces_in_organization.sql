-- =============================================================================
-- KolabReport: workspaces inside an existing organization (KRB-175, PR 175-1)
--
-- Billing counts per organization (docs/adr/001-billing-and-fedapay.md, 3.2),
-- so a firm adds its new engagements to the organization it already has
-- instead of opening a new one each time.
--
-- 1. private.can_add_workspace(): the rule of the "workspaces: organization
--    owner or manager creates" policy, as a function.
-- 2. create_workspace_in_organization() adds a workspace, the caller's owner
--    membership and a first report to an existing organization, in one
--    transaction. Same name checks and error codes as
--    create_workspace_with_owner(), which stays as it is.
-- 3. my_manageable_organizations() lists the organizations the caller can
--    add a workspace to, for the first step of the wizard.
--
-- New reports need no function: the "reports: managers create" policy and
-- the column grant already let owners and admins insert them. The billing
-- checks come with PR 175-3.
--
-- Error codes:
--   42501  signed out, or not allowed to add a workspace to the organization
--   22023  a name or title outside its length limits
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Who can add a workspace to an organization
-- -----------------------------------------------------------------------------
-- The organization owner, or an owner or admin of one of its workspaces.
-- Keep it in line with the workspaces insert policy and with
-- my_manageable_organizations() below.
create or replace function private.can_add_workspace(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = org and o.owner_id = (select auth.uid())
  ) or exists (
    select 1
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where w.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function private.can_add_workspace(uuid) from public;
grant execute on function private.can_add_workspace(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. A workspace and its first report in an existing organization
-- -----------------------------------------------------------------------------
create or replace function public.create_workspace_in_organization(
  p_organization_id uuid,
  p_workspace_name text,
  p_report_title text
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
  v_ws_name      text := regexp_replace(coalesce(p_workspace_name, ''), '^\s+|\s+$', '', 'g');
  v_report_title text := regexp_replace(coalesce(p_report_title, ''), '^\s+|\s+$', '', 'g');
  v_ws           uuid;
  v_report       uuid;
begin
  if v_user is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  -- An organization the caller cannot see answers like one they cannot
  -- manage, so the error says nothing about which ids exist.
  if p_organization_id is null or not private.can_add_workspace(p_organization_id) then
    raise exception 'Vous ne pouvez pas ajouter d''espace de travail à cette organisation' using errcode = '42501';
  end if;
  if char_length(v_ws_name) not between 2 and 120 then
    raise exception 'Le nom de l''espace de travail doit faire entre 2 et 120 caractères' using errcode = '22023';
  end if;
  if char_length(v_report_title) not between 2 and 200 then
    raise exception 'Le titre du rapport doit faire entre 2 et 200 caractères' using errcode = '22023';
  end if;

  -- The on_workspace_created trigger makes the creator the owner.
  insert into public.workspaces (organization_id, name, created_by)
  values (p_organization_id, v_ws_name, v_user)
  returning id into v_ws;

  insert into public.reports (workspace_id, title, created_by)
  values (v_ws, v_report_title, v_user)
  returning id into v_report;

  return query select p_organization_id, v_ws, v_report;
end;
$$;

revoke all on function public.create_workspace_in_organization(uuid, text, text) from public, anon;
grant execute on function public.create_workspace_in_organization(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Organizations the caller can add a workspace to
-- -----------------------------------------------------------------------------
-- Runs with the caller's rights: RLS already shows every organization they
-- belong to, and their own memberships. Starts from the caller's rows so the
-- indexes on owner_id and user_id do the work. Same rule as
-- private.can_add_workspace().
create or replace function public.my_manageable_organizations()
returns table (id uuid, name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id, o.name
  from public.organizations o
  where o.owner_id = (select auth.uid())
  union
  select o.id, o.name
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  join public.organizations o on o.id = w.organization_id
  where m.user_id = (select auth.uid())
    and m.role in ('owner', 'admin')
  order by name, id;
$$;

revoke all on function public.my_manageable_organizations() from public, anon;
grant execute on function public.my_manageable_organizations() to authenticated;
