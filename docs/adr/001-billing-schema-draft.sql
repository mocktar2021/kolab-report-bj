-- =============================================================================
-- DRAFT, NOT A MIGRATION. Never applied to any database.
--
-- Illustrates the schema of ADR 001 (docs/adr/001-billing-and-fedapay.md):
-- tables, constraints, indexes, RLS, and the helpers that decide access and
-- limits. The real migrations come with KRB-175 to KRB-179, split as in
-- docs/adr/001-billing-and-fedapay-plan.md, and may differ. The purchase,
-- grant and admin functions are only described (signatures and steps).
--
-- Custom error codes, mapped to French messages in the app:
--   KR040  adding this person would pass the member limit
--   KR041  accepting this invitation would pass the member limit
--   KR042  creating or reopening this report would pass the report limit
--   KR043  the workspace is read-only (no running entitlement)
--   KR044  custom prompt templates are not in this plan
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- Settings: one row. While `enforced` is false every check below passes, so
-- the stories can merge before the launch migration turns it on.
-- -----------------------------------------------------------------------------
create table private.billing_settings (
  id           boolean primary key default true check (id),
  enforced     boolean not null default false,
  launched_at  timestamptz,
  -- Copied into every receipt: name, address, IFU, RCCM, e-mail.
  seller       jsonb not null default '{}' check (jsonb_typeof(seller) = 'object')
);
insert into private.billing_settings default values;

alter table private.billing_settings enable row level security;
revoke all on private.billing_settings from public, anon, authenticated, service_role;

create or replace function private.billing_enforced()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.enforced from private.billing_settings s), false);
$$;

-- Trial terms, mirrored in src/lib/billing/catalog.ts (a unit test reads this file).
create or replace function private.billing_trial_terms()
returns table (length interval, max_members integer, max_reports integer, drafts_total integer, custom_templates boolean)
language sql
immutable
set search_path = ''
as $$
  select interval '14 days', 5, 1, 20, true;
$$;

-- -----------------------------------------------------------------------------
-- Workspaces: covered by the subscription or by Pass Mission entitlements.
-- Users keep UPDATE on (name, description, archived_at) only
-- (20261014130000_close_cross_tenant_writes.sql), so they cannot change it.
-- -----------------------------------------------------------------------------
alter table public.workspaces
  add column billing_mode text not null default 'subscription'
    check (billing_mode in ('subscription', 'mission')),
  -- Composite key target, so a pass names a workspace of its own organization.
  add constraint workspaces_id_organization_key unique (id, organization_id);

-- -----------------------------------------------------------------------------
-- Who reads and who pays (ADR 3.5)
-- -----------------------------------------------------------------------------
create or replace function private.can_read_org_billing(org uuid)
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
    where w.organization_id = org and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  );
$$;

create or replace function private.can_manage_org_billing(org uuid)
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
    where w.organization_id = org and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

-- Every billing check and the grant take this lock first, then count. Always
-- the last advisory lock of a transaction (start_ai_generation takes its user
-- and workspace locks before it).
create or replace function private.billing_lock_org(org uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('billing/org/' || org::text, 0));
$$;

