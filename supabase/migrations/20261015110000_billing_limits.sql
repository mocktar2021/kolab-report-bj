-- =============================================================================
-- KolabReport: billing limits on members, reports, AI drafts and templates
-- (KRB-175, PR 175-3)
--
-- ADR 001 (docs/adr/001-billing-and-fedapay.md), sections 3.4 and 7. The app
-- checks first to explain the limit with numbers; these checks have the last
-- word.
--
-- * Each check takes the organization lock (private.billing_lock_org), then
--   reads the state and counts, so two transactions of the same organization
--   run one after the other. start_ai_generation takes it after its user and
--   workspace locks; every other path takes only this one.
-- * The state comes first. In read-only, private.workspace_access still
--   returns the limits of the last entitlement: read-only refuses the write
--   whatever they say. A revoked entitlement gives way to the one before it,
--   with its own dates, grace and limits.
-- * Members: distinct e-mail addresses with a non-viewer role in the covered
--   workspaces, open invitations included, counted by private.billing_usage
--   like the usage meter. Checked when an invitation is sent or an expired
--   one is sent again, when a viewer gets another role, when someone accepts
--   an invitation (members only: the invitation held the seat), and when a
--   workspace is added to an organization (its creator becomes owner).
-- * Reports: draft and in-review ones for the subscription, every report for
--   a pass. Checked when a report is created or reopened. An organization
--   that never had an entitlement still gets its first workspace and report,
--   so create_workspace_with_owner can finish (ADR 7.1, Q9).
-- * AI drafts: start_ai_generation reserves one in public.billing_draft_usage
--   before its insert, from the plan's allowance or else a Pack IA. The
--   reservation counts when the generation succeeds and is released when it
--   fails. A reservation older than 10 minutes belongs to a dead request (the
--   draft route stops after 5) and no longer counts.
-- * Custom prompt templates (a prompt_library row with a workspace_id) need
--   an entitlement with custom_templates to be created, published, rolled
--   out or used for a draft. Archiving stays open.
-- * The triggers check writes made in a user's name (auth.uid() set),
--   definer functions included. Server writes with the service role are not
--   checked; start_ai_generation, which runs for a user, checks explicitly.
--   Before RLS, the triggers answer only people who could make the change,
--   so nobody else learns about an organization's limits.
-- * Nothing changes while private.billing_settings.enforced is false.
--
-- Error codes:
--   KR040  adding this person would pass the member limit
--   KR041  accepting this invitation would pass the member limit
--   KR042  creating or reopening this report would pass the report limit
--   KR043  the workspace is read-only (nothing running, grace over)
--   KR044  custom prompt templates are not in this plan
-- start_ai_generation refuses with readOnly, templateNotIncluded and
-- quotaExceeded (retry_after: seconds to the next month for a monthly
-- allowance, null otherwise).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- AI draft ledger
-- -----------------------------------------------------------------------------
-- Keyed by organization and kept when the generation or its workspace goes,
-- so deleting a workspace never gives drafts back (ADR 3.4).
create table if not exists public.billing_draft_usage (
  -- No foreign key: the generation may go with its workspace, the usage stays.
  generation_id    uuid primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  workspace_id     uuid references public.workspaces (id) on delete set null,
  pool             text not null check (pool in ('subscription', 'trial', 'mission', 'pack')),
  entitlement_id   uuid references public.billing_entitlements (id) on delete set null,
  pack_id          uuid references public.billing_ai_packs (id) on delete set null,
  -- First day of the UTC month, the month of the token budget.
  usage_month      date not null check (usage_month = date_trunc('month', usage_month)::date),
  status           text not null default 'reserved' check (status in ('reserved', 'counted', 'released')),
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  check ((pool = 'pack') = (pack_id is not null)),
  check ((status = 'reserved') = (settled_at is null))
);

comment on table public.billing_draft_usage is
  'AI drafts reserved and counted per organization (ADR 001, 3.4). Written by start_ai_generation and the ai_generations triggers only.';

create index if not exists billing_draft_usage_month_idx
  on public.billing_draft_usage (organization_id, usage_month) where status <> 'released';
create index if not exists billing_draft_usage_entitlement_idx
  on public.billing_draft_usage (entitlement_id) where status <> 'released';
create index if not exists billing_draft_usage_pack_idx
  on public.billing_draft_usage (pack_id) where status <> 'released';
