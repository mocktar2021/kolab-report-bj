-- =============================================================================
-- KolabReport: purchases, FedaPay payments and receipts (KRB-176, PR 176-2)
--
-- ADR 001 (docs/adr/001-billing-and-fedapay.md), sections 5, 6.3, 8 and 9.
--
-- * A purchase is one checkout attempt. The server reads its amount, its
--   label and its terms (plan, length, limits) from src/lib/billing/catalog.ts
--   and freezes them in the row (billing_create_purchase). Nothing a browser
--   sends sets a price, and a later catalogue change never touches a
--   purchase already made.
-- * Nothing is granted from a webhook body. The server re-reads the
--   transaction from FedaPay and passes what FedaPay says to
--   billing_apply_transaction, which compares the amount, the currency, the
--   merchant reference and the environment with the purchase, and grants
--   once: the purchase row is locked, granted_at is set in the same
--   transaction, and the entitlement, the pack and the receipt are unique
--   per purchase. The webhook, the return page and the reconciliation call
--   it in any order, any number of times.
-- * Period rules of ADR 6.3: a renewal stacks after the last period, a
--   payment in grace starts at the old end, after read-only it starts now,
--   the trial ends at payment and its remaining time is added, an upgrade
--   converts the unused paid time into extra days, a downgrade starts at the
--   end. A pass follows the same rules per workspace and turns its workspace
--   to mission. A pack runs from the payment.
-- * Receipts get a number per seller and year, KR-2026-000001, from a
--   counter row locked until the grant commits. A grant that rolls back
--   gives its number back: no gap, no duplicate. A receipt and its lines
--   never change once issued, except the external (e-MECeF) invoice number
--   and data, empty for now. Tax columns stay at 0 until the accountant
--   answers (ADR 9).
-- * Only the service role calls these functions. Billing readers read
--   purchases and receipts through RLS. Payment events, receipt counters and
--   e-mail notices are private.
-- * Nothing here reads private.billing_settings.enforced: payments work on
--   staging before the launch.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Purchases
-- -----------------------------------------------------------------------------
create table if not exists public.billing_purchases (
  id                      uuid primary key default gen_random_uuid(),
  -- Payments are accounting records: they outlive the organization.
  organization_id         uuid references public.organizations (id) on delete set null,
  -- Set for a Pass Mission only.
  workspace_id            uuid references public.workspaces (id) on delete set null,
  offer                   text not null check (offer in (
                            'independant_1m', 'independant_3m', 'independant_12m',
                            'cabinet_1m', 'cabinet_3m', 'cabinet_12m',
                            'mission_pass', 'ai_pack_100', 'institution', 'manual')),
  -- French label frozen at creation, printed on the receipt.
  offer_label             text not null check (char_length(offer_label) between 2 and 200),
  catalog_version         smallint not null check (catalog_version > 0),
  quantity                smallint not null default 1 check (quantity between 1 and 10),
  -- What the grant gives, frozen from the catalogue: plan, length, limits
  -- (private.billing_terms_valid).
  terms                   jsonb not null check (jsonb_typeof(terms) = 'object'),
  amount_ht_xof           bigint not null check (amount_ht_xof >= 0),
  tax_xof                 bigint not null default 0 check (tax_xof >= 0),
  amount_xof              bigint not null,
  currency                text not null default 'XOF' check (currency = 'XOF'),
  method                  text not null default 'fedapay' check (method in ('fedapay', 'bank_transfer', 'manual')),
  -- A sandbox payment never mixes with a live one.
  environment             text not null check (environment in ('sandbox', 'live', 'mock', 'manual')),
  status                  text not null default 'pending'
                            check (status in ('pending', 'paid', 'expired', 'refunded', 'review')),
  -- Why FedaPay's answer did not match, for the operator.
  review_reason           text check (char_length(review_reason) <= 60),
  -- Sent to FedaPay, which refuses a second transaction with the same one.
  merchant_reference      text not null unique,
  fedapay_transaction_id  bigint check (fedapay_transaction_id > 0),
  fedapay_reference       text check (char_length(fedapay_reference) <= 100),
  fedapay_status          text check (char_length(fedapay_status) <= 60),
  -- Payment method, for example mtn_open or momo_test.
  fedapay_mode            text check (char_length(fedapay_mode) <= 60),
  fedapay_fees_xof        bigint check (fedapay_fees_xof >= 0),
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  paid_at                 timestamptz,
  granted_at              timestamptz,
  last_checked_at         timestamptz,
  confirmation_sent_at    timestamptz,
  check (merchant_reference = 'KR-' || id::text),
  check (amount_xof = amount_ht_xof + tax_xof),
  check (method <> 'fedapay' or (amount_xof > 0 and environment <> 'manual')),
  check (status not in ('paid', 'refunded') or paid_at is not null),
  check (granted_at is null or status in ('paid', 'refunded')),
  check ((status = 'review') = (review_reason is not null)),
  constraint billing_purchases_transaction_key unique (environment, fedapay_transaction_id)
);

comment on table public.billing_purchases is
  'One row per checkout attempt or manual payment, with its frozen amount and terms (ADR 001, 5.2). Written by the billing functions only.';

create index if not exists billing_purchases_org_idx
  on public.billing_purchases (organization_id, created_at desc);
create index if not exists billing_purchases_pending_idx
  on public.billing_purchases (created_at) where status = 'pending';

drop trigger if exists set_updated_at on public.billing_purchases;
create trigger set_updated_at before update on public.billing_purchases
  for each row execute function private.set_updated_at();

-- The entitlements and packs of 175-2 already name their purchase.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_entitlements_purchase_fkey' and conrelid = 'public.billing_entitlements'::regclass
  ) then
    alter table public.billing_entitlements
      add constraint billing_entitlements_purchase_fkey
      foreign key (purchase_id) references public.billing_purchases (id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_ai_packs_purchase_fkey' and conrelid = 'public.billing_ai_packs'::regclass
  ) then
    alter table public.billing_ai_packs
      add constraint billing_ai_packs_purchase_fkey
      foreign key (purchase_id) references public.billing_purchases (id) on delete set null;
  end if;
end;
$$;

-- A purchase grants once: one entitlement or one pack.
create unique index if not exists billing_entitlements_purchase_key
  on public.billing_entitlements (purchase_id) where purchase_id is not null;