-- -----------------------------------------------------------------------------
-- Buyer details of the organization, copied into receipts
-- -----------------------------------------------------------------------------
create table public.organization_billing (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  legal_name       text check (char_length(legal_name) between 2 and 200),
  address          text check (char_length(address) <= 500),
  tax_id           text check (char_length(tax_id) <= 40),   -- IFU in Benin
  billing_email    text check (billing_email = lower(btrim(billing_email))
                               and billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger set_updated_at before update on public.organization_billing
  for each row execute function private.set_updated_at();

alter table public.organization_billing enable row level security;

create policy "organization_billing: billing readers read"
  on public.organization_billing for select to authenticated
  using (private.can_read_org_billing(organization_id));

create policy "organization_billing: billing managers update"
  on public.organization_billing for update to authenticated
  using (private.can_manage_org_billing(organization_id))
  with check (private.can_manage_org_billing(organization_id));

revoke all on public.organization_billing from anon, authenticated;
grant select on public.organization_billing to authenticated;
grant update (legal_name, address, tax_id, billing_email) on public.organization_billing to authenticated;

-- -----------------------------------------------------------------------------
-- Entitlements: every right over time, with a copy of its limits.
-- Null limit = no limit.
-- -----------------------------------------------------------------------------
create table public.billing_entitlements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- Set for Pass Mission only.
  workspace_id      uuid,
  scope             text not null check (scope in ('subscription', 'mission')),
  plan              text not null check (plan in ('trial', 'independant', 'cabinet', 'institution', 'mission')),
  source            text not null check (source in ('trial', 'purchase', 'manual', 'launch')),
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  grace_days        smallint not null default 7 check (grace_days between 0 and 60),
  max_members       integer check (max_members > 0),
  -- Subscription: active reports (draft, in_review). Mission: every report of the workspace.
  max_reports       integer check (max_reports > 0),
  drafts_per_month  integer check (drafts_per_month >= 0),
  drafts_total      integer check (drafts_total >= 0),
  custom_templates  boolean not null default false,
  -- References billing_purchases (KRB-176), on delete set null.
  purchase_id       uuid,
  -- What this period cost, to convert unused days on an upgrade. 0 for trial and launch.
  amount_ht_xof     bigint not null default 0 check (amount_ht_xof >= 0),
  note              text check (char_length(note) <= 500),
  revoked_at        timestamptz,
  revoked_reason    text check (char_length(revoked_reason) <= 200),
  created_at        timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((scope = 'mission') = (workspace_id is not null)),
  check ((scope = 'mission') = (plan = 'mission')),
  check (drafts_per_month is null or drafts_total is null),
  check ((revoked_at is null) = (revoked_reason is null)),
  foreign key (workspace_id, organization_id)
    references public.workspaces (id, organization_id) on delete cascade,
  -- At any instant: one subscription entitlement per organization, one pass per workspace.
  constraint billing_entitlements_one_subscription
    exclude using gist (organization_id with =, tstzrange(starts_at, ends_at) with &&)
    where (scope = 'subscription' and revoked_at is null),
  constraint billing_entitlements_one_pass
    exclude using gist (workspace_id with =, tstzrange(starts_at, ends_at) with &&)
    where (scope = 'mission' and revoked_at is null)
);

create index billing_entitlements_org_idx on public.billing_entitlements (organization_id, ends_at desc);
create index billing_entitlements_ws_idx on public.billing_entitlements (workspace_id, ends_at desc)
  where workspace_id is not null;

alter table public.billing_entitlements enable row level security;

create policy "billing_entitlements: billing readers read"
  on public.billing_entitlements for select to authenticated
  using (private.can_read_org_billing(organization_id));

revoke all on public.billing_entitlements from anon, authenticated;
grant select on public.billing_entitlements to authenticated;

-- -----------------------------------------------------------------------------
-- Pack IA credits
-- -----------------------------------------------------------------------------
create table public.billing_ai_packs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  purchase_id      uuid,   -- references billing_purchases (KRB-176), on delete set null
  drafts           integer not null check (drafts > 0),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now()
);

create index billing_ai_packs_org_idx on public.billing_ai_packs (organization_id, expires_at);

alter table public.billing_ai_packs enable row level security;

create policy "billing_ai_packs: billing readers read"
  on public.billing_ai_packs for select to authenticated
  using (private.can_read_org_billing(organization_id));

revoke all on public.billing_ai_packs from anon, authenticated;
grant select on public.billing_ai_packs to authenticated;

-- -----------------------------------------------------------------------------
-- AI draft ledger. Outlives the generation and its workspace, so deleting a
-- workspace never gives drafts back.
-- -----------------------------------------------------------------------------
create table public.billing_draft_usage (
  generation_id    uuid primary key,   -- no foreign key on purpose
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  workspace_id     uuid references public.workspaces (id) on delete set null,
  pool             text not null check (pool in ('subscription', 'trial', 'mission', 'pack')),
  entitlement_id   uuid references public.billing_entitlements (id) on delete set null,
  pack_id          uuid references public.billing_ai_packs (id) on delete set null,
  usage_month      date not null,       -- first day of the UTC month
  status           text not null default 'reserved' check (status in ('reserved', 'counted', 'released')),
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  check ((pool = 'pack') = (pack_id is not null)),
  check ((status = 'reserved') = (settled_at is null))
);

create index billing_draft_usage_month_idx on public.billing_draft_usage (organization_id, usage_month)
  where status <> 'released';
create index billing_draft_usage_entitlement_idx on public.billing_draft_usage (entitlement_id)
  where status <> 'released';
create index billing_draft_usage_pack_idx on public.billing_draft_usage (pack_id)
  where status <> 'released';

alter table public.billing_draft_usage enable row level security;

create policy "billing_draft_usage: billing readers read"
  on public.billing_draft_usage for select to authenticated
  using (private.can_read_org_billing(organization_id));

revoke all on public.billing_draft_usage from anon, authenticated;
grant select on public.billing_draft_usage to authenticated;