create index if not exists billing_draft_usage_workspace_idx
  on public.billing_draft_usage (workspace_id);

alter table public.billing_draft_usage enable row level security;

drop policy if exists "billing_draft_usage: billing readers read" on public.billing_draft_usage;
create policy "billing_draft_usage: billing readers read"
  on public.billing_draft_usage for select to authenticated
  using (private.can_read_org_billing(organization_id));

revoke all on public.billing_draft_usage from anon, authenticated;
grant select on public.billing_draft_usage to authenticated;

-- -----------------------------------------------------------------------------
-- Read-only
-- -----------------------------------------------------------------------------
-- KR043 when the line covering the workspace is read-only. KRB-178 adds the
-- guards on content tables that call it too.
create or replace function private.assert_workspace_writable(p_workspace_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from private.workspace_access(p_workspace_id) a where a.state = 'read_only') then
    raise exception 'Cet espace de travail est en lecture seule : renouvelez l''offre pour le modifier'
      using errcode = 'KR043';
  end if;
end;
$$;

-- An organization that never had an entitlement (the second one of a user
-- who used their trial) and has no report yet: its first report may go in,
-- so create_workspace_with_owner can finish. The rest stays read-only until
-- a purchase (ADR 7.1, Q9).
create or replace function private.billing_first_report(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.workspaces w
    join public.billing_entitlements b on b.organization_id = w.organization_id
    where w.id = p_workspace_id
  ) and not exists (
    select 1
    from public.workspaces w
    join public.workspaces sibling on sibling.organization_id = w.organization_id
    join public.reports r on r.workspace_id = sibling.id
    where w.id = p_workspace_id
  );
$$;

