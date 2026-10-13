-- =============================================================================
-- KolabReport: initial multi-tenant schema (Story KRB-1.2)
--
-- Tenancy model:
--   organization 1─* workspace 1─* report 1─* report_section 1─* deliverable
--   workspace_members links profiles to workspaces with a role.
-- Every tenant-owned row carries workspace_id, and every table has RLS enabled.
-- Authorization helpers live in the non-exposed `private` schema and are
-- SECURITY DEFINER so policies on workspace_members do not recurse.
-- =============================================================================

create extension if not exists "pgcrypto" with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.workspace_role as enum ('owner', 'admin', 'expert', 'viewer');
create type public.report_status  as enum ('draft', 'in_review', 'final');
create type public.section_status as enum ('not_started', 'in_progress', 'completed');
create type public.parse_status   as enum ('pending', 'processing', 'parsed', 'failed');

-- -----------------------------------------------------------------------------
-- Generic updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  owner_id    uuid not null references auth.users (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index organizations_owner_id_idx on public.organizations (owner_id);

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  job_title   text,
  locale      text not null default 'fr',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- workspaces
-- -----------------------------------------------------------------------------
create table public.workspaces (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 120),
  description      text,
  created_by       uuid not null default auth.uid() references public.profiles (id),
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index workspaces_organization_id_idx on public.workspaces (organization_id);

-- -----------------------------------------------------------------------------
-- workspace_members
-- -----------------------------------------------------------------------------
create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          public.workspace_role not null default 'expert',
  invited_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- -----------------------------------------------------------------------------
-- reports
-- -----------------------------------------------------------------------------
create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  title         text not null check (char_length(title) between 2 and 200),
  description   text,
  status        public.report_status not null default 'draft',
  due_date      date,
  created_by    uuid not null default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Composite key target so children can enforce workspace consistency.
  unique (id, workspace_id)
);
create index reports_workspace_id_idx on public.reports (workspace_id);