-- -----------------------------------------------------------------------------
-- Private tables: no policy, no grant. Only the definer functions use them.
-- -----------------------------------------------------------------------------
create table private.billing_trial_claims (
  user_id          uuid primary key,
  -- sha256 of the confirmed e-mail in lower case: a deleted account coming
  -- back with the same address gets no second trial.
  email_hash       text not null unique check (email_hash ~ '^[0-9a-f]{64}$'),
  organization_id  uuid,
  claimed_at       timestamptz not null default now()
);

create table private.billing_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid,                -- kept after the organization is deleted
  kind             text not null check (kind in (
                     'trial_started', 'granted', 'converted', 'manual_grant', 'manual_revoke',
                     'refund_seen', 'review', 'launch_period', 'entered_grace', 'entered_read_only')),
  actor            text check (char_length(actor) <= 200),   -- operator, null for the system
  reason           text check (char_length(reason) <= 500),
  details          jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  created_at       timestamptz not null default now()
);
create index billing_events_org_idx on private.billing_events (organization_id, created_at desc);

create table private.billing_notices (
  entitlement_id  uuid not null references public.billing_entitlements (id) on delete cascade,
  kind            text not null check (kind in ('d7', 'd1', 'ended', 'read_only')),
  sent_at         timestamptz not null default now(),
  primary key (entitlement_id, kind)
);

create table private.billing_receipt_counters (
  seller       text not null,
  year         integer not null check (year between 2026 and 2200),
  last_number  integer not null check (last_number > 0),
  primary key (seller, year)
);

alter table private.billing_trial_claims enable row level security;
alter table private.billing_events enable row level security;
alter table private.billing_notices enable row level security;
alter table private.billing_receipt_counters enable row level security;
revoke all on private.billing_trial_claims, private.billing_events, private.billing_notices,
  private.billing_receipt_counters from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Access: the state of a workspace, computed from rows and time (ADR 6.1)