-- -----------------------------------------------------------------------------
-- Members (ADR 3.4)
-- -----------------------------------------------------------------------------
-- Raises unless one more person with p_email fits in the line: the
-- organization's subscription (p_workspace_id null) or the passes of one
-- mission workspace. The same person counts once, whatever the number of
-- workspaces and invitations. p_include_invitations is false at acceptance:
-- the invitation already held the seat.
create or replace function private.billing_check_line_seat(
  p_organization_id     uuid,
  p_workspace_id        uuid,
  p_email               text,
  p_include_invitations boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a          record;
  u          record;
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_already  boolean;
  v_taken    integer;
begin
  if not private.billing_enforced() then
    return;
  end if;

  perform private.billing_lock_org(p_organization_id);
  -- Read under the lock: a check that waited sees what the other committed.
  select * into a from private.billing_access(p_organization_id, p_workspace_id, now());
  if a.state = 'read_only' then
    raise exception 'Cet espace de travail est en lecture seule : renouvelez l''offre pour le modifier'
      using errcode = 'KR043';
  end if;
  if a.max_members is null then
    return;
  end if;

  select exists (
    select 1
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    join auth.users au on au.id = m.user_id
    where w.organization_id = p_organization_id
      and case when p_workspace_id is null then w.billing_mode = 'subscription' else w.id = p_workspace_id end
      and m.role <> 'viewer'
      and coalesce(lower(au.email), au.id::text) = v_email
  ) or (p_include_invitations and exists (
    select 1
    from public.workspace_invitations i
    join public.workspaces w on w.id = i.workspace_id
    where w.organization_id = p_organization_id
      and case when p_workspace_id is null then w.billing_mode = 'subscription' else w.id = p_workspace_id end
      and i.role <> 'viewer'
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
      and i.email = v_email
  ))
  into v_already;
  if v_already then
    return;
  end if;

  select * into u from private.billing_usage(p_organization_id, p_workspace_id);
  v_taken := u.members;
  if p_include_invitations then
    v_taken := v_taken + u.invitations;
  end if;
  if v_taken + 1 <= a.max_members then
    return;
  end if;
  if p_include_invitations then
    raise exception 'Limite de membres de l''offre atteinte, invitations en attente comprises'
      using errcode = 'KR040';
  end if;
  raise exception 'Limite de membres de l''offre atteinte : l''invitation ne peut pas être acceptée'
    using errcode = 'KR041';
end;
$$;

-- The same check for the line that covers a workspace.
create or replace function private.billing_check_seat(
  p_workspace_id        uuid,
  p_email               text,
  p_include_invitations boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_mission  uuid;
begin
  if not private.billing_enforced() then
    return;
  end if;
  select w.organization_id into v_org from public.workspaces w where w.id = p_workspace_id;
  if v_org is null then
    return;
  end if;
  -- The grant flips a workspace to mission under this lock: read the mode after it.
  perform private.billing_lock_org(v_org);
  select case when w.billing_mode = 'mission' then w.id end into v_mission
  from public.workspaces w where w.id = p_workspace_id;
  perform private.billing_check_line_seat(v_org, v_mission, p_email, p_include_invitations);
end;
$$;

-- A new subscription workspace makes its creator an owner. The first
-- workspace of an organization without any entitlement goes in (see
-- billing_first_report). Mission workspaces are created by the server.
create or replace function private.billing_workspace_seat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if (select auth.uid()) is null or new.billing_mode <> 'subscription' or not private.billing_enforced() then
    return new;
  end if;
  -- Before RLS: people who cannot add a workspace get its error, not ours.
  if not private.can_add_workspace(new.organization_id) then
    return new;
  end if;
  if not exists (select 1 from public.workspaces w where w.organization_id = new.organization_id)
     and not exists (select 1 from public.billing_entitlements b where b.organization_id = new.organization_id) then
    return new;
  end if;
  select coalesce(lower(u.email), u.id::text) into v_email
  from auth.users u where u.id = coalesce(new.created_by, (select auth.uid()));
  perform private.billing_check_line_seat(new.organization_id, null, v_email, true);
  return new;
end;
$$;

drop trigger if exists limit_seats on public.workspaces;
create trigger limit_seats
  before insert on public.workspaces
  for each row execute function private.billing_workspace_seat();

-- Invitations: nothing goes out from a read-only workspace, viewers
-- included. A new invitation with another role, or an expired one sent
-- again, takes a seat; an open one sent again keeps the seat it holds.
create or replace function private.billing_invitation_seat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.billing_enforced() then
    return new;
  end if;
  -- Before RLS, like check_invitation_target: only managers hear about limits.
  if not private.is_workspace_manager(new.workspace_id) then
    return new;
  end if;
  if new.role = 'viewer' then
    perform private.assert_workspace_writable(new.workspace_id);
  elsif tg_op = 'INSERT' then
    perform private.billing_check_seat(new.workspace_id, new.email, true);
  elsif old.expires_at <= now() then
    perform private.billing_check_seat(new.workspace_id, new.email, true);
  else
    perform private.assert_workspace_writable(new.workspace_id);
  end if;
  return new;
end;
$$;

-- Named to run after check_invitation_target, so inviting a member says so.
drop trigger if exists limit_seats on public.workspace_invitations;
create trigger limit_seats
  before insert or update of expires_at, token_hash on public.workspace_invitations
  for each row execute function private.billing_invitation_seat();

-- Members: a viewer who gets another role takes a seat. Other role changes
-- add nobody, and a change to viewer frees a seat.
create or replace function private.billing_member_seat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if (select auth.uid()) is null or old.role <> 'viewer' or new.role = 'viewer' then
    return new;
  end if;
  select coalesce(lower(u.email), u.id::text) into v_email from auth.users u where u.id = new.user_id;
  perform private.billing_check_seat(new.workspace_id, v_email, true);
  return new;
end;
$$;

drop trigger if exists limit_seats on public.workspace_members;
create trigger limit_seats
  before update of role on public.workspace_members
  for each row execute function private.billing_member_seat();

-- Acceptance: the same as before, with the seat check first. Viewers are
-- free, and someone already in the workspace keeps their membership. Only
-- members count: the invitation held the seat until now (KR041).
create or replace function private.join_from_invitation(invitation_id uuid, member uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv       record;
  v_workspace uuid;
begin
  select i.workspace_id, i.email, i.role into v_inv
  from public.workspace_invitations i
  where i.id = invitation_id;
  if found and v_inv.role <> 'viewer' and not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = v_inv.workspace_id and m.user_id = member
  ) then
    perform private.billing_check_seat(v_inv.workspace_id, v_inv.email, false);
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  select i.workspace_id, member, i.role, i.invited_by
  from public.workspace_invitations i
  where i.id = invitation_id
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set accepted_at = now(), accepted_by = member
  where id = invitation_id
  returning workspace_id into v_workspace;

  return v_workspace;
end;
$$;

-- Accepts every open invitation sent to the signed-in user's confirmed
-- e-mail, as before. One that the organization's plan refuses (member limit
-- or read-only) is skipped and stays open: the invitation page says why.
create or replace function public.accept_my_pending_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_email text := private.my_confirmed_email();
  v_id    uuid;
  v_count integer := 0;
begin
  if v_user is null or v_email is null then
    return 0;
  end if;

  for v_id in
    select i.id
    from public.workspace_invitations i
    where i.email = v_email
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
    order by i.created_at
    for update skip locked
  loop
    begin
      perform private.join_from_invitation(v_id, v_user);
      v_count := v_count + 1;
    exception when sqlstate 'KR041' or sqlstate 'KR043' then
      null;
    end;
  end loop;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reports (ADR 3.4)
-- -----------------------------------------------------------------------------
-- Raises unless one more active report fits in the line that covers the
-- workspace. p_report_id is the report being reopened, null for a new one.
create or replace function private.billing_check_report_slot(p_workspace_id uuid, p_report_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  a      record;
  u      record;
begin
  if not private.billing_enforced() then
    return;
  end if;
  select w.organization_id into v_org from public.workspaces w where w.id = p_workspace_id;
  if v_org is null then
    return;
  end if;

  perform private.billing_lock_org(v_org);
  select * into a from private.workspace_access(p_workspace_id);
  if a.state = 'read_only' then
    if p_report_id is null and private.billing_first_report(p_workspace_id) then
      return;
    end if;
    raise exception 'Cet espace de travail est en lecture seule : renouvelez l''offre pour le modifier'
      using errcode = 'KR043';
  end if;
  if a.max_reports is null then
    return;
  end if;
  -- A pass covers one report whatever its status: reopening it adds nothing.
  if a.billing_mode = 'mission' and p_report_id is not null then
    return;
  end if;

  -- A report being reopened is final, so it is not in the count.
  select * into u
  from private.billing_usage(a.organization_id, case when a.billing_mode = 'mission' then p_workspace_id end);
  if u.reports + 1 > a.max_reports then
    raise exception 'Limite de rapports actifs de l''offre atteinte' using errcode = 'KR042';
  end if;
end;
$$;

-- New reports, and final reports reopened (final to draft), take a slot.
create or replace function private.billing_report_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- Before RLS: people who cannot create reports get its error, not ours.
    if not private.is_workspace_manager(new.workspace_id) then
      return new;
    end if;
    perform private.billing_check_report_slot(new.workspace_id, null);
  elsif old.status = 'final' and new.status <> 'final' then
    perform private.billing_check_report_slot(new.workspace_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists limit_reports on public.reports;
create trigger limit_reports
  before insert or update of status on public.reports
  for each row execute function private.billing_report_slot();

-- -----------------------------------------------------------------------------
-- Custom prompt templates (ADR 3.4)
-- -----------------------------------------------------------------------------
create or replace function private.billing_check_templates(p_workspace_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a record;
begin
  select * into a from private.workspace_access(p_workspace_id);
  if not found or not a.enforced then
    return;
  end if;
  if a.state = 'read_only' then
    raise exception 'Cet espace de travail est en lecture seule : renouvelez l''offre pour le modifier'
      using errcode = 'KR043';
  end if;
  if not a.custom_templates then
    raise exception 'Les modèles de prompt personnalisés ne sont pas inclus dans cette offre'
      using errcode = 'KR044';
  end if;
end;
$$;

-- Creating a version (a new template or an edit) and publishing one. Global
-- templates (no workspace_id) are not concerned. Templates kept from an
-- earlier plan can still be archived.
create or replace function private.billing_template_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or new.workspace_id is null then
    return new;
  end if;
  if not private.is_workspace_manager(new.workspace_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.status = old.status or new.status = 'archived') then
    return new;
  end if;
  perform private.billing_check_templates(new.workspace_id);
  return new;
end;
$$;

-- Named to run before prepare_prompt_version, which locks and numbers.
drop trigger if exists limit_templates on public.prompt_library;
create trigger limit_templates
  before insert or update of status on public.prompt_library
  for each row execute function private.billing_template_guard();

-- Rolling out: the same as before, with the template check once the caller
-- is known to manage the template.
create or replace function public.start_prompt_rollout(p_candidate_id uuid, p_percent smallint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.prompt_library;
  base uuid;
  new_id uuid;
begin
  select * into candidate from public.prompt_library p where p.id = p_candidate_id;
  if not found then
    raise exception 'Version introuvable' using errcode = 'P0002';
  end if;
  if candidate.workspace_id is null or not private.is_workspace_manager(candidate.workspace_id) then
    raise exception 'Seuls les propriétaires et administrateurs gèrent les déploiements' using errcode = '42501';
  end if;
  if candidate.status <> 'draft' then
    raise exception 'Seul un brouillon se déploie progressivement' using errcode = 'KR011';
  end if;
  if p_percent is null or p_percent not between 1 and 99 then
    raise exception 'Le pourcentage va de 1 à 99' using errcode = '22023';
  end if;
  perform private.billing_check_templates(candidate.workspace_id);

  perform private.lock_prompt_template(candidate.workspace_id, candidate.template_key);
  -- A publish may have finished while this call waited for the lock.
  select * into candidate from public.prompt_library p where p.id = p_candidate_id for update;
  if candidate.status <> 'draft' then
    raise exception 'Seul un brouillon se déploie progressivement' using errcode = 'KR011';
  end if;
  select p.id into base
  from public.prompt_library p
  where p.workspace_id = candidate.workspace_id and p.template_key = candidate.template_key and p.status = 'published';
  if base is null then
    raise exception 'Le modèle n''a pas de version publiée à remplacer' using errcode = 'KR012';
  end if;

  insert into public.prompt_rollouts (workspace_id, template_key, candidate_id, base_id, percent)
  values (candidate.workspace_id, candidate.template_key, candidate.id, base, p_percent)
  returning id into new_id;
  return new_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- AI drafts (ADR 3.4)
-- -----------------------------------------------------------------------------
-- Reserves one draft for p_generation_id, or says why not: readOnly,
-- templateNotIncluded (p_prompt_version_id is a workspace template) or
-- quotaExceeded. Where the draft comes from, in this order: the allowance of
-- the entitlement that covers the workspace (per organization and UTC month
-- for plans, whatever the entitlement row, so a renewal or an upgrade in the
-- middle of a month opens no second allowance; for the whole entitlement for
-- the trial and a pass), then the Pack IA that expires first and has drafts
-- left. A reservation counts until it is released, or for 10 minutes at
-- most while it stays reserved.
create or replace function private.billing_reserve_draft(
  p_workspace_id      uuid,
  p_generation_id     uuid,
  p_prompt_version_id uuid
)
returns table (refusal text, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  a            record;
  v_month      date := date_trunc('month', now() at time zone 'utc')::date;
  v_month_end  timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc' + interval '1 month';
  v_alive      timestamptz := now() - interval '10 minutes';
  v_pool       text;
  v_used       integer;
  v_pack       uuid;
begin
  if not private.billing_enforced() then
    return query select null::text, null::integer;
    return;
  end if;
  select w.organization_id into v_org from public.workspaces w where w.id = p_workspace_id;
  if v_org is null then
    return query select 'readOnly'::text, null::integer;
    return;
  end if;

  perform private.billing_lock_org(v_org);
  select * into a from private.workspace_access(p_workspace_id);
  if a.state = 'read_only' then
    return query select 'readOnly'::text, null::integer;
    return;
  end if;
  if not a.custom_templates and exists (
    select 1 from public.prompt_library p where p.id = p_prompt_version_id and p.workspace_id is not null
  ) then
    return query select 'templateNotIncluded'::text, null::integer;
    return;
  end if;

  v_pool := case
    when a.plan = 'trial' then 'trial'
    when a.billing_mode = 'mission' then 'mission'
    else 'subscription'
  end;

  if a.drafts_total is not null then
    -- Trial and pass: one allowance for the whole entitlement.
    select count(*) into v_used
    from public.billing_draft_usage d
    where d.entitlement_id = a.entitlement_id
      and d.pool = v_pool
      and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > v_alive));
    if v_used < a.drafts_total then
      insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id, usage_month)
      values (p_generation_id, v_org, p_workspace_id, v_pool, a.entitlement_id, v_month);
      return query select null::text, null::integer;
      return;
    end if;
  else
    -- Plans: per organization and calendar month (UTC).
    if a.drafts_per_month is not null then
      select count(*) into v_used
      from public.billing_draft_usage d
      where d.organization_id = v_org
        and d.usage_month = v_month
        and d.pool = v_pool
        and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > v_alive));
    end if;
    if a.drafts_per_month is null or v_used < a.drafts_per_month then
      insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id, usage_month)
      values (p_generation_id, v_org, p_workspace_id, v_pool, a.entitlement_id, v_month);
      return query select null::text, null::integer;
      return;
    end if;
  end if;

  -- The allowance is used up: Pack IA credits work in every workspace of the
  -- organization, mission workspaces included.
  select p.id into v_pack
  from public.billing_ai_packs p
  where p.organization_id = v_org
    and p.revoked_at is null
    and p.expires_at > now()
    and p.drafts > (
      select count(*)
      from public.billing_draft_usage d
      where d.pack_id = p.id
        and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > v_alive))
    )
  order by p.expires_at, p.id
  limit 1;
  if v_pack is not null then
    insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, pack_id, usage_month)
    values (p_generation_id, v_org, p_workspace_id, 'pack', v_pack, v_month);
    return query select null::text, null::integer;
    return;
  end if;

  return query select 'quotaExceeded'::text,
    case when a.drafts_per_month is not null
      then greatest(1, ceil(extract(epoch from v_month_end - now())))::integer
    end;
