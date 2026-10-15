-- =============================================================================
-- KolabReport: billing entitlements, trial and settings (KRB-175, PR 175-2)
--
-- ADR 001 (docs/adr/001-billing-and-fedapay.md), sections 3 to 6 and 10.
--
-- * The organization (the firm) is the billing unit. Billing tables carry
--   organization_id instead of workspace_id, with RLS and their policies in
--   this file. Only the server writes them: signed-in users read through
--   policies at most, and never insert, update or delete.
-- * Every right is a row of billing_entitlements with its dates and a copy of
--   its limits. The state of a workspace (trialing, active, grace, read-only)
--   is computed from these rows and the time by private.workspace_access,
--   never stored. Two live subscription periods of an organization never
--   overlap, nor two passes of a workspace (exclusion constraints).
-- * A new organization gets a 14-day trial when its owner never had one,
--   checked by user id and by a hash of the e-mail address, so a deleted
--   account coming back with the same address gets none. The trial terms are
--   in private.billing_trial_terms(), mirrored in src/lib/billing/catalog.ts.
-- * Organizations that already exist get their buyer row and no entitlement:
--   the launch migration (KRB-179) gives them their launch period.
-- * Nothing changes while private.billing_settings.enforced is false: every
--   workspace reads as active with no limits. Limits come with PR 175-3.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- Settings: one row
-- -----------------------------------------------------------------------------
create table if not exists private.billing_settings (
  id           boolean primary key default true check (id),
  -- Off until the launch migration, so each billing story can merge alone.
  enforced     boolean not null default false,
  launched_at  timestamptz,
  -- The seller, copied into every receipt. Same facts as
  -- src/content/legal/publisher.ts (catalog.test.ts compares them).
  seller       jsonb not null default '{}' check (jsonb_typeof(seller) = 'object')
);

comment on table private.billing_settings is
  'Billing switch and seller details (ADR 001). One row. Read by the billing functions only.';

insert into private.billing_settings (id, enforced, seller)
values (
  true,
  false,
  '{"name": "Mocktar Technologies", "legal_form": "Établissement", "address": "C 1357 Houeyiho, 07BP91 Cotonou, République du Bénin", "rccm": "COTONOU N° RB/COT/26 A 119654", "ifu": "1200900488800", "email": "support@mocktar.com"}'::jsonb
)
on conflict (id) do nothing;

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

-- Trial terms. Mirrored in src/lib/billing/catalog.ts: catalog.test.ts reads
-- this function from this file and billing_trial_test.sql reads it from the
-- database, so keep one value per line, written "<value> as <name>".
create or replace function private.billing_trial_terms()
returns table (days integer, max_members integer, max_reports integer, drafts_total integer, custom_templates boolean)
language sql
immutable
set search_path = ''
as $$
  select
    14 as days,
    5 as max_members,
    1 as max_reports,
    20 as drafts_total,
    true as custom_templates;
$$;

-- -----------------------------------------------------------------------------
-- Workspaces: covered by the organization's subscription or by their own
-- Pass Mission entitlements (ADR 3.3). Only the server sets the mode.
-- -----------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists billing_mode text not null default 'subscription'
    constraint workspaces_billing_mode_check check (billing_mode in ('subscription', 'mission'));

comment on column public.workspaces.billing_mode is
  'subscription: covered by the organization''s plan. mission: covered by its own Pass Mission entitlements. Set by the server only.';

-- Target of the composite key of billing_entitlements, so a pass always names
-- a workspace of its own organization.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspaces_id_organization_id_key' and conrelid = 'public.workspaces'::regclass
  ) then
    alter table public.workspaces
      add constraint workspaces_id_organization_id_key unique (id, organization_id);
  end if;
end;
$$;

-- Users update only name, description and archived_at
-- (20261014130000_close_cross_tenant_writes.sql). The table-wide INSERT
-- privilege would also let them create a workspace with billing_mode set, so
-- they now insert the columns they used before, and nothing else.
revoke insert on public.workspaces from authenticated;
grant insert (id, organization_id, name, description, created_by) on public.workspaces to authenticated;