-- -----------------------------------------------------------------------------
create or replace function private.workspace_access(ws uuid, at timestamptz default now())
returns table (
  organization_id   uuid,
  billing_mode      text,
  state             text,          -- active | grace | read_only
  entitlement_id    uuid,          -- the one that applies, null when there is none
  plan              text,
  ends_at           timestamptz,
  grace_ends_at     timestamptz,
  max_members       integer,
  max_reports       integer,
  drafts_per_month  integer,
  drafts_total      integer,
  custom_templates  boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_mode  text;
  e       public.billing_entitlements;
begin
  select w.organization_id, w.billing_mode into v_org, v_mode from public.workspaces w where w.id = ws;
  if not found then
    return;
  end if;

  if not private.billing_enforced() then
    return query select v_org, v_mode, 'active'::text, null::uuid, null::text, null::timestamptz,
      null::timestamptz, null::integer, null::integer, null::integer, null::integer, true;
    return;
  end if;

  -- The entitlement covering `at` (the exclusion constraints allow one at
  -- most), else the last one that ended. Stacked periods that start later
  -- are ignored.
  select * into e
  from public.billing_entitlements b
  where b.revoked_at is null
    and b.starts_at <= at
    and case when v_mode = 'mission'
             then b.scope = 'mission' and b.workspace_id = ws
             else b.scope = 'subscription' and b.organization_id = v_org end
  order by (b.ends_at > at) desc, b.ends_at desc
  limit 1;

  if not found then
    return query select v_org, v_mode, 'read_only'::text, null::uuid, null::text, null::timestamptz,
      null::timestamptz, null::integer, null::integer, null::integer, null::integer, false;
    return;
  end if;

  -- In grace, the limits of the entitlement that ended still apply.
  return query select
    v_org,
    v_mode,
    case
      when e.ends_at > at then 'active'
      when at < e.ends_at + make_interval(days => e.grace_days) then 'grace'
      else 'read_only'
    end,
    e.id, e.plan, e.ends_at, e.ends_at + make_interval(days => e.grace_days),
    e.max_members, e.max_reports, e.drafts_per_month, e.drafts_total, e.custom_templates;
end;
$$;

create or replace function private.assert_workspace_writable(ws uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from private.workspace_access(ws) a where a.state = 'read_only') then
    raise exception 'Cet espace de travail est en lecture seule : renouvelez l''offre pour le modifier'
      using errcode = 'KR043';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Members (ADR 3.4): distinct e-mails with a non-viewer role in the covered
-- workspaces, open invitations included unless p_include_invitations is
-- false (acceptance: the invitation already holds the seat).
-- -----------------------------------------------------------------------------
create or replace function private.billing_check_seat(ws uuid, p_email text, p_include_invitations boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a          record;
  v_email    text := lower(btrim(p_email));
  v_others   integer;
  v_already  boolean;
begin
  if not private.billing_enforced() then
    return;
  end if;

  select w.organization_id into a from public.workspaces w where w.id = ws;
  perform private.billing_lock_org(a.organization_id);
  -- Read under the lock: a grant may have changed the limits meanwhile.
  select * into a from private.workspace_access(ws);

  if a.entitlement_id is null then
    raise exception 'Cette organisation n''a pas d''offre en cours' using errcode = 'KR043';
  end if;
  if a.max_members is null then
    return;
  end if;

  with covered as (
    select w.id
    from public.workspaces w
    where w.organization_id = a.organization_id
      and case when a.billing_mode = 'mission' then w.id = ws else w.billing_mode = 'subscription' end
  ), people as (
    select lower(u.email) as email
    from public.workspace_members m
    join auth.users u on u.id = m.user_id
    where m.workspace_id in (select c.id from covered c) and m.role <> 'viewer'
    union
    select i.email
    from public.workspace_invitations i
    where p_include_invitations
      and i.workspace_id in (select c.id from covered c)
      and i.role <> 'viewer'
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
  )
  select count(*) filter (where p.email <> v_email), coalesce(bool_or(p.email = v_email), false)
  into v_others, v_already
  from people p;

  if not v_already and v_others + 1 > a.max_members then
    raise exception 'Limite de membres atteinte pour cette offre'
      using errcode = case when p_include_invitations then 'KR040' else 'KR041' end;
  end if;
end;
$$;

-- Invitations: a new one, or an expired one sent again, takes a seat.
create or replace function private.billing_invitation_seat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- This trigger runs before RLS: answering anyone but a manager would tell
  -- them about the organization's limits (same rule as check_invitation_target).
  if not private.is_workspace_manager(new.workspace_id) then
    return new;
  end if;
  -- No invitation goes out from a read-only workspace, viewers included.
  perform private.assert_workspace_writable(new.workspace_id);
  -- Viewers are free, and an open invitation keeps the seat it already holds.
  if new.role = 'viewer' or (tg_op = 'UPDATE' and old.expires_at > now()) then
    return new;
  end if;
  perform private.billing_check_seat(new.workspace_id, new.email, true);
  return new;
end;
$$;

create trigger billing_seat
  before insert or update of expires_at, token_hash on public.workspace_invitations
  for each row execute function private.billing_invitation_seat();

-- Members: a viewer who gets another role takes a seat.
create or replace function private.billing_member_seat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if new.role = 'viewer' or old.role <> 'viewer' then
    return new;
  end if;
  select u.email into v_email from auth.users u where u.id = new.user_id;
  perform private.billing_check_seat(new.workspace_id, v_email, true);
  return new;
end;
$$;

create trigger billing_seat
  before update of role on public.workspace_members
  for each row execute function private.billing_member_seat();

-- private.join_from_invitation gets one line, before the insert:
--   perform private.billing_check_seat(i.workspace_id, i.email, false);
-- and accept_my_pending_invitations wraps each join in a begin ... exception
-- block that skips KR041, leaving that invitation open.

-- -----------------------------------------------------------------------------
-- Reports (ADR 3.4)
-- -----------------------------------------------------------------------------
-- An organization that never had an entitlement may still get its first
-- report, so create_workspace_with_owner can finish (ADR 7.1, Q9).
create or replace function private.billing_first_report(ws uuid)
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
    where w.id = ws
  ) and not exists (
    select 1
    from public.workspaces w
    join public.workspaces sibling on sibling.organization_id = w.organization_id
    join public.reports r on r.workspace_id = sibling.id
    where w.id = ws
  );
$$;

create or replace function private.billing_check_report_slot(ws uuid, p_report uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_count  integer;
begin
  if not private.billing_enforced() then
    return;
  end if;

  select w.organization_id into a from public.workspaces w where w.id = ws;
  perform private.billing_lock_org(a.organization_id);
  select * into a from private.workspace_access(ws);

  if a.entitlement_id is null then
    raise exception 'Cette organisation n''a pas d''offre en cours' using errcode = 'KR043';
  end if;
  if a.max_reports is null then
    return;
  end if;

  if a.billing_mode = 'mission' then
    -- A pass covers one report, whatever its status.
    select count(*) into v_count
    from public.reports r
    where r.workspace_id = ws and r.id <> p_report;
  else
    select count(*) into v_count
    from public.reports r
    join public.workspaces w on w.id = r.workspace_id
    where w.organization_id = a.organization_id
      and w.billing_mode = 'subscription'
      and r.status in ('draft', 'in_review')
      and r.id <> p_report;
  end if;

  if v_count + 1 > a.max_reports then
    raise exception 'Limite de rapports atteinte pour cette offre' using errcode = 'KR042';
  end if;
end;
$$;

create or replace function private.billing_report_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Before RLS: say nothing to people who cannot create reports anyway.
    if (select auth.uid()) is not null and not private.is_workspace_manager(new.workspace_id) then
      return new;
    end if;
    if private.billing_first_report(new.workspace_id) then
      return new;
    end if;
    if (select auth.uid()) is not null then
      perform private.assert_workspace_writable(new.workspace_id);
    end if;
    perform private.billing_check_report_slot(new.workspace_id, new.id);
  elsif old.status = 'final' and new.status <> 'final' then
    -- Reopening takes a slot again.
    perform private.billing_check_report_slot(new.workspace_id, new.id);
  end if;
  return new;
end;
$$;

create trigger billing_report_guard
  before insert or update of status on public.reports
  for each row execute function private.billing_report_guard();

-- -----------------------------------------------------------------------------
-- Read-only guard for content written in a user's name (ADR 7.3). Attached to
-- report_sections, deliverables, prompt_library and prompt_rollouts (insert,
-- update), reports (update). Invitations go through billing_invitation_seat.
-- Deletes are never blocked. transition_report_status and
-- private.can_upload_deliverable call assert_workspace_writable themselves.
-- -----------------------------------------------------------------------------
create or replace function private.guard_billing_writable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The service role does its own checks. Updates made by other triggers
  -- (unassign_former_member when someone leaves) are not user edits.
  if (select auth.uid()) is null or pg_trigger_depth() > 1 or new.workspace_id is null then
    return new;
  end if;
  perform private.assert_workspace_writable(new.workspace_id);
  return new;
end;
$$;

create trigger guard_billing_writable before insert or update on public.report_sections
  for each row execute function private.guard_billing_writable();
create trigger guard_billing_writable before insert or update on public.deliverables
  for each row execute function private.guard_billing_writable();
create trigger guard_billing_writable before update on public.reports
  for each row execute function private.guard_billing_writable();
create trigger guard_billing_writable before insert or update on public.prompt_library
  for each row execute function private.guard_billing_writable();
create trigger guard_billing_writable before insert or update on public.prompt_rollouts
  for each row execute function private.guard_billing_writable();

-- Custom templates (KR044) follow the same shape: a before insert or update
-- trigger on prompt_library, for rows with a workspace_id, raises KR044 when
-- the workspace's entitlement has custom_templates false.

-- -----------------------------------------------------------------------------
-- AI drafts (ADR 3.4). Called by start_ai_generation under the organization
-- lock, after its own checks and before its insert. Returns null when a unit
-- is reserved, else the refusal. start_ai_generation also refuses
-- 'templateNotIncluded' when the template has a workspace_id and
-- custom_templates is false.
-- -----------------------------------------------------------------------------
create or replace function private.billing_reserve_draft(ws uuid, generation uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_month  date := date_trunc('month', now() at time zone 'utc')::date;
  v_used   integer;
  v_pack   uuid;
  v_pool   text;
begin
  if not private.billing_enforced() then
    return null;
  end if;

  select w.organization_id into a from public.workspaces w where w.id = ws;
  perform private.billing_lock_org(a.organization_id);
  select * into a from private.workspace_access(ws);

  if a.state = 'read_only' then
    return 'readOnly';
  end if;

  if a.drafts_total is not null then
    -- Trial and pass: one allowance for the whole entitlement.
    v_pool := case when a.billing_mode = 'mission' then 'mission' else 'trial' end;
    select count(*) into v_used
    from public.billing_draft_usage d
    where d.entitlement_id = a.entitlement_id and d.pool = v_pool and d.status <> 'released';
    if v_used < a.drafts_total then
      insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id, usage_month)
      values (generation, a.organization_id, ws, v_pool, a.entitlement_id, v_month);
      return null;
    end if;
  else
    -- Plans: per organization and calendar month (UTC), whatever the entitlement row.
    select count(*) into v_used
    from public.billing_draft_usage d
    where d.organization_id = a.organization_id
      and d.pool = 'subscription'
      and d.usage_month = v_month
      and d.status <> 'released';
    if a.drafts_per_month is null or v_used < a.drafts_per_month then
      insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id, usage_month)
      values (generation, a.organization_id, ws, 'subscription', a.entitlement_id, v_month);
      return null;
    end if;
  end if;

  -- Allowance used up: the pack that expires first and still has drafts.
  select p.id into v_pack
  from public.billing_ai_packs p
  where p.organization_id = a.organization_id
    and p.revoked_at is null
    and p.expires_at > now()
    and p.drafts > (
      select count(*) from public.billing_draft_usage d where d.pack_id = p.id and d.status <> 'released'
    )
  order by p.expires_at
  limit 1;

  if v_pack is not null then
    insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, pack_id, usage_month)
    values (generation, a.organization_id, ws, 'pack', v_pack, v_month);
    return null;
  end if;

  return 'quotaExceeded';