end;
$$;

-- A draft counts when it succeeds and gives its unit back when it fails,
-- stale ones included. Accepting or discarding it changes nothing.
create or replace function private.billing_settle_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'running' or new.status = 'running' then
    return null;
  end if;
  update public.billing_draft_usage d
  set status = case when new.status = 'succeeded' then 'counted' else 'released' end,
      settled_at = now()
  where d.generation_id = new.id and d.status = 'reserved';
  return null;
end;
$$;

drop trigger if exists billing_settle_draft on public.ai_generations;
create trigger billing_settle_draft
  after update of status on public.ai_generations
  for each row execute function private.billing_settle_draft();

-- A generation deleted while running (its workspace went) never succeeded.
create or replace function private.billing_release_deleted_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.billing_draft_usage d
  set status = 'released', settled_at = now()
  where d.generation_id = old.id and d.status = 'reserved';
  return null;
end;
$$;

drop trigger if exists billing_release_deleted_draft on public.ai_generations;
create trigger billing_release_deleted_draft
  after delete on public.ai_generations
  for each row execute function private.billing_release_deleted_draft();

-- The checks of 20261014000000_ai_observability_rollouts.sql, in the same
-- order, then the billing part just before the insert: under the
-- organization lock, the last one taken, read-only, custom templates and
-- one AI draft reserved for the new generation. Same arguments and result.
create or replace function public.start_ai_generation(
  p_workspace_id      uuid,
  p_section_id        uuid,
  p_user_id           uuid,
  p_prompt_version_id uuid,
  p_output_schema     text,
  p_schema_version    smallint,
  p_provider          text,
  p_model             text,
  p_params            jsonb,
  p_estimated_tokens  integer,
  p_rate_limit        integer,
  p_monthly_budget    bigint,
  -- Defaults to null so the app version still running between the migration
  -- and the deploy keeps calling it with twelve arguments.
  p_rollout_id        uuid default null
)
returns table (generation_id uuid, refusal text, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent    integer;
  freed_at  timestamptz;
  used      bigint;
  new_id    uuid;
  month_end timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc' + interval '1 month';
  billing   record;
begin
  -- Same order everywhere, so two requests never wait on each other's lock.
  perform pg_advisory_xact_lock(hashtextextended('ai_generations/user/' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('ai_generations/workspace/' || p_workspace_id::text, 0));

  if p_rollout_id is null then
    if not exists (
      select 1 from public.prompt_library p
      where p.id = p_prompt_version_id
        and p.status = 'published'
        and p.output_schema = p_output_schema
        and (p.workspace_id is null or p.workspace_id = p_workspace_id)
    ) then
      return query select null::uuid, 'templateUnavailable'::text, null::integer;
      return;
    end if;
  elsif not exists (
    select 1
    from public.prompt_rollouts r
    join public.prompt_library p on p.id = r.candidate_id
    where r.id = p_rollout_id
      and r.status = 'active'
      and r.candidate_id = p_prompt_version_id
      and p.status = 'draft'
      and p.workspace_id is not distinct from r.workspace_id
      and p.template_key = r.template_key
      and p.output_schema = p_output_schema
      and (r.workspace_id is null or r.workspace_id = p_workspace_id)
      and (r.target_workspace_id is null or r.target_workspace_id = p_workspace_id)
  ) then
    return query select null::uuid, 'templateUnavailable'::text, null::integer;
    return;
  end if;

  -- A draft still running after 10 minutes has died with its request.
  update public.ai_generations g
  set status = 'failed', error_code = 'stale', completed_at = now()
  where g.section_id = p_section_id and g.status = 'running' and g.created_at < now() - interval '10 minutes';

  select count(*) into recent
  from public.ai_generations g
  where g.requested_by = p_user_id and g.created_at > now() - interval '1 hour';
  if recent >= p_rate_limit then
    -- The request that has to leave the window before one more fits.
    select g.created_at into freed_at
    from public.ai_generations g
    where g.requested_by = p_user_id and g.created_at > now() - interval '1 hour'
    order by g.created_at
    offset (recent - p_rate_limit)
    limit 1;
    return query select null::uuid, 'rateLimited'::text,
      greatest(1, ceil(extract(epoch from freed_at + interval '1 hour' - now())))::integer;
    return;
  end if;

  if exists (select 1 from public.ai_generations g where g.section_id = p_section_id and g.status = 'running') then
    return query select null::uuid, 'busy'::text, null::integer;
    return;
  end if;

  select coalesce(sum(case when g.status = 'running' then g.estimated_tokens else g.total_tokens end), 0)
  into used
  from public.ai_generations g
  where g.workspace_id = p_workspace_id
    and g.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  if used + p_estimated_tokens > p_monthly_budget then
    return query select null::uuid, 'budgetExceeded'::text,
      greatest(1, ceil(extract(epoch from month_end - now())))::integer;
    return;
  end if;

  -- Billing (ADR 001, 3.4 and 7.1). Nothing is reserved while billing is
  -- not enforced.
  new_id := gen_random_uuid();
  select b.refusal, b.retry_after into billing
  from private.billing_reserve_draft(p_workspace_id, new_id, p_prompt_version_id) b;
  if billing.refusal is not null then
    return query select null::uuid, billing.refusal, billing.retry_after;
    return;
  end if;

  -- The hashes and the context are recorded when the generation ends.
  insert into public.ai_generations (
    id, workspace_id, section_id, requested_by, prompt_version_id, rollout_id, output_schema, schema_version,
    provider, model, params, estimated_tokens
  ) values (
    new_id, p_workspace_id, p_section_id, p_user_id, p_prompt_version_id, p_rollout_id, p_output_schema, p_schema_version,
    p_provider, p_model, coalesce(p_params, '{}'), p_estimated_tokens
  );

  return query select new_id, null::text, null::integer;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.assert_workspace_writable(uuid) from public, anon, authenticated;
revoke all on function private.billing_first_report(uuid) from public, anon, authenticated;
revoke all on function private.billing_check_line_seat(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function private.billing_check_seat(uuid, text, boolean) from public, anon, authenticated;
revoke all on function private.billing_workspace_seat() from public, anon, authenticated;
revoke all on function private.billing_invitation_seat() from public, anon, authenticated;
revoke all on function private.billing_member_seat() from public, anon, authenticated;
revoke all on function private.join_from_invitation(uuid, uuid) from public, anon, authenticated;
revoke all on function private.billing_check_report_slot(uuid, uuid) from public, anon, authenticated;
revoke all on function private.billing_report_slot() from public, anon, authenticated;
revoke all on function private.billing_check_templates(uuid) from public, anon, authenticated;
revoke all on function private.billing_template_guard() from public, anon, authenticated;
revoke all on function private.billing_reserve_draft(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.billing_settle_draft() from public, anon, authenticated;
revoke all on function private.billing_release_deleted_draft() from public, anon, authenticated;

revoke all on function public.accept_my_pending_invitations() from public, anon;
grant execute on function public.accept_my_pending_invitations() to authenticated;
revoke all on function public.start_prompt_rollout(uuid, smallint) from public, anon;
grant execute on function public.start_prompt_rollout(uuid, smallint) to authenticated;
revoke all on function public.start_ai_generation(
  uuid, uuid, uuid, uuid, text, smallint, text, text, jsonb, integer, integer, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.start_ai_generation(
  uuid, uuid, uuid, uuid, text, smallint, text, text, jsonb, integer, integer, bigint, uuid
) to service_role;