create unique index if not exists billing_ai_packs_purchase_key
  on public.billing_ai_packs (purchase_id) where purchase_id is not null;

-- -----------------------------------------------------------------------------
-- Payment history: no raw payload, FedaPay events carry the customer's
-- e-mail and phone number.
-- -----------------------------------------------------------------------------
create table if not exists private.billing_payment_events (
  id                bigint generated always as identity primary key,
  purchase_id       uuid not null references public.billing_purchases (id) on delete cascade,
  source            text not null check (source in ('checkout', 'webhook', 'return', 'reconcile', 'manual')),
  fedapay_event_id  text check (char_length(fedapay_event_id) between 1 and 100),
  event_name        text check (char_length(event_name) <= 100),
  fedapay_status    text check (char_length(fedapay_status) <= 60),
  amount_xof        bigint,
  received_at       timestamptz not null default now()
);

comment on table private.billing_payment_events is
  'What FedaPay said about each purchase, and through which path (ADR 001, 5.2). A webhook delivered twice is recorded once.';

-- Per purchase: event ids are FedaPay's, and the mock starts again from 1.
create unique index if not exists billing_payment_events_once_idx
  on private.billing_payment_events (purchase_id, source, fedapay_event_id) where fedapay_event_id is not null;
create index if not exists billing_payment_events_purchase_idx
  on private.billing_payment_events (purchase_id, received_at);

-- E-mails sent about a purchase, claimed before sending so each goes once:
-- the buyer's confirmation and the operator's alerts.
create table if not exists private.billing_purchase_notices (
  purchase_id  uuid not null references public.billing_purchases (id) on delete cascade,
  kind         text not null check (kind in (
                 'confirmation', 'review', 'refund', 'stuck', 'paid_after_expiry', 'possible_duplicate')),
  created_at   timestamptz not null default now(),
  primary key (purchase_id, kind)
);

comment on table private.billing_purchase_notices is
  'E-mails sent about a purchase, one per kind (ADR 001, 8.5 and 12).';

-- -----------------------------------------------------------------------------
-- Receipts (ADR 9)
-- -----------------------------------------------------------------------------
create table if not exists private.billing_receipt_counters (
  -- Prefix and seller, for example KR:1200900488800.
  seller       text not null check (char_length(seller) between 1 and 100),
  year         integer not null check (year between 2026 and 2200),
  last_number  integer not null check (last_number between 1 and 999999),
  primary key (seller, year)
);

comment on table private.billing_receipt_counters is
  'Last receipt number per seller and year. Locked by a grant until it commits (ADR 001, section 9).';

create table if not exists public.billing_receipts (
  id                       uuid primary key default gen_random_uuid(),
  number                   text not null unique check (number ~ '^(KR|AV)-[0-9]{4}-[0-9]{6}$'),
  -- Credit notes get their own AV- sequence if the accountant asks for them.
  kind                     text not null default 'receipt' check (kind in ('receipt', 'credit_note')),
  purchase_id              uuid not null references public.billing_purchases (id) on delete restrict,
  organization_id          uuid references public.organizations (id) on delete set null,
  environment              text not null check (environment in ('sandbox', 'live', 'mock', 'manual')),
  issued_at                timestamptz not null default now(),
  -- Frozen at issue: name, address, IFU, RCCM, e-mail of the seller; legal
  -- name, address, IFU and billing e-mail of the buyer; method, FedaPay
  -- references and date of the payment.
  seller                   jsonb not null check (jsonb_typeof(seller) = 'object'),
  buyer                    jsonb not null check (jsonb_typeof(buyer) = 'object'),
  payment                  jsonb not null check (jsonb_typeof(payment) = 'object'),
  currency                 text not null default 'XOF' check (currency = 'XOF'),
  total_ht_xof             bigint not null check (total_ht_xof >= 0),
  total_tax_xof            bigint not null default 0 check (total_tax_xof >= 0),
  total_xof                bigint not null,
  -- The normalized invoice (e-MECeF), later. The only columns that may change.
  external_invoice_number  text check (char_length(external_invoice_number) between 1 and 100),
  external_invoice_data    jsonb check (external_invoice_data is null or jsonb_typeof(external_invoice_data) = 'object'),
  check (total_xof = total_ht_xof + total_tax_xof),
  unique (purchase_id, kind)
);

comment on table public.billing_receipts is
  'Payment receipts with their seller, buyer and payment frozen at issue (ADR 001, section 9). Never updated except the external invoice columns, never deleted.';

create index if not exists billing_receipts_org_idx
  on public.billing_receipts (organization_id, issued_at desc);

create table if not exists public.billing_receipt_lines (
  receipt_id         uuid not null references public.billing_receipts (id) on delete restrict,
  position           smallint not null check (position > 0),
  label              text not null check (char_length(label) between 1 and 300),
  period_start       date,
  period_end         date,
  quantity           integer not null check (quantity > 0),
  unit_price_ht_xof  bigint not null check (unit_price_ht_xof >= 0),
  amount_ht_xof      bigint not null,
  -- Null and 0 until the tax regime is known (ADR 9).
  tax_code           text check (char_length(tax_code) <= 20),
  tax_rate           numeric(5, 2) check (tax_rate between 0 and 100),
  tax_xof            bigint not null default 0 check (tax_xof >= 0),
  primary key (receipt_id, position),
  check (amount_ht_xof = unit_price_ht_xof * quantity)
);

comment on table public.billing_receipt_lines is
  'Lines of a receipt, written once with it (ADR 001, section 9).';

-- An issued receipt never changes, for every role, the service role
-- included: only the external invoice columns, and organization_id set to
-- null when its organization is deleted.
create or replace function private.guard_issued_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
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

drop trigger if exists guard_issued_receipt on public.billing_receipts;
create trigger guard_issued_receipt before update or delete on public.billing_receipts
  for each row execute function private.guard_issued_receipt();
drop trigger if exists guard_issued_receipt_truncate on public.billing_receipts;
create trigger guard_issued_receipt_truncate before truncate on public.billing_receipts
  for each statement execute function private.guard_issued_receipt();

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

drop trigger if exists guard_receipt_lines on public.billing_receipt_lines;
create trigger guard_receipt_lines before update or delete on public.billing_receipt_lines
  for each row execute function private.guard_receipt_lines();
