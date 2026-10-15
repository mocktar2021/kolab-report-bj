-- =============================================================================
-- KolabReport: billing page, usage meter and receipts (KRB-177)
--
-- ADR 001 (docs/adr/001-billing-and-fedapay.md), sections 3.5, 5.4 and 9.
--
-- * Billing details: the people who can buy for an organization (its owner
--   and the owners of its workspaces, private.can_manage_org_billing) update
--   the four buyer columns of organization_billing, and nothing else. They
--   are copied into the next receipts; a receipt already issued keeps its
--   own copy.
-- * billing_overview, for billing readers only as before, also returns the
--   AI drafts used by each line (counted like billing_reserve_draft), what
--   is left in each pack, the last purchases with their status (without the
--   expired and canceled checkouts) and the last receipts. A pass or a
--   purchase names its workspace for the organization owner, and for
--   members of that workspace; other billing readers get a null name, which
--   the page shows as "Espace Pass Mission". The list of workspaces a pass
--   can be bought for follows the same rule. Still no name or e-mail of a
--   person.
-- * workspace_billing_usage feeds the hints of the members page, the
--   "Nouveau rapport" dialog and the AI draft panel. Members who write
--   (owner, admin, expert) read the AI drafts left; member and report counts
--   go to billing readers only. Viewers and outsiders get no row.
-- * Receipts are read through the RLS policies of KRB-176. Nothing here
--   writes a receipt.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Billing details: managers update the buyer columns
-- -----------------------------------------------------------------------------
drop policy if exists "organization_billing: billing managers update" on public.organization_billing;
create policy "organization_billing: billing managers update"
  on public.organization_billing for update to authenticated
  using (private.can_manage_org_billing(organization_id))
  with check (private.can_manage_org_billing(organization_id));

-- Column by column: organization_id, created_at and updated_at stay out.
grant update (legal_name, address, tax_id, billing_email) on public.organization_billing to authenticated;

-- -----------------------------------------------------------------------------
-- AI drafts used, counted like private.billing_reserve_draft
-- -----------------------------------------------------------------------------
-- Per organization and UTC month for a monthly allowance, per entitlement
-- for the trial and a pass. A reservation counts for 10 minutes while it
-- stays reserved.
create or replace function private.billing_drafts_used(
  p_organization_id  uuid,
  p_entitlement_id   uuid,
  p_pool             text,
  p_monthly          boolean
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_alive  timestamptz := now() - interval '10 minutes';
  v_used   integer := 0;
begin
  -- Two queries rather than one with a case, so each uses its index.
  if p_monthly then
    select count(*) into v_used
    from public.billing_draft_usage d
    where d.organization_id = p_organization_id
      and d.usage_month = date_trunc('month', now() at time zone 'utc')::date
      and d.pool = p_pool
      and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > v_alive));
  elsif p_entitlement_id is not null then
    select count(*) into v_used
    from public.billing_draft_usage d
    where d.entitlement_id = p_entitlement_id
      and d.pool = p_pool
      and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > v_alive));
  end if;
  return v_used;
end;
$$;

-- The drafts of a line: used, allowance (null: no limit) and period
-- (month, or total for the trial and a pass).
create or replace function private.billing_line_drafts(
  p_organization_id   uuid,
  p_mission           boolean,
  p_entitlement_id    uuid,
  p_plan              text,
  p_drafts_per_month  integer,
  p_drafts_total      integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'used', private.billing_drafts_used(
      p_organization_id,
      p_entitlement_id,
      case when p_plan = 'trial' then 'trial' when p_mission then 'mission' else 'subscription' end,
      p_drafts_total is null),
    'allowance', coalesce(p_drafts_total, p_drafts_per_month),
    'period', case when p_drafts_total is not null then 'total' else 'month' end
  );
$$;

-- Drafts taken from one pack.
create or replace function private.billing_pack_used(p_pack_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.billing_draft_usage d
  where d.pack_id = p_pack_id
    and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > now() - interval '10 minutes'));
$$;

