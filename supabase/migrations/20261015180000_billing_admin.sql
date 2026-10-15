-- KRB-179, PR 179-2: the operator path for Institution deals and manual
-- changes (ADR 001, 6.4 and the plan's 179-2).
--
-- Three functions, for the service role only. The operator scripts in
-- scripts/billing/ call them; no page and no user ever does.
--
-- * billing_admin_record_payment: a bank transfer received for an
--   Institution quote. It creates a paid purchase (method bank_transfer),
--   then grants it with private.billing_grant, the same function as an
--   online payment: same period rules (the trial ends, a renewal stacks,
--   an upgrade converts the unused days) and a numbered receipt that shows
--   the transfer reference.
-- * billing_admin_grant: a period without a payment, for a goodwill
--   extension, a fix after an incident or the owner's own organizations.
-- * billing_admin_revoke: ends an entitlement early, for a correction. It
--   refunds nothing: refunds go through FedaPay or the bank.
--
-- Each one requires an actor (who ran it) and a reason, and writes the line's
-- periods before and after the change in private.billing_events. That is the
-- answer to "who set it and when" of the acceptance criteria.

-- The bank's reference of a transfer, printed on the receipt. A reference is
-- recorded once per organization, so running the script twice by mistake
-- grants nothing twice.
alter table public.billing_purchases
  add column if not exists transfer_reference text
    check (char_length(transfer_reference) between 1 and 100);

create unique index if not exists billing_purchases_transfer_key
  on public.billing_purchases (organization_id, transfer_reference)
  where transfer_reference is not null;

alter table public.billing_purchases
  drop constraint if exists billing_purchases_transfer_check;
alter table public.billing_purchases
  add constraint billing_purchases_transfer_check
    check ((transfer_reference is null) = (method <> 'bank_transfer'));

-- The audit log learns the operator's recorded payments.
alter table private.billing_events drop constraint if exists billing_events_kind_check;
alter table private.billing_events
  add constraint billing_events_kind_check check (kind in (
    'trial_started', 'granted', 'converted', 'manual_grant', 'manual_revoke', 'manual_payment',
    'refund_seen', 'review', 'launch_period', 'entered_grace', 'entered_read_only', 'owner_transferred'));

-- Limits as the operator gives them: the five keys of an entitlement, with
-- the same bounds as private.billing_terms_valid. Null means no limit.
create or replace function private.billing_limits_valid(p_limits jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key      text;
  v_pattern  text;
begin
  if p_limits is null or jsonb_typeof(p_limits) <> 'object'
     or jsonb_typeof(p_limits -> 'custom_templates') is distinct from 'boolean' then
    return false;
  end if;
  foreach v_key in array array['max_members', 'max_reports', 'drafts_per_month', 'drafts_total'] loop
    v_pattern := case when v_key in ('max_members', 'max_reports') then '^[1-9][0-9]{0,8}$' else '^[0-9]{1,9}$' end;
    if not (p_limits ? v_key) then
      return false;
    end if;
    if jsonb_typeof(p_limits -> v_key) <> 'null' and not (p_limits ->> v_key) ~ v_pattern then
      return false;
    end if;
  end loop;
  return jsonb_typeof(p_limits -> 'drafts_per_month') = 'null' or jsonb_typeof(p_limits -> 'drafts_total') = 'null';
end;
$$;

-- Who ran the script and why. Both are kept in the audit log.
create or replace function private.billing_admin_check(p_actor text, p_reason text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_actor is null or char_length(btrim(p_actor)) not between 2 and 200 then
    raise exception 'An actor (2 to 200 characters) is required' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'A reason (3 to 500 characters) is required' using errcode = '22023';
  end if;
end;
$$;

-- The subscription periods of an organization that run now or later, as
-- the audit log keeps them before and after a manual change.
create or replace function private.billing_line_snapshot(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'plan', e.plan,
    'source', e.source,
    'starts_at', e.starts_at,
    'ends_at', e.ends_at,
    'purchase_id', e.purchase_id
  ) order by e.starts_at), '[]'::jsonb)
  from public.billing_entitlements e
  where e.organization_id = p_organization_id and e.scope = 'subscription'
    and e.revoked_at is null and e.ends_at > now();
$$;

-- The receipt of a bank transfer shows its reference. Same function as in
-- 20261015130000_billing_purchases.sql, plus transfer_reference in payment.
create or replace function private.billing_issue_receipt(p_purchase_id uuid)
returns table (receipt_id uuid, number text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v         public.billing_purchases%rowtype;
  v_found   record;
  v_seller  jsonb;
  v_buyer   jsonb;
  v_year    integer;
  v_number  text;
  v_id      uuid;
  v_start   timestamptz;
  v_end     timestamptz;
begin
  select * into v from public.billing_purchases p where p.id = p_purchase_id for update;
  if not found or v.status <> 'paid' or v.paid_at is null then
    raise exception 'Only a paid purchase gets a receipt' using errcode = '22023';
  end if;

  select r.id, r.number into v_found
  from public.billing_receipts r
  where r.purchase_id = v.id and r.kind = 'receipt';
  if found then
    return query select v_found.id, v_found.number;
    return;
  end if;

  select s.seller into v_seller from private.billing_settings s;
  select jsonb_build_object(
    'organization_id', o.id,
    'name', o.name,
    'legal_name', coalesce(b.legal_name, o.name),
    'address', b.address,
    'tax_id', b.tax_id,
    'billing_email', b.billing_email
  ) into v_buyer
  from public.organizations o
  left join public.organization_billing b on b.organization_id = o.id
  where o.id = v.organization_id;
  if v_buyer is null then
    raise exception 'The purchase has no organization left' using errcode = '22023';
  end if;

  -- One sequence per seller and calendar year, in Benin time.
  v_year := extract(year from v.paid_at at time zone 'Africa/Porto-Novo')::integer;
  v_number := private.billing_next_receipt_number(
    'KR', coalesce(nullif(v_seller ->> 'ifu', ''), 'default'), v_year);

  select e.starts_at, e.ends_at into v_start, v_end
  from public.billing_entitlements e where e.purchase_id = v.id;
  if v_start is null then
    select k.created_at, k.expires_at into v_start, v_end
    from public.billing_ai_packs k where k.purchase_id = v.id;
  end if;

  insert into public.billing_receipts (
    number, kind, purchase_id, organization_id, environment, seller, buyer, payment,
    currency, total_ht_xof, total_tax_xof, total_xof
  ) values (
    v_number, 'receipt', v.id, v.organization_id, v.environment, coalesce(v_seller, '{}'), v_buyer,
    jsonb_build_object(
      'method', v.method,
      'mode', v.fedapay_mode,
      'fedapay_transaction_id', v.fedapay_transaction_id,
      'fedapay_reference', v.fedapay_reference,
      'merchant_reference', v.merchant_reference,
      'transfer_reference', v.transfer_reference,
      'paid_at', v.paid_at
    ),
    v.currency, v.amount_ht_xof, v.tax_xof, v.amount_xof
  )
  returning id into v_id;

  insert into public.billing_receipt_lines (
    receipt_id, position, label, period_start, period_end, quantity,
    unit_price_ht_xof, amount_ht_xof, tax_code, tax_rate, tax_xof
  ) values (
    v_id, 1, v.offer_label,
    (v_start at time zone 'Africa/Porto-Novo')::date,
    (v_end at time zone 'Africa/Porto-Novo')::date,
    v.quantity, v.amount_ht_xof / v.quantity, v.amount_ht_xof, null, null, v.tax_xof
  );

  return query select v_id, v_number;
end;
$$;

-- An Institution quote paid by bank transfer. The period follows the rules
-- of an online payment (private.billing_grant) and lasts p_months. p_test
-- marks the purchase and its receipt as a test, for staging.
create or replace function public.billing_admin_record_payment(
  p_organization_id     uuid,
  p_amount_ht_xof       bigint,
  p_months              integer,
  p_limits              jsonb,
  p_transfer_reference  text,
  p_paid_at             timestamptz,
  p_actor               text,
  p_reason              text,
  p_label               text default null,
  p_catalog_version     integer default 1,
  p_test                boolean default false
)
returns table (
  purchase_id     uuid,
  entitlement_id  uuid,
  starts_at       timestamptz,
  ends_at         timestamptz,
  receipt_number  text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id      uuid := gen_random_uuid();
  v_ref     text := btrim(p_transfer_reference);
  v_label   text := coalesce(nullif(btrim(p_label), ''), 'Institution, ' || p_months || ' mois');
  v_before  jsonb;
  v_grant   record;
begin
  perform private.billing_admin_check(p_actor, p_reason);
  if p_amount_ht_xof is null or p_amount_ht_xof <= 0 or p_amount_ht_xof > 100000000 then
    raise exception 'The amount HT must be between 1 and 100 000 000 FCFA' using errcode = '22023';
  end if;
  if p_months is null or p_months not between 1 and 36 then
    raise exception 'The period must last 1 to 36 months' using errcode = '22023';
  end if;
  if not private.billing_limits_valid(p_limits) then
    raise exception 'Invalid limits' using errcode = '22023';
  end if;
  if v_ref is null or char_length(v_ref) not between 1 and 100 then
    raise exception 'The transfer reference is required (1 to 100 characters)' using errcode = '22023';
  end if;
  if p_paid_at is null or p_paid_at > now() + interval '1 day' or p_paid_at < now() - interval '1 year' then
    raise exception 'The transfer date must be within the last year' using errcode = '22023';
  end if;
  if char_length(v_label) not between 2 and 200 then
    raise exception 'The receipt label must be 2 to 200 characters' using errcode = '22023';
  end if;
  if p_catalog_version is null or p_catalog_version < 1 then
    raise exception 'Invalid catalog version' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'Unknown organization' using errcode = '22023';
  end if;

  perform private.billing_lock_org(p_organization_id);

  if exists (
    select 1 from public.billing_purchases p
    where p.organization_id = p_organization_id and p.transfer_reference = v_ref
  ) then
    raise exception 'Transfer % is already recorded for this organization', v_ref using errcode = '23505';
  end if;

  v_before := private.billing_line_snapshot(p_organization_id);

  insert into public.billing_purchases (
    id, organization_id, offer, offer_label, catalog_version, quantity, terms,
    amount_ht_xof, tax_xof, amount_xof, method, environment, merchant_reference, transfer_reference
  ) values (
    v_id, p_organization_id, 'institution', v_label, p_catalog_version, 1,
    jsonb_build_object(
      'kind', 'subscription',
      'plan', 'institution',
      'months', p_months,
      -- For the conversion of unused days on a later upgrade (ADR 001, 6.3).
      'monthly_price_ht_xof', ceil(p_amount_ht_xof::numeric / p_months)::bigint,
      'limits', jsonb_build_object(
        'max_members', p_limits -> 'max_members',
        'max_reports', p_limits -> 'max_reports',
        'drafts_per_month', p_limits -> 'drafts_per_month',
        'drafts_total', p_limits -> 'drafts_total',
        'custom_templates', p_limits -> 'custom_templates'
      )
    ),
    p_amount_ht_xof, 0, p_amount_ht_xof, 'bank_transfer',
    case when p_test then 'sandbox' else 'manual' end,
    'KR-' || v_id::text, v_ref
  );

  select * into v_grant from private.billing_grant(v_id, p_paid_at);

  insert into private.billing_events (organization_id, kind, actor, reason, details)
  values (p_organization_id, 'manual_payment', btrim(p_actor), btrim(p_reason), jsonb_build_object(
    'purchase_id', v_id,
    'transfer_reference', v_ref,
    'amount_ht_xof', p_amount_ht_xof,
    'paid_at', p_paid_at,
    'test', p_test,
    'receipt_number', v_grant.receipt_number,
    'before', v_before,
    'after', private.billing_line_snapshot(p_organization_id)
  ));

  return query select v_id, v_grant.entitlement_id, v_grant.starts_at, v_grant.ends_at, v_grant.receipt_number;
end;
$$;

-- A subscription period without a payment. It starts at p_starts_at, or
-- after the paid and manual periods already planned, or now. A running
-- trial ends where it starts, like at a first payment.
create or replace function public.billing_admin_grant(
  p_organization_id  uuid,
  p_plan             text,
  p_length           interval,
  p_limits           jsonb,
  p_actor            text,
  p_reason           text,
  p_starts_at        timestamptz default null
)
returns table (entitlement_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now     timestamptz := now();
  v_start   timestamptz;
  v_end     timestamptz;
  v_last    timestamptz;
  v_before  jsonb;
  v_id      uuid;
begin
  perform private.billing_admin_check(p_actor, p_reason);
  if p_plan is null or p_plan not in ('independant', 'cabinet', 'institution') then
    raise exception 'The plan must be independant, cabinet or institution' using errcode = '22023';
  end if;
  if p_length is null or p_length < interval '1 day' or p_length > interval '3 years' then
    raise exception 'The length must be between 1 day and 3 years' using errcode = '22023';
  end if;
  if not private.billing_limits_valid(p_limits) then
    raise exception 'Invalid limits' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'Unknown organization' using errcode = '22023';
  end if;
  if p_starts_at is not null and p_starts_at < v_now - interval '1 day' then
    raise exception 'A manual period cannot start in the past' using errcode = '22023';
  end if;

  perform private.billing_lock_org(p_organization_id);
  v_before := private.billing_line_snapshot(p_organization_id);

  select max(b.ends_at) into v_last
  from public.billing_entitlements b
  where b.organization_id = p_organization_id and b.scope = 'subscription'
    and b.plan <> 'trial' and b.revoked_at is null and b.ends_at > v_now;
  v_start := coalesce(p_starts_at, greatest(v_now, v_last));
  v_end := v_start + p_length;

  -- The trial gives way, as it does at a first payment.
  update public.billing_entitlements b set ends_at = v_start
  where b.organization_id = p_organization_id and b.scope = 'subscription' and b.plan = 'trial'
    and b.revoked_at is null and b.starts_at < v_start and b.ends_at > v_start;
  update public.billing_entitlements b
  set revoked_at = v_now, revoked_reason = 'Essai remplacé par une période accordée'
  where b.organization_id = p_organization_id and b.scope = 'subscription' and b.plan = 'trial'
    and b.revoked_at is null and b.starts_at >= v_start;

  begin
    insert into public.billing_entitlements (
      organization_id, scope, plan, source, starts_at, ends_at,
      max_members, max_reports, drafts_per_month, drafts_total, custom_templates, amount_ht_xof, note
    ) values (
      p_organization_id, 'subscription', p_plan, 'manual', v_start, v_end,
      (p_limits ->> 'max_members')::integer, (p_limits ->> 'max_reports')::integer,
      (p_limits ->> 'drafts_per_month')::integer, (p_limits ->> 'drafts_total')::integer,
      (p_limits ->> 'custom_templates')::boolean, 0, left(btrim(p_reason), 500)
    )
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Another period covers % to %: revoke it first, or leave the start empty', v_start, v_end
      using errcode = '23P01';
  end;

  insert into private.billing_events (organization_id, kind, actor, reason, details)
  values (p_organization_id, 'manual_grant', btrim(p_actor), btrim(p_reason), jsonb_build_object(
    'entitlement_id', v_id,
    'plan', p_plan,
    'starts_at', v_start,
    'ends_at', v_end,
    'limits', p_limits,
    'before', v_before,
    'after', private.billing_line_snapshot(p_organization_id)
  ));

  return query select v_id, v_start, v_end;
end;
$$;

-- Ends an entitlement now, whatever its source. Nothing is refunded here.
create or replace function public.billing_admin_revoke(
  p_entitlement_id  uuid,
  p_actor           text,
  p_reason          text
)
returns table (entitlement_id uuid, organization_id uuid, plan text, revoked_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v         public.billing_entitlements%rowtype;
  v_before  jsonb;
  v_now     timestamptz := now();
begin
  perform private.billing_admin_check(p_actor, p_reason);
  select * into v from public.billing_entitlements e where e.id = p_entitlement_id;
  if not found then
    raise exception 'Unknown entitlement' using errcode = '22023';
  end if;

  perform private.billing_lock_org(v.organization_id);
  select * into v from public.billing_entitlements e where e.id = p_entitlement_id for update;
  if v.revoked_at is not null then
    raise exception 'This entitlement was already revoked on %', v.revoked_at using errcode = '22023';
  end if;
  v_before := private.billing_line_snapshot(v.organization_id);

  update public.billing_entitlements e
  set revoked_at = v_now, revoked_reason = left(btrim(p_reason), 200)
  where e.id = v.id;

  insert into private.billing_events (organization_id, kind, actor, reason, details)
  values (v.organization_id, 'manual_revoke', btrim(p_actor), btrim(p_reason), jsonb_build_object(
    'entitlement_id', v.id,
    'scope', v.scope,
    'workspace_id', v.workspace_id,
    'plan', v.plan,
    'source', v.source,
    'purchase_id', v.purchase_id,
    'starts_at', v.starts_at,
    'ends_at', v.ends_at,
    'before', v_before,
    'after', private.billing_line_snapshot(v.organization_id)
  ));

  return query select v.id, v.organization_id, v.plan, v_now;
end;
$$;

revoke all on function private.billing_limits_valid(jsonb) from public, anon, authenticated;
revoke all on function private.billing_admin_check(text, text) from public, anon, authenticated;
revoke all on function private.billing_line_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.billing_admin_record_payment(
  uuid, bigint, integer, jsonb, text, timestamptz, text, text, text, integer, boolean
) from public, anon, authenticated;
grant execute on function public.billing_admin_record_payment(
  uuid, bigint, integer, jsonb, text, timestamptz, text, text, text, integer, boolean
) to service_role;
revoke all on function public.billing_admin_grant(uuid, text, interval, jsonb, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.billing_admin_grant(uuid, text, interval, jsonb, text, text, timestamptz)
  to service_role;
revoke all on function public.billing_admin_revoke(uuid, text, text) from public, anon, authenticated;
grant execute on function public.billing_admin_revoke(uuid, text, text) to service_role;