drop trigger if exists guard_receipt_lines_truncate on public.billing_receipt_lines;
create trigger guard_receipt_lines_truncate before truncate on public.billing_receipt_lines
  for each statement execute function private.guard_receipt_lines();

-- -----------------------------------------------------------------------------
-- Row-Level Security: billing readers read, nobody signed in writes. Rows
-- whose organization was deleted are visible to the service role only.
-- -----------------------------------------------------------------------------
alter table public.billing_purchases enable row level security;
alter table public.billing_receipts enable row level security;
alter table public.billing_receipt_lines enable row level security;

drop policy if exists "billing_purchases: billing readers read" on public.billing_purchases;
create policy "billing_purchases: billing readers read"
  on public.billing_purchases for select to authenticated
  using (private.can_read_org_billing(organization_id));

drop policy if exists "billing_receipts: billing readers read" on public.billing_receipts;
create policy "billing_receipts: billing readers read"
  on public.billing_receipts for select to authenticated
  using (private.can_read_org_billing(organization_id));

drop policy if exists "billing_receipt_lines: billing readers read" on public.billing_receipt_lines;
create policy "billing_receipt_lines: billing readers read"
  on public.billing_receipt_lines for select to authenticated
  using (exists (
    select 1 from public.billing_receipts r
    where r.id = receipt_id and private.can_read_org_billing(r.organization_id)
  ));

revoke all on public.billing_purchases, public.billing_receipts, public.billing_receipt_lines
  from anon, authenticated;
grant select on public.billing_purchases, public.billing_receipts, public.billing_receipt_lines
  to authenticated;