-- -----------------------------------------------------------------------------
-- report_sections
-- -----------------------------------------------------------------------------
create table public.report_sections (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  report_id        uuid not null,
  parent_id        uuid references public.report_sections (id) on delete cascade,
  title            text not null check (char_length(title) between 1 and 200),
  instructions     text,
  position         integer not null default 0,
  status           public.section_status not null default 'not_started',
  -- Relative weight in the report completion percentage (Story KRB-5.2).
  weight           numeric(6, 2) not null default 1 check (weight > 0),
  assigned_to      uuid references public.profiles (id) on delete set null,
  content          text,                 -- current draft (Markdown)
  ai_draft         jsonb,                -- last structured AI output (Story KRB-4.2)
  ai_generated_at  timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (report_id, workspace_id)
    references public.reports (id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);
create index report_sections_report_id_idx   on public.report_sections (report_id, position);
create index report_sections_workspace_id_idx on public.report_sections (workspace_id);
create index report_sections_assigned_to_idx on public.report_sections (assigned_to);

-- -----------------------------------------------------------------------------
-- deliverables (expert uploads; files live in the `deliverables` bucket)
-- -----------------------------------------------------------------------------
create table public.deliverables (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  section_id      uuid not null,
  uploaded_by     uuid not null default auth.uid() references public.profiles (id),
  storage_path    text not null unique,  -- {workspace_id}/{section_id}/{uuid}-{filename}
  file_name       text not null,
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  parse_status    public.parse_status not null default 'pending',
  parsed_content  text,
  parse_error     text,
  parsed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (section_id, workspace_id)
    references public.report_sections (id, workspace_id) on delete cascade,
  check (storage_path like workspace_id::text || '/' || section_id::text || '/%')
);
create index deliverables_section_id_idx   on public.deliverables (section_id);
create index deliverables_workspace_id_idx on public.deliverables (workspace_id);

-- -----------------------------------------------------------------------------
-- prompt_library (workspace_id NULL = global template, managed by platform)
-- -----------------------------------------------------------------------------
create table public.prompt_library (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces (id) on delete cascade,
  title         text not null check (char_length(title) between 2 and 200),
  description   text,
  category      text not null default 'general',
  template      text not null,
  -- Declared template variables, e.g. ["section_title", "deliverables"].
  variables     jsonb not null default '[]'::jsonb check (jsonb_typeof(variables) = 'array'),
  version       integer not null default 1 check (version > 0),
  is_active     boolean not null default true,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index prompt_library_workspace_id_idx on public.prompt_library (workspace_id);

-- updated_at triggers
create trigger set_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.workspaces
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.reports
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.report_sections
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.deliverables
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.prompt_library
  for each row execute function private.set_updated_at();

-- =============================================================================
-- Authorization helpers (SECURITY DEFINER, bypass RLS, fixed search_path)
-- =============================================================================
create or replace function private.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_workspace_role(ws uuid, roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

create or replace function private.is_workspace_manager(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_workspace_role(ws, array['owner', 'admin']::public.workspace_role[]);
$$;

-- Managers can edit every section; experts only the sections assigned to them.
create or replace function private.can_edit_section(section uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.report_sections s
    where s.id = section
      and (
        private.is_workspace_manager(s.workspace_id)
        or (
          s.assigned_to = (select auth.uid())
          and private.has_workspace_role(s.workspace_id, array['expert']::public.workspace_role[])
        )
      )
  );
$$;

create or replace function private.shares_workspace_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

create or replace function private.is_organization_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o where o.id = org and o.owner_id = (select auth.uid())
  ) or exists (
    select 1
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where w.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

-- =============================================================================
-- Triggers with side effects
-- =============================================================================

-- Create a profile for every new auth user.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- The creator of a workspace becomes its owner.
create or replace function private.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function private.handle_new_workspace();

-- Keep completed_at in sync with status.
create or replace function private.sync_section_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger sync_completed_at
  before insert or update of status on public.report_sections
  for each row execute function private.sync_section_completed_at();

-- Experts may only change content/status of their own sections, never
-- reassign them, move them, or change their weight.
create or replace function private.guard_expert_section_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.is_workspace_manager(old.workspace_id) then
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

create trigger guard_expert_update
  before update on public.report_sections
  for each row execute function private.guard_expert_section_update();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.organizations     enable row level security;
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.reports           enable row level security;
alter table public.report_sections   enable row level security;
alter table public.deliverables      enable row level security;
alter table public.prompt_library    enable row level security;

-- organizations ---------------------------------------------------------------
create policy "organizations: members read"
  on public.organizations for select to authenticated
  using (private.is_organization_member(id));

create policy "organizations: users create their own"
  on public.organizations for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "organizations: owner updates"
  on public.organizations for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- profiles --------------------------------------------------------------------
create policy "profiles: read self and co-members"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_workspace_with(id));

create policy "profiles: update self"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- workspaces ------------------------------------------------------------------
create policy "workspaces: members read"
  on public.workspaces for select to authenticated
  using (private.is_workspace_member(id));

create policy "workspaces: organization owner or manager creates"
  on public.workspaces for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      exists (
        select 1 from public.organizations o
        where o.id = organization_id and o.owner_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.workspaces w
        join public.workspace_members m on m.workspace_id = w.id
        where w.organization_id = workspaces.organization_id
          and m.user_id = (select auth.uid())
          and m.role in ('owner', 'admin')
      )
    )
  );

create policy "workspaces: managers update"
  on public.workspaces for update to authenticated
  using (private.is_workspace_manager(id))
  with check (private.is_workspace_manager(id));

create policy "workspaces: owner deletes"
  on public.workspaces for delete to authenticated
  using (private.has_workspace_role(id, array['owner']::public.workspace_role[]));

-- workspace_members -----------------------------------------------------------
create policy "workspace_members: members read roster"
  on public.workspace_members for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- Admins may add experts/viewers/admins; only owners may grant 'owner'.
create policy "workspace_members: managers add"
  on public.workspace_members for insert to authenticated
  with check (
    private.is_workspace_manager(workspace_id)
    and (role <> 'owner' or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  );

create policy "workspace_members: managers change roles"
  on public.workspace_members for update to authenticated
  using (private.is_workspace_manager(workspace_id))
  with check (
    private.is_workspace_manager(workspace_id)
    and (role <> 'owner' or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  );

create policy "workspace_members: managers remove or members leave"
  on public.workspace_members for delete to authenticated
  using (private.is_workspace_manager(workspace_id) or user_id = (select auth.uid()));

-- reports ---------------------------------------------------------------------
create policy "reports: members read"
  on public.reports for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "reports: managers create"
  on public.reports for insert to authenticated
  with check (private.is_workspace_manager(workspace_id));

create policy "reports: managers update"
  on public.reports for update to authenticated
  using (private.is_workspace_manager(workspace_id))
  with check (private.is_workspace_manager(workspace_id));

create policy "reports: managers delete"
  on public.reports for delete to authenticated
  using (private.is_workspace_manager(workspace_id));

-- report_sections -------------------------------------------------------------
-- Experts see every section of their workspace (needed for the master report
-- and dashboard) but can only write to the ones assigned to them.
create policy "report_sections: members read"
  on public.report_sections for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "report_sections: managers create"
  on public.report_sections for insert to authenticated
  with check (private.is_workspace_manager(workspace_id));

create policy "report_sections: managers or assigned expert update"
  on public.report_sections for update to authenticated
  using (private.can_edit_section(id))
  with check (private.is_workspace_member(workspace_id));

create policy "report_sections: managers delete"
  on public.report_sections for delete to authenticated
  using (private.is_workspace_manager(workspace_id));

-- deliverables ----------------------------------------------------------------
create policy "deliverables: members read"
  on public.deliverables for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "deliverables: section editors upload"
  on public.deliverables for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and private.can_edit_section(section_id)
  );

-- Parsing results are written by the service role (bypasses RLS); users may
-- only rename their own files.
create policy "deliverables: uploader or manager updates"
  on public.deliverables for update to authenticated
  using (uploaded_by = (select auth.uid()) or private.is_workspace_manager(workspace_id))
  with check (private.can_edit_section(section_id));

create policy "deliverables: uploader or manager deletes"
  on public.deliverables for delete to authenticated
  using (uploaded_by = (select auth.uid()) or private.is_workspace_manager(workspace_id));

-- prompt_library --------------------------------------------------------------
create policy "prompt_library: read global and workspace templates"
  on public.prompt_library for select to authenticated
  using (workspace_id is null or private.is_workspace_member(workspace_id));

-- Global templates (workspace_id IS NULL) are managed with the service role only.
create policy "prompt_library: managers create workspace templates"
  on public.prompt_library for insert to authenticated
  with check (workspace_id is not null and private.is_workspace_manager(workspace_id));

create policy "prompt_library: managers update workspace templates"
  on public.prompt_library for update to authenticated
  using (workspace_id is not null and private.is_workspace_manager(workspace_id))
  with check (workspace_id is not null and private.is_workspace_manager(workspace_id));

create policy "prompt_library: managers delete workspace templates"
  on public.prompt_library for delete to authenticated
  using (workspace_id is not null and private.is_workspace_manager(workspace_id));

-- =============================================================================
-- Progress tracking (Story KRB-5.2)
-- Weighted completion: completed = 1, in_progress = 0.5, not_started = 0.
-- security_invoker makes the view respect the caller's RLS.
-- =============================================================================
create view public.report_progress
with (security_invoker = true)
as
select
  r.id            as report_id,
  r.workspace_id,
  count(s.id)                                           as total_sections,
  count(s.id) filter (where s.status = 'not_started')   as not_started_sections,
  count(s.id) filter (where s.status = 'in_progress')   as in_progress_sections,
  count(s.id) filter (where s.status = 'completed')     as completed_sections,
  coalesce(
    round(
      100 * sum(
        s.weight * case s.status
          when 'completed'   then 1.0
          when 'in_progress' then 0.5
          else 0.0
        end
      ) / nullif(sum(s.weight), 0),
      1
    ),
    0
  )                                                     as completion_percent,
  max(s.updated_at)                                     as last_activity_at
from public.reports r
left join public.report_sections s on s.report_id = r.id
group by r.id, r.workspace_id;

-- Grants (RLS still applies). Note: anon gets nothing.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.report_progress to authenticated;

-- Realtime: broadcast section changes for the live dashboard.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.report_sections;
  end if;
end;
$$;