end;
$$;

-- A draft counts when it succeeds, and gives its unit back when it fails.
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

create trigger billing_settle_draft
  after update of status on public.ai_generations
  for each row execute function private.billing_settle_draft();

-- -----------------------------------------------------------------------------
-- New organization: buyer row, and a trial when the owner never had one
-- -----------------------------------------------------------------------------
create or replace function private.billing_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash  text;
  t       record;
begin
  insert into public.organization_billing (organization_id) values (new.id);

  select encode(sha256(convert_to(lower(u.email), 'UTF8')), 'hex') into v_hash
  from auth.users u where u.id = new.owner_id;

  if exists (
    select 1 from private.billing_trial_claims c
    where c.user_id = new.owner_id or c.email_hash = v_hash
  ) then
    -- No trial: read-only until a purchase.
    return null;
  end if;

  select * into t from private.billing_trial_terms();
  insert into public.billing_entitlements (
    organization_id, scope, plan, source, starts_at, ends_at,
    max_members, max_reports, drafts_total, custom_templates
  ) values (
    new.id, 'subscription', 'trial', 'trial', now(), now() + t.length,
    t.max_members, t.max_reports, t.drafts_total, t.custom_templates
  );
  insert into private.billing_trial_claims (user_id, email_hash, organization_id)
  values (new.owner_id, v_hash, new.id);
  insert into private.billing_events (organization_id, kind, details)
  values (new.id, 'trial_started', jsonb_build_object('ends_at', now() + t.length));
  return null;