-- Whether the signed-in user may read the name of a workspace on the billing
-- page: they own its organization, or they are a member of it.
create or replace function private.billing_sees_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.organizations o on o.id = w.organization_id
    where w.id = p_workspace_id and o.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid())
  );
$$;

-- Whether a purchase shows in the payment history: checkouts that were never
-- paid and never will be (expired, or canceled by the buyer on FedaPay's
-- page) stay out. Pending, declined, in review, paid and refunded ones show.
create or replace function private.billing_purchase_listed(p_status text, p_fedapay_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status <> 'expired' and not (p_status = 'pending' and p_fedapay_status is not distinct from 'canceled');
$$;

-- -----------------------------------------------------------------------------
-- The billing page: the overview of KRB-175 with drafts, packs left,
-- purchases and receipts
-- -----------------------------------------------------------------------------
-- Same signature and same keys as before, plus new ones, so earlier callers
-- keep working. The last 50 purchases and 100 receipts, newest first, with
-- their totals.
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
  v_purchases     jsonb;
  v_receipts      jsonb;
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
    ),
    'drafts', private.billing_line_drafts(
      p_organization_id, false, a.entitlement_id, a.plan, a.drafts_per_month, a.drafts_total)
  )
  into v_subscription
  from private.billing_access(p_organization_id, null, now()) a
  cross join private.billing_usage(p_organization_id, null) u;

  select coalesce(jsonb_agg(jsonb_build_object(
    'workspace_id', w.id,
    'workspace_name', case when private.billing_sees_workspace(w.id) then w.name end,
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
    ),
    'drafts', private.billing_line_drafts(
      p_organization_id, true, a.entitlement_id, a.plan, a.drafts_per_month, a.drafts_total)
  ) order by w.created_at, w.id), '[]'::jsonb)
  into v_passes
  from public.workspaces w
  cross join lateral private.billing_access(p_organization_id, w.id, now()) a
  cross join lateral private.billing_usage(p_organization_id, w.id) u
  where w.organization_id = p_organization_id and w.billing_mode = 'mission';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'drafts', p.drafts,
    'used', private.billing_pack_used(p.id),
    'expires_at', p.expires_at
  ) order by p.expires_at, p.id), '[]'::jsonb)
  into v_packs
  from public.billing_ai_packs p
  where p.organization_id = p_organization_id
    and p.revoked_at is null
    and p.expires_at > now();

  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id), '[]'::jsonb)
  into v_purchases
  from (
    select p.id, p.created_at, jsonb_build_object(
      'id', p.id,
      'offer', p.offer,
      'offer_label', p.offer_label,
      'quantity', p.quantity,
      'workspace_id', p.workspace_id,
      'workspace_name', case when private.billing_sees_workspace(w.id) then w.name end,
      'amount_xof', p.amount_xof,
      'status', p.status,
      'fedapay_status', p.fedapay_status,
      'created_at', p.created_at,
      'paid_at', p.paid_at,
      'receipt_id', r.id,
      'receipt_number', r.number
    ) as item
    from public.billing_purchases p
    left join public.workspaces w on w.id = p.workspace_id
    left join public.billing_receipts r on r.purchase_id = p.id and r.kind = 'receipt'
    where p.organization_id = p_organization_id
      and private.billing_purchase_listed(p.status, p.fedapay_status)
    order by p.created_at desc, p.id
    limit 50
  ) x;

  select coalesce(jsonb_agg(x.item order by x.issued_at desc, x.number desc), '[]'::jsonb)
  into v_receipts
  from (
    select r.issued_at, r.number, jsonb_build_object(
      'id', r.id,
      'number', r.number,
      'kind', r.kind,
      'issued_at', r.issued_at,
      'total_xof', r.total_xof,
      'environment', r.environment,
      'label', (
        select l.label from public.billing_receipt_lines l
        where l.receipt_id = r.id
        order by l.position
        limit 1
      )
    ) as item
    from public.billing_receipts r
    where r.organization_id = p_organization_id
    order by r.issued_at desc, r.number desc
    limit 100
  ) x;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'enforced', private.billing_enforced(),
    'can_manage', private.can_manage_org_billing(p_organization_id),
    'subscription', v_subscription,
    'passes', v_passes,
    'packs', v_packs,
    'purchases', v_purchases,
    'purchases_total', (
      select count(*) from public.billing_purchases p
      where p.organization_id = p_organization_id
        and private.billing_purchase_listed(p.status, p.fedapay_status)),
    'receipts', v_receipts,
    'receipts_total', (
      select count(*) from public.billing_receipts r where r.organization_id = p_organization_id),
    -- The workspaces a pass can be bought for, by name: every one for the
    -- organization owner, the ones they belong to for the others.
    'workspaces', (
      select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) order by w.created_at, w.id), '[]'::jsonb)
      from public.workspaces w
      where w.organization_id = p_organization_id and private.billing_sees_workspace(w.id)
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Usage hints of one workspace
-- -----------------------------------------------------------------------------
-- The line that covers the workspace (its organization's subscription, or
-- its own passes), with what it uses. Owners, admins and experts of the
-- workspace read the AI drafts left: they are the ones who draft. Member
-- and report counts, which span the organization's other workspaces, go to
-- billing readers only, null for the others. Viewers, outsiders and unknown
-- workspaces get no row.
create or replace function public.workspace_billing_usage(p_workspace_id uuid)
returns table (
  billing_mode      text,
  enforced          boolean,
  state             text,          -- trialing | active | grace | read_only
  plan              text,
  members           integer,
  invitations       integer,
  max_members       integer,
  reports           integer,
  max_reports       integer,
  drafts_used       integer,
  drafts_allowance  integer,
  drafts_period     text,          -- month | total
  pack_drafts_left  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a              record;
  v_reader       boolean;
  v_members      integer;
  v_invitations  integer;
  v_reports      integer;
  v_drafts       jsonb;
  v_left         integer;
begin
  if p_workspace_id is null then
    return;
  end if;
  select * into a from private.workspace_access(p_workspace_id);
  if not found then
    return;
  end if;

  v_reader := private.can_read_org_billing(a.organization_id);
  if not v_reader and not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role <> 'viewer'
  ) then
    return;
  end if;

  if v_reader then
    select u.members, u.invitations, u.reports into v_members, v_invitations, v_reports
    from private.billing_usage(a.organization_id, case when a.billing_mode = 'mission' then p_workspace_id end) u;
  end if;

  v_drafts := private.billing_line_drafts(
    a.organization_id, a.billing_mode = 'mission', a.entitlement_id, a.plan, a.drafts_per_month, a.drafts_total);

  select coalesce(sum(greatest(p.drafts - private.billing_pack_used(p.id), 0)), 0)::integer into v_left
  from public.billing_ai_packs p
  where p.organization_id = a.organization_id
    and p.revoked_at is null
    and p.expires_at > now();

  return query select
    a.billing_mode,
    a.enforced,
    case when a.state = 'active' and a.plan = 'trial' then 'trialing' else a.state end,
    a.plan,
    v_members,
    v_invitations,
    a.max_members,
    v_reports,
    a.max_reports,
    (v_drafts ->> 'used')::integer,
    (v_drafts ->> 'allowance')::integer,
    v_drafts ->> 'period',
    v_left;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.billing_drafts_used(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function private.billing_line_drafts(uuid, boolean, uuid, text, integer, integer)
  from public, anon, authenticated;
revoke all on function private.billing_pack_used(uuid) from public, anon, authenticated;
revoke all on function private.billing_sees_workspace(uuid) from public, anon, authenticated;
revoke all on function private.billing_purchase_listed(text, text) from public, anon, authenticated;

revoke all on function public.billing_overview(uuid) from public, anon;
grant execute on function public.billing_overview(uuid) to authenticated;
revoke all on function public.workspace_billing_usage(uuid) from public, anon;
grant execute on function public.workspace_billing_usage(uuid) to authenticated;