alter table private.billing_payment_events enable row level security;
alter table private.billing_purchase_notices enable row level security;
alter table private.billing_receipt_counters enable row level security;
revoke all on private.billing_payment_events, private.billing_purchase_notices, private.billing_receipt_counters
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- private.can_manage_org_billing for a given user: the server creates the
-- purchase with the service role, in the buyer's name.
create or replace function private.billing_user_can_manage(p_organization_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and (
    exists (
      select 1 from public.organizations o
      where o.id = p_organization_id and o.owner_id = p_user_id
    ) or exists (
      select 1
      from public.workspaces w
      join public.workspace_members m on m.workspace_id = w.id
      where w.organization_id = p_organization_id and m.user_id = p_user_id and m.role = 'owner'
    )
  );
$$;

-- Order of the subscription plans, for upgrades. A launch period counts as
-- Cabinet, the plan it carries.
create or replace function private.billing_plan_rank(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan
    when 'trial' then 0
    when 'independant' then 1
    when 'cabinet' then 2
    when 'institution' then 3
  end;
$$;

-- The terms the catalogue froze into a purchase, checked before they are
-- stored. Shapes, written by src/lib/billing/catalog.ts (offerTerms):
--   subscription: {kind, plan, months, monthly_price_ht_xof, limits}
--   mission:      {kind, plan, days, limits}
--   ai_pack:      {kind, drafts, valid_months, max_quantity}
-- limits: {max_members, max_reports, drafts_per_month, drafts_total,
-- custom_templates}, a null limit meaning no limit.
create or replace function private.billing_terms_valid(p_offer text, p_terms jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_limits   jsonb := p_terms -> 'limits';
  v_key      text;
  v_pattern  text;
begin
  if p_terms is null or jsonb_typeof(p_terms) <> 'object' then
    return false;
  end if;

  if p_offer = 'ai_pack_100' then
    return p_terms ->> 'kind' = 'ai_pack'
      and coalesce(p_terms ->> 'drafts', '') ~ '^[1-9][0-9]{0,5}$'
      and coalesce(p_terms ->> 'valid_months', '') ~ '^[1-9][0-9]?$'
      and coalesce(p_terms ->> 'max_quantity', '') ~ '^([1-9]|10)$';
  end if;

  if p_offer = 'mission_pass' then
    if not (p_terms ->> 'kind' = 'mission'
            and p_terms ->> 'plan' = 'mission'
            and coalesce(p_terms ->> 'days', '') ~ '^[1-9][0-9]{0,2}$') then
      return false;
    end if;
  elsif p_offer ~ '^(independant|cabinet)_(1|3|12)m$' then
    if not (p_terms ->> 'kind' = 'subscription'
            and p_terms ->> 'plan' = split_part(p_offer, '_', 1)
            and p_terms ->> 'months' = rtrim(split_part(p_offer, '_', 2), 'm')
            and coalesce(p_terms ->> 'monthly_price_ht_xof', '') ~ '^[1-9][0-9]{0,8}$') then
      return false;
    end if;
  else
    -- Institution and manual payments are recorded by the operator (KRB-179).
    return false;
  end if;

  if v_limits is null or jsonb_typeof(v_limits) <> 'object'
     or jsonb_typeof(v_limits -> 'custom_templates') is distinct from 'boolean' then
    return false;
  end if;
  foreach v_key in array array['max_members', 'max_reports', 'drafts_per_month', 'drafts_total'] loop
    -- Member and report limits are at least 1, draft allowances at least 0.
    v_pattern := case when v_key in ('max_members', 'max_reports') then '^[1-9][0-9]{0,8}$' else '^[0-9]{1,9}$' end;
    if not (v_limits ? v_key) then
      return false;
    end if;
    if jsonb_typeof(v_limits -> v_key) <> 'null' and not (v_limits ->> v_key) ~ v_pattern then
      return false;
    end if;
  end loop;
  -- A monthly allowance or one for the whole period, not both.
  return jsonb_typeof(v_limits -> 'drafts_per_month') = 'null' or jsonb_typeof(v_limits -> 'drafts_total') = 'null';
end;
$$;

-- Gapless numbering: the upsert locks the counter row until the grant
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
  if p_prefix not in ('KR', 'AV') then
    raise exception 'Unknown receipt prefix' using errcode = '22023';
  end if;
  insert into private.billing_receipt_counters as c (seller, year, last_number)
  values (p_prefix || ':' || p_seller, p_year, 1)
  on conflict (seller, year) do update set last_number = c.last_number + 1
  returning c.last_number into v_next;
  return p_prefix || '-' || p_year::text || '-' || lpad(v_next::text, 6, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Receipt of a paid purchase: numbered and written in the grant transaction
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Grant: the period rules of ADR 6.3, the entitlement or the pack, the
-- purchase paid, the receipt and the audit event. The caller holds the
-- purchase row and the organization lock.
-- -----------------------------------------------------------------------------
create or replace function private.billing_grant(p_purchase_id uuid, p_paid_at timestamptz)
returns table (
  entitlement_id  uuid,
  pack_id         uuid,
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
  v             public.billing_purchases%rowtype;
  v_now         timestamptz := now();
  v_terms       jsonb;
  v_limits      jsonb;
  v_rule        text;
  v_start       timestamptz;
  v_end         timestamptz;
  v_extra       interval := interval '0';
  v_cur_id      uuid;
  v_cur_plan    text;
  v_cur_start   timestamptz;
  v_cur_end     timestamptz;
  v_last_end    timestamptz;
  v_prev_end    timestamptz;
  v_prev_grace  smallint;
  v_ref_plan    text;
  v_credit      numeric := 0;
  v_extra_days  integer := 0;
  v_ended       uuid[] := '{}';
  v_revoked     uuid[] := '{}';
  v_entitlement uuid;
  v_pack        uuid;
  v_receipt     record;
begin
  select * into v from public.billing_purchases p where p.id = p_purchase_id;
  v_terms := v.terms;
  v_limits := v_terms -> 'limits';

  if v_terms ->> 'kind' = 'ai_pack' then
    -- No period: valid from the payment.
    v_rule := 'pack';
    v_start := v_now;
    v_end := v_now + make_interval(months => (v_terms ->> 'valid_months')::integer);
    insert into public.billing_ai_packs (organization_id, purchase_id, drafts, expires_at)
    values (v.organization_id, v.id, (v_terms ->> 'drafts')::integer * v.quantity, v_end)
    returning id into v_pack;

  elsif v_terms ->> 'kind' = 'mission' then
    -- Per workspace: stacks on a running pass, starts at the old end in
    -- grace, now otherwise.
    select max(b.ends_at) into v_last_end
    from public.billing_entitlements b
    where b.workspace_id = v.workspace_id and b.scope = 'mission'
      and b.revoked_at is null and b.ends_at > v_now;
    if v_last_end is not null then
      v_rule := 'stack';
      v_start := v_last_end;
    else
      select b.ends_at, b.grace_days into v_prev_end, v_prev_grace
      from public.billing_entitlements b
      where b.workspace_id = v.workspace_id and b.scope = 'mission'
        and b.revoked_at is null and b.ends_at <= v_now
      order by b.ends_at desc
      limit 1;
      if v_prev_end is not null and v_now < v_prev_end + make_interval(days => v_prev_grace) then
        v_rule := 'grace';
        v_start := v_prev_end;
      else
        v_rule := 'now';
        v_start := v_now;
      end if;
    end if;
    v_end := v_start + make_interval(days => (v_terms ->> 'days')::integer);

    insert into public.billing_entitlements (
      organization_id, workspace_id, scope, plan, source, starts_at, ends_at,
      max_members, max_reports, drafts_per_month, drafts_total, custom_templates,
      purchase_id, amount_ht_xof
    ) values (
      v.organization_id, v.workspace_id, 'mission', 'mission', 'purchase', v_start, v_end,
      (v_limits ->> 'max_members')::integer, (v_limits ->> 'max_reports')::integer,
      (v_limits ->> 'drafts_per_month')::integer, (v_limits ->> 'drafts_total')::integer,
      (v_limits ->> 'custom_templates')::boolean,
      v.id, v.amount_ht_xof
    )
    returning id into v_entitlement;

    -- The workspace now follows its passes (ADR 3.3).
    update public.workspaces w set billing_mode = 'mission'
    where w.id = v.workspace_id and w.billing_mode <> 'mission';

  else
    -- The organization's subscription line.
    select b.id, b.plan, b.starts_at, b.ends_at into v_cur_id, v_cur_plan, v_cur_start, v_cur_end
    from public.billing_entitlements b
    where b.organization_id = v.organization_id and b.scope = 'subscription'
      and b.revoked_at is null and b.starts_at <= v_now and b.ends_at > v_now
    limit 1;

    -- The trial ends at payment, its remaining time is added.
    if v_cur_plan = 'trial' then
      v_extra := v_cur_end - v_now;
      if v_cur_start < v_now then
        update public.billing_entitlements b set ends_at = v_now where b.id = v_cur_id;
        v_ended := v_ended || v_cur_id;
      else
        update public.billing_entitlements b
        set revoked_at = v_now, revoked_reason = 'Essai remplacé par une offre payante'
        where b.id = v_cur_id;
        v_revoked := v_revoked || v_cur_id;
      end if;
    end if;

    select max(b.ends_at) into v_last_end
    from public.billing_entitlements b
    where b.organization_id = v.organization_id and b.scope = 'subscription'
      and b.revoked_at is null and b.ends_at > v_now;

    if v_last_end is null then
      -- Nothing running: in grace the new period starts at the old end (the
      -- grace days are not free), after it now.
      select b.ends_at, b.grace_days into v_prev_end, v_prev_grace
      from public.billing_entitlements b
      where b.organization_id = v.organization_id and b.scope = 'subscription'
        and b.revoked_at is null and b.ends_at <= v_now
      order by b.ends_at desc
      limit 1;
      if v_prev_end is not null and v_now < v_prev_end + make_interval(days => v_prev_grace) then
        v_rule := case when v_cur_plan = 'trial' then 'trial' else 'grace' end;
        v_start := v_prev_end;
      else
        v_rule := case when v_cur_plan = 'trial' then 'trial' else 'now' end;
        v_start := v_now;
      end if;
    else
      -- The plan that applies now, else the next one.
      select b.plan into v_ref_plan
      from public.billing_entitlements b
      where b.organization_id = v.organization_id and b.scope = 'subscription'
        and b.revoked_at is null and b.ends_at > v_now
      order by b.starts_at
      limit 1;

      if private.billing_plan_rank(v_terms ->> 'plan') > coalesce(private.billing_plan_rank(v_ref_plan), 0) then
        -- Upgrade: the unused part of the paid periods becomes extra days of
        -- the new plan; the current period ends now and the stacked ones go.
        select coalesce(sum(b.amount_ht_xof * case
                 when b.starts_at >= v_now then 1
                 else extract(epoch from b.ends_at - v_now) / extract(epoch from b.ends_at - b.starts_at)
               end), 0)
        into v_credit
        from public.billing_entitlements b
        where b.organization_id = v.organization_id and b.scope = 'subscription'
          and b.revoked_at is null and b.ends_at > v_now;

        with ended as (
          update public.billing_entitlements b set ends_at = v_now
          where b.organization_id = v.organization_id and b.scope = 'subscription'
            and b.revoked_at is null and b.ends_at > v_now and b.starts_at < v_now
          returning b.id
        )
        select v_ended || coalesce(array_agg(ended.id), '{}') into v_ended from ended;

        with revoked as (
          update public.billing_entitlements b
          set revoked_at = v_now, revoked_reason = 'Converti en jours de la nouvelle offre'
          where b.organization_id = v.organization_id and b.scope = 'subscription'
            and b.revoked_at is null and b.starts_at >= v_now
          returning b.id
        )
        select v_revoked || coalesce(array_agg(revoked.id), '{}') into v_revoked from revoked;

        v_extra_days := floor(v_credit * 30 / (v_terms ->> 'monthly_price_ht_xof')::numeric)::integer;
        v_extra := v_extra + make_interval(days => v_extra_days);
        v_rule := 'upgrade';
        v_start := v_now;

        insert into private.billing_events (organization_id, kind, details)
        values (v.organization_id, 'converted', jsonb_build_object(
          'purchase_id', v.id,
          'credit_xof', round(v_credit),
          'extra_days', v_extra_days,
          'ended', to_jsonb(v_ended),
          'revoked', to_jsonb(v_revoked)
        ));
      else
        -- Renewal or downgrade: after the last stacked period.
        v_rule := 'stack';
        v_start := v_last_end;
      end if;
    end if;

    v_end := v_start + make_interval(months => (v_terms ->> 'months')::integer) + v_extra;

    insert into public.billing_entitlements (
      organization_id, scope, plan, source, starts_at, ends_at,
      max_members, max_reports, drafts_per_month, drafts_total, custom_templates,
      purchase_id, amount_ht_xof
    ) values (
      v.organization_id, 'subscription', v_terms ->> 'plan', 'purchase', v_start, v_end,
      (v_limits ->> 'max_members')::integer, (v_limits ->> 'max_reports')::integer,
      (v_limits ->> 'drafts_per_month')::integer, (v_limits ->> 'drafts_total')::integer,
      (v_limits ->> 'custom_templates')::boolean,
      v.id, v.amount_ht_xof
    )
    returning id into v_entitlement;
  end if;

  update public.billing_purchases p
  set status = 'paid', paid_at = coalesce(p_paid_at, v_now), granted_at = v_now
  where p.id = v.id;

  select * into v_receipt from private.billing_issue_receipt(v.id);

  insert into private.billing_events (organization_id, kind, details)
  values (v.organization_id, 'granted', jsonb_build_object(
    'purchase_id', v.id,
    'offer', v.offer,
    'entitlement_id', v_entitlement,
    'pack_id', v_pack,
    'rule', v_rule,
    'starts_at', v_start,
    'ends_at', v_end,
    'trial_ended', to_jsonb(case when v_cur_plan = 'trial' then v_cur_id end),
    'receipt_number', v_receipt.number
  ));

  return query select v_entitlement, v_pack, v_start, v_end, v_receipt.number;
end;
$$;

-- -----------------------------------------------------------------------------
-- What the server calls (service role only)
-- -----------------------------------------------------------------------------
-- A pending purchase for a checkout, with the amount and terms the server
-- read from the catalogue. Checks, under the organization lock: the buyer
-- may buy for the organization (ADR 3.5), no purchase of the organization
-- waits for the operator, a pass goes to a workspace of the organization
-- holding one report at most, and a pack goes on top of a paid plan or a
-- pass that is running or in grace, 10 packs at most at once (ADR 8.2, Q6).
-- When p_reuse is true and the same order is pending for less than 24 hours,
-- it is returned instead, so two tabs never pay twice. A refusal comes back
-- as a code, with no purchase.
create or replace function public.billing_create_purchase(
  p_organization_id  uuid,
  p_offer            text,
  p_offer_label      text,
  p_catalog_version  integer,
  p_quantity         integer,
  p_terms            jsonb,
  p_amount_ht_xof    bigint,
  p_tax_xof          bigint,
  p_environment      text,
  p_created_by       uuid,
  -- The workspace a Pass Mission covers, null for the other offers.
  p_workspace_id     uuid default null,
  p_reuse            boolean default true
)
returns table (
  purchase_id             uuid,
  merchant_reference      text,
  fedapay_transaction_id  bigint,
  reused                  boolean,
  refusal                 text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id        uuid;
  v_found     record;
  v_max       integer;
  v_running   bigint;
begin
  if p_environment is null or p_environment not in ('sandbox', 'live', 'mock') then
    raise exception 'Unknown FedaPay environment' using errcode = '22023';
  end if;
  if not private.billing_terms_valid(p_offer, p_terms) then
    raise exception 'The terms do not match the offer' using errcode = '22023';
  end if;
  v_max := case when p_offer = 'ai_pack_100' then (p_terms ->> 'max_quantity')::integer else 1 end;
  if p_quantity is null or p_quantity < 1 or p_quantity > v_max then
    raise exception 'Invalid quantity' using errcode = '22023';
  end if;
  if p_amount_ht_xof is null or p_amount_ht_xof <= 0 or p_tax_xof is null or p_tax_xof < 0
     or p_catalog_version is null or p_offer_label is null then
    raise exception 'Invalid amount or label' using errcode = '22023';
  end if;
  if (p_offer = 'mission_pass') <> (p_workspace_id is not null) then
    raise exception 'A workspace goes with a Pass Mission, and only with it' using errcode = '22023';
  end if;

  if p_organization_id is null or not private.billing_user_can_manage(p_organization_id, p_created_by) then
    return query select null::uuid, null::text, null::bigint, false, 'forbidden'::text;
    return;
  end if;

  perform private.billing_lock_org(p_organization_id);

  if exists (
    select 1 from public.billing_purchases p
    where p.organization_id = p_organization_id and p.status = 'review'
  ) then
    return query select null::uuid, null::text, null::bigint, false, 'review'::text;
    return;
  end if;

  if p_offer = 'mission_pass' and not exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.organization_id = p_organization_id
      and (select count(*) from public.reports r where r.workspace_id = w.id) <= 1
  ) then
    return query select null::uuid, null::text, null::bigint, false, 'missionWorkspace'::text;
    return;
  end if;

  if p_offer = 'ai_pack_100' then
    -- Not during the trial: a paid or manual period, or a pass, running or in grace.
    if not exists (
      select 1 from public.billing_entitlements b
      where b.organization_id = p_organization_id
        and b.revoked_at is null and b.plan <> 'trial'
        and b.starts_at <= now()
        and now() < b.ends_at + make_interval(days => b.grace_days)
    ) then
      return query select null::uuid, null::text, null::bigint, false, 'packNeedsPlan'::text;
      return;
    end if;
    select coalesce(sum(k.drafts), 0) into v_running
    from public.billing_ai_packs k
    where k.organization_id = p_organization_id and k.revoked_at is null and k.expires_at > now();
    if v_running + p_quantity * (p_terms ->> 'drafts')::bigint > v_max * (p_terms ->> 'drafts')::bigint then
      return query select null::uuid, null::text, null::bigint, false, 'packLimit'::text;
      return;
    end if;
  end if;

  if p_reuse then
    select p.id, p.merchant_reference, p.fedapay_transaction_id into v_found
    from public.billing_purchases p
    where p.organization_id = p_organization_id
      and p.offer = p_offer
      and p.workspace_id is not distinct from p_workspace_id
      and p.quantity = p_quantity
      and p.amount_xof = p_amount_ht_xof + p_tax_xof
      and p.environment = p_environment
      and p.status = 'pending'
      and p.created_at > now() - interval '24 hours'
    order by p.created_at desc
    limit 1;
    if found then
      return query select v_found.id, v_found.merchant_reference, v_found.fedapay_transaction_id, true, null::text;
      return;
    end if;
  end if;

  v_id := gen_random_uuid();
  insert into public.billing_purchases (
    id, organization_id, workspace_id, offer, offer_label, catalog_version, quantity, terms,
    amount_ht_xof, tax_xof, amount_xof, method, environment, merchant_reference, created_by
  ) values (
    v_id, p_organization_id, p_workspace_id, p_offer, p_offer_label, p_catalog_version, p_quantity, p_terms,
    p_amount_ht_xof, p_tax_xof, p_amount_ht_xof + p_tax_xof, 'fedapay', p_environment, 'KR-' || v_id::text,
    p_created_by
  );
  return query select v_id, 'KR-' || v_id::text, null::bigint, false, null::text;
end;
$$;

-- Links a purchase to the FedaPay transaction created for it. Setting the
-- same id again does nothing; another id is refused.
create or replace function public.billing_set_transaction(
  p_purchase_id     uuid,
  p_transaction_id  bigint,
  p_status          text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.billing_purchases%rowtype;
begin
  if p_transaction_id is null or p_transaction_id <= 0 then
    raise exception 'Invalid FedaPay transaction id' using errcode = '22023';
  end if;
  select * into v from public.billing_purchases p where p.id = p_purchase_id for update;
  if not found then
    raise exception 'Unknown purchase' using errcode = 'P0002';
  end if;
  if v.fedapay_transaction_id is not null then
    if v.fedapay_transaction_id = p_transaction_id then
      return;
    end if;
    raise exception 'The purchase already has another FedaPay transaction' using errcode = '23505';
  end if;

  update public.billing_purchases p
  set fedapay_transaction_id = p_transaction_id,
      fedapay_status = coalesce(left(lower(btrim(p_status)), 60), p.fedapay_status)
  where p.id = v.id;
  insert into private.billing_payment_events (purchase_id, source, event_name, fedapay_status, amount_xof)
  values (v.id, 'checkout', 'transaction.created', left(lower(btrim(p_status)), 60), v.amount_xof);
end;
$$;

-- Applies what FedaPay says about a purchase's transaction, read from the
-- FedaPay API by the server, never from a webhook body or a URL (ADR 8.5).
-- One transaction, safe to run twice:
--   approved, transferred: grant once (already_granted after that), unless
--     the amount, the currency, the merchant reference or the environment
--     differs (review, no grant). A purchase marked expired still grants:
--     money received always grants.
--   refunded and partial refunds: a paid purchase becomes refunded. Nothing
--     is revoked, the operator decides.
--   expired: a pending purchase becomes expired.
--   declined, canceled: recorded, the purchase stays pending (not final).
-- notice tells the server which alert to send: paid_after_expiry or
-- possible_duplicate with a grant, the reason with review.
create or replace function public.billing_apply_transaction(
  p_purchase_id         uuid,
  p_source              text,
  p_transaction_id      bigint,
  p_status              text,
  p_amount_xof          bigint,
  p_environment         text,
  -- A missing currency or reference never matches: the purchase goes to review.
  p_currency            text default null,
  p_merchant_reference  text default null,
  -- The webhook's event, so a delivery seen twice is recorded once.
  p_event_id            text default null,
  p_event_name          text default null,
  p_reference           text default null,
  p_mode                text default null,
  p_fees_xof            bigint default null,
  p_approved_at         timestamptz default null
)
returns table (
  outcome         text,
  notice          text,
  entitlement_id  uuid,
  pack_id         uuid,
  ends_at         timestamptz,
  receipt_number  text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v         public.billing_purchases%rowtype;
  v_status  text := left(lower(btrim(coalesce(p_status, ''))), 60);
  v_reason  text;
  v_notice  text;
  v_grant   record;
begin
  if p_source is null or p_source not in ('webhook', 'return', 'reconcile', 'checkout', 'manual') then
    raise exception 'Unknown source' using errcode = '22023';
  end if;
  if v_status = '' then
    raise exception 'A FedaPay status is required' using errcode = '22023';
  end if;

  select * into v from public.billing_purchases p where p.id = p_purchase_id for update;
  if not found then
    return query select 'not_found'::text, null::text, null::uuid, null::uuid, null::timestamptz, null::text;
    return;
  end if;

  -- Only the purchase's own transaction counts. One not linked yet is
  -- linked when FedaPay gives it the purchase's merchant reference.
  if p_transaction_id is null
     or (v.fedapay_transaction_id is not null and p_transaction_id <> v.fedapay_transaction_id)
     or (v.fedapay_transaction_id is null and p_merchant_reference is distinct from v.merchant_reference) then
    return query select 'ignored'::text, null::text, null::uuid, null::uuid, null::timestamptz, null::text;
    return;
  end if;

  insert into private.billing_payment_events (purchase_id, source, fedapay_event_id, event_name, fedapay_status, amount_xof)
  values (v.id, p_source, left(nullif(btrim(p_event_id), ''), 100), left(p_event_name, 100), v_status, p_amount_xof)
  on conflict (purchase_id, source, fedapay_event_id) where fedapay_event_id is not null do nothing;

  update public.billing_purchases p
  set fedapay_transaction_id = p_transaction_id,
      fedapay_status = v_status,
      fedapay_reference = coalesce(left(p_reference, 100), p.fedapay_reference),
      fedapay_mode = coalesce(left(p_mode, 60), p.fedapay_mode),
      fedapay_fees_xof = coalesce(greatest(p_fees_xof, 0), p.fedapay_fees_xof),
      last_checked_at = now()
  where p.id = v.id;

  if v_status in ('approved', 'transferred') then
    if v.granted_at is not null then
      return query
      select 'already_granted'::text, null::text, e.id, k.id, coalesce(e.ends_at, k.expires_at), r.number
      from (select 1) one
      left join public.billing_entitlements e on e.purchase_id = v.id
      left join public.billing_ai_packs k on k.purchase_id = v.id
      left join public.billing_receipts r on r.purchase_id = v.id and r.kind = 'receipt';
      return;
    end if;
    if v.status = 'review' then
      return query select 'review'::text, v.review_reason, null::uuid, null::uuid, null::timestamptz, null::text;
      return;
    end if;
    if v.status = 'refunded' then
      return query select 'unchanged'::text, null::text, null::uuid, null::uuid, null::timestamptz, null::text;
      return;
    end if;

    v_reason := case
      when p_environment is distinct from v.environment then 'environment'
      when p_merchant_reference is distinct from v.merchant_reference then 'merchant_reference'
      when p_currency is distinct from v.currency then 'currency'
      when p_amount_xof is distinct from v.amount_xof then 'amount'
      when v.organization_id is null then 'organization_deleted'
      when v.terms ->> 'kind' = 'mission' and v.workspace_id is null then 'workspace_deleted'
    end;
    if v_reason is not null then
      update public.billing_purchases p set status = 'review', review_reason = v_reason where p.id = v.id;
      insert into private.billing_events (organization_id, kind, reason, details)
      values (v.organization_id, 'review', v_reason, jsonb_build_object(
        'purchase_id', v.id,
        'fedapay_transaction_id', p_transaction_id,
        'expected_xof', v.amount_xof,
        'fedapay_amount_xof', p_amount_xof,
        'fedapay_currency', p_currency,
        'environment', p_environment,
        'source', p_source
      ));
      return query select 'review'::text, v_reason, null::uuid, null::uuid, null::timestamptz, null::text;
      return;
    end if;

    v_notice := case when v.status = 'expired' then 'paid_after_expiry' end;
    -- The last lock of the transaction, as in every billing check.
    perform private.billing_lock_org(v.organization_id);
    select * into v_grant from private.billing_grant(v.id, least(p_approved_at, now()));

    -- Two paid purchases for the same thing: both grant and stack, the
    -- operator offers a refund (ADR 8.6).
    if v_notice is null and exists (
      select 1 from public.billing_purchases p
      where p.id <> v.id
        and p.organization_id = v.organization_id
        and p.offer = v.offer
        and p.workspace_id is not distinct from v.workspace_id
        and p.status = 'paid'
        and p.created_at between v.created_at - interval '24 hours' and v.created_at + interval '24 hours'
    ) then
      v_notice := 'possible_duplicate';
    end if;

    return query select 'granted'::text, v_notice, v_grant.entitlement_id, v_grant.pack_id, v_grant.ends_at,
      v_grant.receipt_number;
    return;
  end if;

  if v_status like '%refunded%' then
    if v.status in ('paid', 'review') then
      update public.billing_purchases p
      set status = 'refunded', review_reason = null, paid_at = coalesce(p.paid_at, least(p_approved_at, now()))
      where p.id = v.id;
      insert into private.billing_events (organization_id, kind, details)
      values (v.organization_id, 'refund_seen', jsonb_build_object(
        'purchase_id', v.id,
        'fedapay_transaction_id', p_transaction_id,
        'fedapay_status', v_status,
        'was', v.status
      ));
      return query select 'refunded'::text, null::text, null::uuid, null::uuid, null::timestamptz, null::text;
      return;
    end if;
    return query select 'unchanged'::text, null::text, null::uuid, null::uuid, null::timestamptz, null::text;
    return;
  end if;

  if v_status = 'expired' then
    if v.status = 'pending' then
      update public.billing_purchases p set status = 'expired' where p.id = v.id;
      return query select 'expired'::text, null::text, null::uuid, null::uuid, null::timestamptz, null::text;
      return;
    end if;
    return query select 'unchanged'::text, null::text, null::uuid, null::uuid, null::timestamptz, null::text;
    return;
  end if;

  if v_status in ('declined', 'canceled', 'cancelled') then
    return query select 'not_paid'::text, null::text, null::uuid, null::uuid, null::timestamptz, null::text;
    return;
  end if;

  return query
  select case when v_status = 'pending' then 'pending' else 'unchanged' end,
    null::text, null::uuid, null::uuid, null::timestamptz, null::text;
end;
$$;

-- The purchase a webhook is about, by FedaPay transaction id in this
-- environment, else by merchant reference when the transaction was never
-- linked (the checkout failed after creating it). event_seen: this event
-- was already applied, so the delivery is a duplicate.
create or replace function public.billing_find_purchase(
  p_environment         text,
  p_transaction_id      bigint,
  p_merchant_reference  text default null,
  p_event_id            text default null
)
returns table (purchase_id uuid, organization_id uuid, status text, event_seen boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  select p.id into v_id
  from public.billing_purchases p
  where p.environment = p_environment and p.fedapay_transaction_id = p_transaction_id;

  if v_id is null and p_merchant_reference ~ '^KR-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select p.id into v_id
    from public.billing_purchases p
    where p.id = substr(p_merchant_reference, 4)::uuid
      and p.environment = p_environment
      and p.fedapay_transaction_id is null;
  end if;

  return query
  select p.id, p.organization_id, p.status,
    exists (
      select 1 from private.billing_payment_events e
      where e.purchase_id = p.id and e.source = 'webhook'
        and e.fedapay_event_id = left(nullif(btrim(p_event_id), ''), 100)
    )
  from public.billing_purchases p
  where p.id = v_id;
end;
$$;

-- Pending purchases to check again with FedaPay (ADR 8.7): younger than 3
-- days and not checked for p_recheck_after, the least recently checked
-- first. p_organization_id narrows it to one organization (billing page).
create or replace function public.billing_pending_purchases(
  p_environment      text,
  p_limit            integer,
  p_organization_id  uuid default null,
  p_recheck_after    interval default interval '10 minutes'
)
returns table (
  purchase_id             uuid,
  organization_id         uuid,
  fedapay_transaction_id  bigint,
  merchant_reference      text,
  created_at              timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.organization_id, p.fedapay_transaction_id, p.merchant_reference, p.created_at
  from public.billing_purchases p
  where p.status = 'pending'
    and p.environment = p_environment
    and p.created_at > now() - interval '3 days'
    and (p.last_checked_at is null or p.last_checked_at < now() - p_recheck_after)
    and (p_organization_id is null or p.organization_id = p_organization_id)
  order by p.last_checked_at nulls first, p.created_at
  limit least(greatest(coalesce(p_limit, 0), 0), 200);
$$;

-- After a reconciliation check: marks the purchase checked, and expires it
-- when it is still pending 48 hours after its creation (FedaPay expires a
-- transaction after 24). A payment approved later still grants. Returns
-- the purchase's status.
create or replace function public.billing_check_pending(p_purchase_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.billing_purchases p
  set last_checked_at = now(),
      status = case
        when p.status = 'pending' and p.created_at < now() - interval '48 hours' then 'expired'
        else p.status
      end
  where p.id = p_purchase_id
  returning p.status;
$$;

-- Claims an e-mail about a purchase before it is sent, so it goes once.
-- False when it was already claimed.
create or replace function public.billing_claim_notice(p_purchase_id uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.billing_purchase_notices (purchase_id, kind)
  values (p_purchase_id, p_kind)
  on conflict (purchase_id, kind) do nothing;
  if not found then
    return false;
  end if;
  if p_kind = 'confirmation' then
    update public.billing_purchases p set confirmation_sent_at = now() where p.id = p_purchase_id;
  end if;
  return true;
end;
$$;

-- What the confirmation e-mail needs: the buyer's address, the billing
-- address of the organization, and what was granted.
create or replace function public.billing_confirmation_details(p_purchase_id uuid)
returns table (
  organization_id    uuid,
  organization_name  text,
  offer              text,
  offer_label        text,
  quantity           integer,
  amount_xof         bigint,
  buyer_email        text,
  billing_email      text,
  plan               text,
  ends_at            timestamptz,
  drafts             integer,
  receipt_number     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id, o.name, p.offer, p.offer_label, p.quantity::integer, p.amount_xof,
    pr.email, ob.billing_email, e.plan, coalesce(e.ends_at, k.expires_at), k.drafts, r.number
  from public.billing_purchases p
  left join public.organizations o on o.id = p.organization_id
  left join public.organization_billing ob on ob.organization_id = p.organization_id
  left join public.profiles pr on pr.id = p.created_by
  left join public.billing_entitlements e on e.purchase_id = p.id
  left join public.billing_ai_packs k on k.purchase_id = p.id
  left join public.billing_receipts r on r.purchase_id = p.id and r.kind = 'receipt'
  where p.id = p_purchase_id and p.status = 'paid';
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.guard_issued_receipt() from public, anon, authenticated;
revoke all on function private.guard_receipt_lines() from public, anon, authenticated;
revoke all on function private.billing_user_can_manage(uuid, uuid) from public, anon, authenticated;
revoke all on function private.billing_plan_rank(text) from public, anon, authenticated;
revoke all on function private.billing_terms_valid(text, jsonb) from public, anon, authenticated;
revoke all on function private.billing_next_receipt_number(text, text, integer) from public, anon, authenticated;
revoke all on function private.billing_issue_receipt(uuid) from public, anon, authenticated;
revoke all on function private.billing_grant(uuid, timestamptz) from public, anon, authenticated;

revoke all on function public.billing_create_purchase(
  uuid, text, text, integer, integer, jsonb, bigint, bigint, text, uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.billing_create_purchase(
  uuid, text, text, integer, integer, jsonb, bigint, bigint, text, uuid, uuid, boolean
) to service_role;
revoke all on function public.billing_set_transaction(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.billing_set_transaction(uuid, bigint, text) to service_role;
revoke all on function public.billing_apply_transaction(
  uuid, text, bigint, text, bigint, text, text, text, text, text, text, text, bigint, timestamptz
) from public, anon, authenticated;
grant execute on function public.billing_apply_transaction(
  uuid, text, bigint, text, bigint, text, text, text, text, text, text, text, bigint, timestamptz
) to service_role;
revoke all on function public.billing_find_purchase(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.billing_find_purchase(text, bigint, text, text) to service_role;
revoke all on function public.billing_pending_purchases(text, integer, uuid, interval) from public, anon, authenticated;
grant execute on function public.billing_pending_purchases(text, integer, uuid, interval) to service_role;
revoke all on function public.billing_check_pending(uuid) from public, anon, authenticated;
grant execute on function public.billing_check_pending(uuid) to service_role;
revoke all on function public.billing_claim_notice(uuid, text) from public, anon, authenticated;
grant execute on function public.billing_claim_notice(uuid, text) to service_role;
revoke all on function public.billing_confirmation_details(uuid) from public, anon, authenticated;
grant execute on function public.billing_confirmation_details(uuid) to service_role;