end;
$$;

create trigger billing_new_organization
  after insert on public.organizations
  for each row execute function private.billing_new_organization();

-- -----------------------------------------------------------------------------
-- What members see about their workspace: state and dates, no amounts
-- -----------------------------------------------------------------------------
create or replace function public.workspace_billing_state(p_workspace_id uuid)
returns table (state text, plan text, ends_at timestamptz, grace_ends_at timestamptz,
               max_members integer, max_reports integer, can_pay boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when a.state = 'active' and a.plan = 'trial' then 'trialing' else a.state end,
    a.plan, a.ends_at, a.grace_ends_at, a.max_members, a.max_reports,
    private.can_manage_org_billing(a.organization_id)
  from private.workspace_access(p_workspace_id) a
  where private.is_workspace_member(p_workspace_id);
$$;

-- public.billing_overview(p_organization_id uuid) returns jsonb, for billing
-- readers only: state, plan, dates, limits, and the counts behind the usage
-- meter (members, open invitations, active reports, drafts this month, packs
-- left, passes per workspace). Counts only, no names: an admin of one
-- workspace does not see the roster of the others.

-- -----------------------------------------------------------------------------
-- Purchases, payment history and receipts (KRB-176)
-- -----------------------------------------------------------------------------
create table public.billing_purchases (
  id                      uuid primary key default gen_random_uuid(),
  -- Accounting records outlive the organization.
  organization_id         uuid references public.organizations (id) on delete set null,
  workspace_id            uuid references public.workspaces (id) on delete set null,
  offer                   text not null check (offer in (
                            'independant_1m', 'independant_3m', 'independant_12m',
                            'cabinet_1m', 'cabinet_3m', 'cabinet_12m',
                            'mission_pass', 'ai_pack_100', 'institution', 'manual')),
  offer_label             text not null check (char_length(offer_label) between 2 and 200),
  catalog_version         smallint not null check (catalog_version > 0),
  quantity                smallint not null default 1 check (quantity between 1 and 10),
  amount_ht_xof           bigint not null check (amount_ht_xof >= 0),
  tax_xof                 bigint not null default 0 check (tax_xof >= 0),
  amount_xof              bigint not null,
  currency                text not null default 'XOF' check (currency = 'XOF'),
  method                  text not null default 'fedapay' check (method in ('fedapay', 'bank_transfer', 'manual')),
  environment             text not null check (environment in ('sandbox', 'live', 'mock', 'manual')),
  status                  text not null default 'pending'
                            check (status in ('pending', 'paid', 'expired', 'refunded', 'review')),
  merchant_reference      text not null unique check (merchant_reference ~ '^KR-[0-9a-f-]{36}$'),
  fedapay_transaction_id  bigint,
  fedapay_status          text check (char_length(fedapay_status) <= 60),
  fedapay_mode            text check (char_length(fedapay_mode) <= 60),
  fedapay_fees_xof        bigint check (fedapay_fees_xof >= 0),
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  paid_at                 timestamptz,
  granted_at              timestamptz,
  last_checked_at         timestamptz,
  confirmation_sent_at    timestamptz,
  check (amount_xof = amount_ht_xof + tax_xof),
  check (method <> 'fedapay' or amount_xof > 0),
  check (status not in ('paid', 'refunded') or paid_at is not null),
  unique (environment, fedapay_transaction_id)
);

create index billing_purchases_org_idx on public.billing_purchases (organization_id, created_at desc);
create index billing_purchases_pending_idx on public.billing_purchases (created_at) where status = 'pending';

create trigger set_updated_at before update on public.billing_purchases
  for each row execute function private.set_updated_at();

alter table public.billing_entitlements
  add constraint billing_entitlements_purchase_fkey
  foreign key (purchase_id) references public.billing_purchases (id) on delete set null;
alter table public.billing_ai_packs
  add constraint billing_ai_packs_purchase_fkey
  foreign key (purchase_id) references public.billing_purchases (id) on delete set null;

alter table public.billing_purchases enable row level security;

create policy "billing_purchases: billing readers read"
  on public.billing_purchases for select to authenticated
  using (private.can_read_org_billing(organization_id));

revoke all on public.billing_purchases from anon, authenticated;
grant select on public.billing_purchases to authenticated;

-- No raw payload: FedaPay events carry the customer's e-mail and phone.
create table private.billing_payment_events (
  id                bigint generated always as identity primary key,
  purchase_id       uuid not null references public.billing_purchases (id) on delete cascade,
  source            text not null check (source in ('checkout', 'webhook', 'return', 'reconcile', 'manual')),
  fedapay_event_id  text check (char_length(fedapay_event_id) <= 100),
  event_name        text check (char_length(event_name) <= 100),
  fedapay_status    text check (char_length(fedapay_status) <= 60),
  amount_xof        bigint,
  received_at       timestamptz not null default now()
);
create unique index billing_payment_events_once_idx
  on private.billing_payment_events (source, fedapay_event_id) where fedapay_event_id is not null;
create index billing_payment_events_purchase_idx on private.billing_payment_events (purchase_id, received_at);

alter table private.billing_payment_events enable row level security;
revoke all on private.billing_payment_events from public, anon, authenticated, service_role;

create table public.billing_receipts (
  id                        uuid primary key default gen_random_uuid(),
  number                    text not null unique check (number ~ '^(KR|AV)-[0-9]{4}-[0-9]{6}$'),
  kind                      text not null default 'receipt' check (kind in ('receipt', 'credit_note')),
  purchase_id               uuid not null references public.billing_purchases (id) on delete restrict,
  organization_id           uuid references public.organizations (id) on delete set null,
  environment               text not null check (environment in ('sandbox', 'live', 'mock', 'manual')),
  issued_at                 timestamptz not null default now(),
  seller                    jsonb not null check (jsonb_typeof(seller) = 'object'),
  buyer                     jsonb not null check (jsonb_typeof(buyer) = 'object'),
  payment                   jsonb not null check (jsonb_typeof(payment) = 'object'),
  currency                  text not null default 'XOF' check (currency = 'XOF'),
  total_ht_xof              bigint not null check (total_ht_xof >= 0),
  total_tax_xof             bigint not null default 0 check (total_tax_xof >= 0),
  total_xof                 bigint not null,
  -- e-MECeF normalized invoice, later (ADR 9). The only columns that may change.
  external_invoice_number   text check (char_length(external_invoice_number) <= 100),
  external_invoice_data     jsonb check (external_invoice_data is null or jsonb_typeof(external_invoice_data) = 'object'),
  check (total_xof = total_ht_xof + total_tax_xof),
  unique (purchase_id, kind)
);

create index billing_receipts_org_idx on public.billing_receipts (organization_id, issued_at desc);

create table public.billing_receipt_lines (
  receipt_id         uuid not null references public.billing_receipts (id) on delete restrict,
  position           smallint not null check (position > 0),
  label              text not null check (char_length(label) between 1 and 300),
  period_start       date,
  period_end         date,
  quantity           integer not null check (quantity > 0),
  unit_price_ht_xof  bigint not null check (unit_price_ht_xof >= 0),
  amount_ht_xof      bigint not null check (amount_ht_xof = unit_price_ht_xof * quantity),
  tax_code           text check (char_length(tax_code) <= 20),
  tax_rate           numeric(5, 2) check (tax_rate between 0 and 100),
  tax_xof            bigint not null default 0 check (tax_xof >= 0),
  primary key (receipt_id, position)
);

alter table public.billing_receipts enable row level security;
alter table public.billing_receipt_lines enable row level security;

create policy "billing_receipts: billing readers read"
  on public.billing_receipts for select to authenticated
  using (private.can_read_org_billing(organization_id));

create policy "billing_receipt_lines: billing readers read"
  on public.billing_receipt_lines for select to authenticated
  using (exists (
    select 1 from public.billing_receipts r
    where r.id = receipt_id and private.can_read_org_billing(r.organization_id)
  ));

revoke all on public.billing_receipts, public.billing_receipt_lines from anon, authenticated;
grant select on public.billing_receipts, public.billing_receipt_lines to authenticated;

-- Issued receipts never change, for every role: only the external invoice
-- columns, and organization_id set to null by a deleted organization.
create or replace function private.guard_issued_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un reçu émis ne peut pas être supprimé' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['external_invoice_number', 'external_invoice_data', 'organization_id'])
     is distinct from
     (to_jsonb(old) - array['external_invoice_number', 'external_invoice_data', 'organization_id'])
     or (new.organization_id is distinct from old.organization_id and new.organization_id is not null) then
    raise exception 'Un reçu émis ne peut pas être modifié' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_issued_receipt before update or delete on public.billing_receipts
  for each row execute function private.guard_issued_receipt();

-- Lines are written once, with their receipt.
create or replace function private.guard_receipt_lines()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Les lignes d''un reçu émis ne peuvent pas changer' using errcode = '42501';
end;
$$;

create trigger guard_receipt_lines before update or delete on public.billing_receipt_lines
  for each row execute function private.guard_receipt_lines();

-- Gapless numbering: the counter row is locked by the upsert until the grant
-- commits, and rolls back with it.
create or replace function private.billing_next_receipt_number(p_prefix text, p_seller text, p_year integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  insert into private.billing_receipt_counters as c (seller, year, last_number)
  values (p_prefix || ':' || p_seller, p_year, 1)
  on conflict (seller, year) do update set last_number = c.last_number + 1
  returning c.last_number into v_next;
  return p_prefix || '-' || p_year::text || '-' || lpad(v_next::text, 6, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Functions described, not drafted here (service role only unless noted)
-- -----------------------------------------------------------------------------
-- public.billing_create_purchase(p_organization_id, p_workspace_id, p_offer, p_offer_label,
--   p_catalog_version, p_quantity, p_amount_ht_xof, p_tax_xof, p_environment, p_created_by)
--   returns (purchase_id, merchant_reference)
--
-- public.billing_set_transaction(p_purchase_id, p_fedapay_transaction_id) returns void
--
-- public.billing_apply_transaction(p_purchase_id, p_source, p_event_id, p_event_name,
--   p_status, p_amount_xof, p_merchant_reference, p_environment, p_mode, p_fees_xof,
--   p_approved_at) returns table (outcome text, entitlement_id uuid, receipt_number text)
--   1. lock the purchase row; record the payment event (duplicate event ids ignored)
--   2. approved or transferred: check amount, reference and environment (else 'review');
--      take billing_lock_org; dates per ADR 6.3; entitlement or pack; workspace to
--      'mission' for a pass; purchase 'paid'; receipt with billing_next_receipt_number
--      and its lines; billing_events 'granted'
--   3. refunded: purchase 'refunded', billing_events 'refund_seen'
--   4. expired: purchase 'expired' unless paid
--   5. declined, canceled, pending: recorded, purchase stays 'pending'
--
-- public.billing_pending_purchases(p_limit) for the reconciliation,
-- public.billing_due_notices(p_at) for the daily cron,
-- public.billing_admin_grant, public.billing_admin_revoke,
-- public.billing_admin_record_payment for the operator scripts (actor and reason
-- required, before and after state in private.billing_events),
-- public.create_workspace_in_organization (authenticated, KRB-175).

revoke all on all functions in schema private from public;
-- RLS policies call these two with the caller's rights.
grant execute on function private.can_read_org_billing(uuid), private.can_manage_org_billing(uuid)
  to authenticated, service_role;
revoke all on function public.workspace_billing_state(uuid) from public, anon;
grant execute on function public.workspace_billing_state(uuid) to authenticated;