-- -----------------------------------------------------------------------------
-- Who reads and who pays (ADR 3.5)
-- -----------------------------------------------------------------------------
-- The organization owner, and every owner or admin of one of its workspaces.
create or replace function private.can_read_org_billing(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_organization_id and o.owner_id = (select auth.uid())
  ) or exists (
    select 1
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where w.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

-- The organization owner, and every owner of one of its workspaces.
create or replace function private.can_manage_org_billing(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_organization_id and o.owner_id = (select auth.uid())
  ) or exists (
    select 1
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where w.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

-- Every billing check and every grant takes this lock, then counts, so two
-- transactions of the same organization run one after the other. Always the
-- last advisory lock of a transaction: start_ai_generation takes its user and
-- workspace locks before it.
create or replace function private.billing_lock_org(p_organization_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('billing/org/' || p_organization_id::text, 0));
$$;

-- -----------------------------------------------------------------------------
-- Buyer details of each organization, copied into receipts (KRB-176). Filled
-- in from the billing page later (KRB-177).
-- -----------------------------------------------------------------------------
create table if not exists public.organization_billing (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  legal_name       text check (char_length(legal_name) between 2 and 200),
  address          text check (char_length(address) <= 500),
  -- IFU in Benin.
  tax_id           text check (char_length(tax_id) <= 40),
  billing_email    text check (billing_email = lower(btrim(billing_email))
                               and billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.organization_billing is
  'Buyer details of an organization, copied into its receipts (ADR 001). One row per organization.';

drop trigger if exists set_updated_at on public.organization_billing;
create trigger set_updated_at before update on public.organization_billing
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Entitlements: every right over time, with a copy of its limits. A null
-- limit means no limit.
-- -----------------------------------------------------------------------------
create table if not exists public.billing_entitlements (
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
  -- Distinct people with a non-viewer role, open invitations included.
  max_members       integer check (max_members > 0),
  -- Subscription: draft and in-review reports. Pass: every report of its workspace.
  max_reports       integer check (max_reports > 0),
  drafts_per_month  integer check (drafts_per_month >= 0),
  drafts_total      integer check (drafts_total >= 0),
  custom_templates  boolean not null default false,
  -- References billing_purchases, added with KRB-176 (on delete set null).
  purchase_id       uuid,
  -- What this period cost before tax, to convert unused days on an upgrade.
  -- 0 for the trial, a launch period and a free manual grant.
  amount_ht_xof     bigint not null default 0 check (amount_ht_xof >= 0),
  note              text check (char_length(note) <= 500),
  revoked_at        timestamptz,
  revoked_reason    text check (char_length(revoked_reason) between 1 and 200),
  created_at        timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((scope = 'mission') = (workspace_id is not null)),
  check ((scope = 'mission') = (plan = 'mission')),
  check (source <> 'trial' or plan = 'trial'),
  check (drafts_per_month is null or drafts_total is null),
  check ((revoked_at is null) = (revoked_reason is null)),
  constraint billing_entitlements_workspace_fkey foreign key (workspace_id, organization_id)
    references public.workspaces (id, organization_id) on delete cascade,
  -- At any instant: one live subscription entitlement per organization, and
  -- one live pass per workspace. Periods that touch ([start, end)) may follow
  -- each other.
  constraint billing_entitlements_one_subscription
    exclude using gist (organization_id with =, tstzrange(starts_at, ends_at) with &&)
    where (scope = 'subscription' and revoked_at is null),
  constraint billing_entitlements_one_pass
    exclude using gist (workspace_id with =, tstzrange(starts_at, ends_at) with &&)
    where (scope = 'mission' and revoked_at is null)
);

comment on table public.billing_entitlements is
  'Every billing right of an organization over time, with a copy of its limits (ADR 001). Written by the server only.';

create index if not exists billing_entitlements_org_idx
  on public.billing_entitlements (organization_id, ends_at desc);
create index if not exists billing_entitlements_ws_idx
  on public.billing_entitlements (workspace_id, ends_at desc) where workspace_id is not null;

-- -----------------------------------------------------------------------------
-- Pack IA credits (sold from KRB-176, used from PR 175-3)
-- -----------------------------------------------------------------------------
create table if not exists public.billing_ai_packs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- References billing_purchases, added with KRB-176 (on delete set null).
  purchase_id      uuid,
  drafts           integer not null check (drafts > 0),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now()
);

comment on table public.billing_ai_packs is
  'AI drafts bought on top of a plan, valid until expires_at (ADR 001). Written by the server only.';

create index if not exists billing_ai_packs_org_idx on public.billing_ai_packs (organization_id, expires_at);

-- -----------------------------------------------------------------------------
-- Private tables: no policy, no grant. Only the definer functions use them.
-- -----------------------------------------------------------------------------
create table if not exists private.billing_trial_claims (
  user_id          uuid primary key,
  -- sha256 of the account's e-mail in lower case. Kept after the account is
  -- deleted, without the address itself. Every account has an e-mail today
  -- (profiles.email); null only lets an account without one still get its
  -- trial instead of failing the organization insert.
  email_hash       text unique check (email_hash ~ '^[0-9a-f]{64}$'),
  -- The organization that got the trial. No foreign key: the claim outlives it.
  organization_id  uuid,
  claimed_at       timestamptz not null default now()
);

comment on table private.billing_trial_claims is
  'One trial per customer: who already had one, by user id and by e-mail hash (ADR 001, section 11).';

create table if not exists private.billing_events (
  id               bigint generated always as identity primary key,
  -- No foreign key: the audit log outlives the organization.
  organization_id  uuid,
  kind             text not null check (kind in (
                     'trial_started', 'granted', 'converted', 'manual_grant', 'manual_revoke',
                     'refund_seen', 'review', 'launch_period', 'entered_grace', 'entered_read_only')),
  -- Operator name for manual changes, null for the system.
  actor            text check (char_length(actor) <= 200),
  reason           text check (char_length(reason) <= 500),
  details          jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  created_at       timestamptz not null default now()
);

comment on table private.billing_events is
  'Billing audit log: trials, grants, manual changes, refunds (ADR 001, section 5.2).';

create index if not exists billing_events_org_idx on private.billing_events (organization_id, created_at desc);

alter table private.billing_trial_claims enable row level security;
alter table private.billing_events enable row level security;
revoke all on private.billing_trial_claims, private.billing_events
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Row-Level Security on the public tables: billing readers read, nobody
-- signed in writes. The service role keeps the Supabase default access and
-- writes through the billing functions (KRB-176).
-- -----------------------------------------------------------------------------
alter table public.organization_billing enable row level security;
alter table public.billing_entitlements enable row level security;
alter table public.billing_ai_packs enable row level security;

drop policy if exists "organization_billing: billing readers read" on public.organization_billing;
create policy "organization_billing: billing readers read"
  on public.organization_billing for select to authenticated
  using (private.can_read_org_billing(organization_id));

drop policy if exists "billing_entitlements: billing readers read" on public.billing_entitlements;
create policy "billing_entitlements: billing readers read"
  on public.billing_entitlements for select to authenticated
  using (private.can_read_org_billing(organization_id));

drop policy if exists "billing_ai_packs: billing readers read" on public.billing_ai_packs;
create policy "billing_ai_packs: billing readers read"
  on public.billing_ai_packs for select to authenticated
  using (private.can_read_org_billing(organization_id));

revoke all on public.organization_billing, public.billing_entitlements, public.billing_ai_packs
  from anon, authenticated;
grant select on public.organization_billing, public.billing_entitlements, public.billing_ai_packs
  to authenticated;

-- -----------------------------------------------------------------------------
-- Access: the state of a billing line, computed from rows and time (ADR 6.1)
-- -----------------------------------------------------------------------------
-- A line is the organization's subscription (p_workspace_id null) or the
-- passes of one mission workspace. The entitlement that applies is the one
-- covering p_at (the exclusion constraints allow one at most), else the last
-- one that ended. Periods stacked after p_at are ignored. In grace, the
-- limits of the entitlement that ended still apply.
--
-- While billing is not enforced, every line is active with no limit.
create or replace function private.billing_access(p_organization_id uuid, p_workspace_id uuid, p_at timestamptz)
returns table (
  enforced          boolean,
  state             text,          -- active | grace | read_only
  entitlement_id    uuid,          -- null when the line never had an entitlement
  plan              text,
  source            text,
  starts_at         timestamptz,
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
  e public.billing_entitlements%rowtype;
begin
  if not private.billing_enforced() then
    return query select false, 'active'::text, null::uuid, null::text, null::text, null::timestamptz,
      null::timestamptz, null::timestamptz, null::integer, null::integer, null::integer, null::integer, true;
    return;
  end if;

  -- Two queries rather than one with a case, so each uses its index.
  if p_workspace_id is null then
    select b.* into e
    from public.billing_entitlements b
    where b.organization_id = p_organization_id
      and b.scope = 'subscription'
      and b.revoked_at is null
      and b.starts_at <= p_at
    order by (b.ends_at > p_at) desc, b.ends_at desc
    limit 1;
  else
    select b.* into e
    from public.billing_entitlements b
    where b.workspace_id = p_workspace_id
      and b.scope = 'mission'
      and b.revoked_at is null
      and b.starts_at <= p_at
    order by (b.ends_at > p_at) desc, b.ends_at desc
    limit 1;
  end if;

  if not found then
    return query select true, 'read_only'::text, null::uuid, null::text, null::text, null::timestamptz,
      null::timestamptz, null::timestamptz, null::integer, null::integer, null::integer, null::integer, false;
    return;
  end if;

  return query select
    true,
    case
      when e.ends_at > p_at then 'active'
      when p_at < e.ends_at + make_interval(days => e.grace_days) then 'grace'
      else 'read_only'
    end,
    e.id, e.plan, e.source, e.starts_at, e.ends_at, e.ends_at + make_interval(days => e.grace_days),
    e.max_members, e.max_reports, e.drafts_per_month, e.drafts_total, e.custom_templates;
end;
$$;

-- The line that covers a workspace: the subscription, or its own passes when
-- its mode is mission. No row for an unknown workspace.
create or replace function private.workspace_access(p_workspace_id uuid, p_at timestamptz default now())
returns table (
  organization_id   uuid,
  billing_mode      text,
  enforced          boolean,
  state             text,
  entitlement_id    uuid,
  plan              text,
  source            text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  grace_ends_at     timestamptz,
  max_members       integer,
  max_reports       integer,
  drafts_per_month  integer,
  drafts_total      integer,
  custom_templates  boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.organization_id, w.billing_mode, a.*
  from public.workspaces w
  cross join lateral private.billing_access(
    w.organization_id,
    case when w.billing_mode = 'mission' then w.id end,
    p_at
  ) a
  where w.id = p_workspace_id;
$$;

-- What a line uses (ADR 3.4), for the usage meter. Members are distinct
-- e-mail addresses with a non-viewer role in the covered workspaces; open
-- invitations to other addresses are counted apart. Reports are the draft
-- and in-review ones for the subscription, every report for a pass. AI
-- drafts come with the ledger of PR 175-3.
create or replace function private.billing_usage(p_organization_id uuid, p_workspace_id uuid)
returns table (members integer, invitations integer, reports integer, workspaces integer)
language sql
stable
security definer
set search_path = ''
as $$
  with covered as (
    select w.id
    from public.workspaces w
    where w.organization_id = p_organization_id
      and case
            when p_workspace_id is null then w.billing_mode = 'subscription'
            else w.id = p_workspace_id
          end
  ), people as (
    select distinct coalesce(lower(u.email), u.id::text) as email
    from public.workspace_members m
    join auth.users u on u.id = m.user_id
    where m.workspace_id in (select c.id from covered c) and m.role <> 'viewer'
  ), invited as (
    select distinct i.email
    from public.workspace_invitations i
    where i.workspace_id in (select c.id from covered c)
      and i.role <> 'viewer'
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
      and not exists (select 1 from people p where p.email = i.email)
  )
  select
    (select count(*)::integer from people),
    (select count(*)::integer from invited),
    (select count(*)::integer
     from public.reports r
     where r.workspace_id in (select c.id from covered c)
       and (p_workspace_id is not null or r.status in ('draft', 'in_review'))),
    (select count(*)::integer from covered);
$$;

-- -----------------------------------------------------------------------------
-- New organization: buyer row, and a trial when the owner never had one
-- -----------------------------------------------------------------------------
-- Runs inside create_workspace_with_owner, which retries the organization
-- insert on a unique violation (taken slug). Nothing here may raise one: the
-- claim uses on conflict do nothing, which also covers two organizations
-- created at the same time by the same person.
create or replace function private.billing_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash         text;
  v_claimed      uuid;
  v_terms        record;
  v_entitlement  uuid;
begin
  insert into public.organization_billing (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;

  select encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex') into v_hash
  from auth.users u
  where u.id = new.owner_id and nullif(btrim(u.email), '') is not null;

  -- One trial per customer: no claim when this account, or an account with
  -- the same e-mail, already has one. The organization then stays read-only
  -- until a purchase.
  insert into private.billing_trial_claims (user_id, email_hash, organization_id)
  values (new.owner_id, v_hash, new.id)
  on conflict do nothing
  returning user_id into v_claimed;

  if v_claimed is null then
    return null;
  end if;

  select * into v_terms from private.billing_trial_terms();

  insert into public.billing_entitlements (
    organization_id, scope, plan, source, starts_at, ends_at,
    max_members, max_reports, drafts_total, custom_templates
  ) values (
    new.id, 'subscription', 'trial', 'trial', now(), now() + make_interval(days => v_terms.days),
    v_terms.max_members, v_terms.max_reports, v_terms.drafts_total, v_terms.custom_templates
  )
  returning id into v_entitlement;

  insert into private.billing_events (organization_id, kind, details)
  values (
    new.id, 'trial_started',
    jsonb_build_object('entitlement_id', v_entitlement, 'ends_at', now() + make_interval(days => v_terms.days))
  );
  return null;
end;
$$;

drop trigger if exists billing_new_organization on public.organizations;
create trigger billing_new_organization
  after insert on public.organizations
  for each row execute function private.billing_new_organization();

-- -----------------------------------------------------------------------------
-- What the app reads
-- -----------------------------------------------------------------------------
-- The state of one workspace, for every member (banner, members page, draft
-- panel) and for the organization's billing readers. Dates and limits, no
-- amount. No row for anyone else.
create or replace function public.workspace_billing_state(p_workspace_id uuid)
returns table (
  organization_id     uuid,
  billing_mode        text,
  state               text,          -- trialing | active | grace | read_only
  plan                text,
  source              text,
  ends_at             timestamptz,
  grace_ends_at       timestamptz,
  max_members         integer,
  max_reports         integer,
  drafts_per_month    integer,
  drafts_total        integer,
  custom_templates    boolean,
  can_read_billing    boolean,
  can_manage_billing  boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.organization_id,
    a.billing_mode,
    case when a.state = 'active' and a.plan = 'trial' then 'trialing' else a.state end,
    a.plan, a.source, a.ends_at, a.grace_ends_at,
    a.max_members, a.max_reports, a.drafts_per_month, a.drafts_total, a.custom_templates,
    private.can_read_org_billing(a.organization_id),
    private.can_manage_org_billing(a.organization_id)
  from private.workspace_access(p_workspace_id) a
  where private.is_workspace_member(p_workspace_id) or private.can_read_org_billing(a.organization_id);
$$;

-- The billing page and the usage meter, for billing readers only (null for
-- anyone else): the subscription line, the pass of each mission workspace,
-- and the running packs. Counts only, no name or e-mail: an admin of one
-- workspace does not see who works in the others.
create or replace function public.billing_overview(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subscription  jsonb;
  v_passes        jsonb;
  v_packs         jsonb;
begin
  if p_organization_id is null or not private.can_read_org_billing(p_organization_id) then
    return null;
  end if;

  select jsonb_build_object(
    'state', case when a.state = 'active' and a.plan = 'trial' then 'trialing' else a.state end,
    'plan', a.plan,
    'source', a.source,
    'starts_at', a.starts_at,
    'ends_at', a.ends_at,
    'grace_ends_at', a.grace_ends_at,
    'limits', jsonb_build_object(
      'max_members', a.max_members,
      'max_reports', a.max_reports,
      'drafts_per_month', a.drafts_per_month,
      'drafts_total', a.drafts_total,
      'custom_templates', a.custom_templates
    ),
    'usage', jsonb_build_object(
      'members', u.members,
      'invitations', u.invitations,
      'active_reports', u.reports,
      'workspaces', u.workspaces
    )
  )
  into v_subscription
  from private.billing_access(p_organization_id, null, now()) a
  cross join private.billing_usage(p_organization_id, null) u;

  select coalesce(jsonb_agg(jsonb_build_object(
    'workspace_id', w.id,
    'state', a.state,
    'plan', a.plan,
    'source', a.source,
    'starts_at', a.starts_at,
    'ends_at', a.ends_at,
    'grace_ends_at', a.grace_ends_at,
    'limits', jsonb_build_object(
      'max_members', a.max_members,
      'max_reports', a.max_reports,
      'drafts_per_month', a.drafts_per_month,
      'drafts_total', a.drafts_total,
      'custom_templates', a.custom_templates
    ),
    'usage', jsonb_build_object(
      'members', u.members,
      'invitations', u.invitations,
      'reports', u.reports
    )
  ) order by w.created_at, w.id), '[]'::jsonb)
  into v_passes
  from public.workspaces w
  cross join lateral private.billing_access(p_organization_id, w.id, now()) a
  cross join lateral private.billing_usage(p_organization_id, w.id) u
  where w.organization_id = p_organization_id and w.billing_mode = 'mission';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'drafts', p.drafts,
    'expires_at', p.expires_at
  ) order by p.expires_at, p.id), '[]'::jsonb)
  into v_packs
  from public.billing_ai_packs p
  where p.organization_id = p_organization_id
    and p.revoked_at is null
    and p.expires_at > now();

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'enforced', private.billing_enforced(),
    'can_manage', private.can_manage_org_billing(p_organization_id),
    'subscription', v_subscription,
    'passes', v_passes,
    'packs', v_packs
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Backfill: a buyer row for every organization that already exists. No
-- entitlement and no trial claim: the launch migration (KRB-179) gives them
-- a launch period and records their owners' claims.
-- -----------------------------------------------------------------------------
insert into public.organization_billing (organization_id)
select o.id from public.organizations o
on conflict (organization_id) do nothing;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.billing_enforced() from public, anon, authenticated;
revoke all on function private.billing_trial_terms() from public, anon, authenticated;
revoke all on function private.billing_lock_org(uuid) from public, anon, authenticated;
revoke all on function private.billing_access(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.workspace_access(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.billing_usage(uuid, uuid) from public, anon, authenticated;
revoke all on function private.billing_new_organization() from public, anon, authenticated;
-- The RLS policies call these two with the caller's rights.
revoke all on function private.can_read_org_billing(uuid) from public, anon;
revoke all on function private.can_manage_org_billing(uuid) from public, anon;
grant execute on function private.can_read_org_billing(uuid) to authenticated;
grant execute on function private.can_manage_org_billing(uuid) to authenticated;

revoke all on function public.workspace_billing_state(uuid) from public, anon;
grant execute on function public.workspace_billing_state(uuid) to authenticated;
revoke all on function public.billing_overview(uuid) from public, anon;
grant execute on function public.billing_overview(uuid) to authenticated;
