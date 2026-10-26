-- =============================================================================
-- KolabReport: AI token volume per organization (KRB-252)
--
-- Drafts now read whole deliverables (KRB-253), so one draft can use 5,000
-- tokens or 900,000. The number of drafts alone no longer caps the AI bill.
-- Each pool of AI drafts (the trial, a plan's month, a Pass Mission, a Pack
-- IA) also gets a token volume: private.billing_tokens_per_draft() tokens for
-- each draft it includes.
--
-- * billing_draft_usage keeps the tokens of each draft: the estimate while
--   it is reserved, what the calls really used once it is counted. A failed
--   draft is released and gives its tokens back, like its draft unit.
-- * billing_reserve_draft takes the estimate. A pool serves a draft when it
--   has a draft left and the estimate fits in its tokens left. When a pool
--   still had drafts but not the tokens, the refusal is tokenQuotaExceeded
--   instead of quotaExceeded, so the app can say which one ran out.
-- * start_ai_generation passes its estimate. The workspace's monthly budget
--   (p_monthly_budget) only applies while billing is not enforced: once it
--   is, the organization's token volume is the cap.
-- * billing_line_drafts reports the tokens of a line for the billing page.
-- =============================================================================

-- Mirrored in src/lib/billing/catalog.ts (AI_TOKENS_PER_DRAFT): catalog.test.ts
-- reads the value from this file.
create or replace function private.billing_tokens_per_draft()
returns bigint
language sql
immutable
set search_path = ''
as $$
  select 50000::bigint;
$$;

alter table public.billing_draft_usage
  add column if not exists tokens bigint not null default 0 check (tokens >= 0);

comment on column public.billing_draft_usage.tokens is
  'Tokens of the draft: the estimate while reserved, the input and output tokens of its calls once counted (KRB-252).';

-- Drafts recorded before this migration: what they used, or their estimate
-- while they still run.
update public.billing_draft_usage d
set tokens = case
  when d.status = 'counted' then coalesce(g.input_tokens, 0) + coalesce(g.output_tokens, 0)
  else greatest(coalesce(g.estimated_tokens, 0), 0)
end
from public.ai_generations g
where g.id = d.generation_id and d.tokens = 0;

update public.billing_draft_usage d
set tokens = coalesce(c.input_tokens, 0) + coalesce(c.output_tokens, 0)
from public.plan_import_calls c
where c.id = d.generation_id and d.status = 'counted' and d.tokens = 0;

-- -----------------------------------------------------------------------------
-- Tokens used, counted like the drafts
-- -----------------------------------------------------------------------------
-- Same rows as private.billing_drafts_used: per organization and UTC month
-- for a monthly allowance, per entitlement for the trial and a pass. A
-- reservation counts for 10 minutes while it stays reserved.
create or replace function private.billing_tokens_used(
  p_organization_id  uuid,
  p_entitlement_id   uuid,
  p_pool             text,
  p_monthly          boolean
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_alive  timestamptz := now() - interval '10 minutes';
  v_used   bigint := 0;
begin
  -- Two queries rather than one with a case, so each uses its index.
  if p_monthly then
    select coalesce(sum(d.tokens), 0) into v_used
    from public.billing_draft_usage d
    where d.organization_id = p_organization_id
      and d.usage_month = date_trunc('month', now() at time zone 'utc')::date
      and d.pool = p_pool
      and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > v_alive));
  elsif p_entitlement_id is not null then
    select coalesce(sum(d.tokens), 0) into v_used
    from public.billing_draft_usage d
    where d.entitlement_id = p_entitlement_id
      and d.pool = p_pool
      and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > v_alive));
  end if;
  return v_used;
end;
$$;

-- Tokens taken from one pack.
create or replace function private.billing_pack_tokens_used(p_pack_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(d.tokens), 0)::bigint
  from public.billing_draft_usage d
  where d.pack_id = p_pack_id
    and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > now() - interval '10 minutes'));
$$;

-- -----------------------------------------------------------------------------
-- AI drafts (ADR 3.4), with their tokens
-- -----------------------------------------------------------------------------
-- As in 20261015110000_billing_limits.sql, with p_estimated_tokens. Each pool
-- also checks its tokens: the estimate must fit in what is left. The plan
-- reading (start_plan_import_call) calls it with three arguments and so
-- reserves no tokens; its real tokens count when it succeeds.
drop function if exists private.billing_reserve_draft(uuid, uuid, uuid);

create or replace function private.billing_reserve_draft(
  p_workspace_id      uuid,
  p_generation_id     uuid,
  p_prompt_version_id uuid,
  p_estimated_tokens  bigint default 0
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
  v_per_draft  bigint := private.billing_tokens_per_draft();
  v_need       bigint := greatest(coalesce(p_estimated_tokens, 0), 0);
  v_pool       text;
  v_used       integer;
  v_tokens     bigint;
  v_pack       uuid;
  -- A pool had a draft left but not the tokens for this one.
  v_short      boolean := false;
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
    select count(*), coalesce(sum(d.tokens), 0) into v_used, v_tokens
    from public.billing_draft_usage d
    where d.entitlement_id = a.entitlement_id
      and d.pool = v_pool
      and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > v_alive));
    if v_used < a.drafts_total then
      if v_tokens + v_need <= a.drafts_total::bigint * v_per_draft then
        insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id, usage_month, tokens)
        values (p_generation_id, v_org, p_workspace_id, v_pool, a.entitlement_id, v_month, v_need);
        return query select null::text, null::integer;
        return;
      end if;
      v_short := true;
    end if;
  elsif a.drafts_per_month is null then
    -- No limit on this plan: no token volume either.
    insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id, usage_month, tokens)
    values (p_generation_id, v_org, p_workspace_id, v_pool, a.entitlement_id, v_month, v_need);
    return query select null::text, null::integer;
    return;
  else
    -- Plans: per organization and calendar month (UTC).
    select count(*), coalesce(sum(d.tokens), 0) into v_used, v_tokens
    from public.billing_draft_usage d
    where d.organization_id = v_org
      and d.usage_month = v_month
      and d.pool = v_pool
      and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > v_alive));
    if v_used < a.drafts_per_month then
      if v_tokens + v_need <= a.drafts_per_month::bigint * v_per_draft then
        insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, entitlement_id, usage_month, tokens)
        values (p_generation_id, v_org, p_workspace_id, v_pool, a.entitlement_id, v_month, v_need);
        return query select null::text, null::integer;
        return;
      end if;
      v_short := true;
    end if;
  end if;

  -- The allowance is used up: Pack IA credits work in every workspace of the
  -- organization, mission workspaces included. The first pack to expire that
  -- has a draft left and the tokens for this one.
  select p.id into v_pack
  from public.billing_ai_packs p
  cross join lateral (
    select count(*) as drafts, coalesce(sum(d.tokens), 0) as tokens
    from public.billing_draft_usage d
    where d.pack_id = p.id
      and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > v_alive))
  ) u
  where p.organization_id = v_org
    and p.revoked_at is null
    and p.expires_at > now()
    and p.drafts > u.drafts
    and u.tokens + v_need <= p.drafts::bigint * v_per_draft
  order by p.expires_at, p.id
  limit 1;
  if v_pack is not null then
    insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, pack_id, usage_month, tokens)
    values (p_generation_id, v_org, p_workspace_id, 'pack', v_pack, v_month, v_need);
    return query select null::text, null::integer;
    return;
  end if;

  if not v_short then
    v_short := exists (
      select 1
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
    );
  end if;

  return query select
    case when v_short then 'tokenQuotaExceeded' else 'quotaExceeded' end::text,
    case when a.drafts_per_month is not null
      then greatest(1, ceil(extract(epoch from v_month_end - now())))::integer
    end;
end;
$$;

-- A draft counts when it succeeds, with the tokens its calls used, and gives
-- its unit and tokens back when it fails, stale ones included. Accepting or
-- discarding it changes nothing. ai_generations and plan_import_calls both
-- run this trigger and both carry input_tokens and output_tokens. A success
-- with no usage recorded keeps its estimate.
create or replace function private.billing_settle_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   jsonb;
  v_spent bigint;
begin
  if old.status <> 'running' or new.status = 'running' then
    return null;
  end if;
  v_row := to_jsonb(new);
  v_spent := greatest(coalesce((v_row ->> 'input_tokens')::bigint, 0), 0)
    + greatest(coalesce((v_row ->> 'output_tokens')::bigint, 0), 0);
  update public.billing_draft_usage d
  set status = case when new.status = 'succeeded' then 'counted' else 'released' end,
      tokens = case when new.status = 'succeeded' and v_spent > 0 then v_spent else d.tokens end,
      settled_at = now()
  where d.generation_id = new.id and d.status = 'reserved';
  return null;
end;
$$;

-- As in 20261015110000_billing_limits.sql, with two changes: the estimate
-- goes to billing_reserve_draft, and the workspace's monthly budget only
-- applies while billing is not enforced. Same arguments and result.
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

  -- Without billing (local, CI), the workspace's monthly budget is the cap.
  -- With billing, the organization's token volume is (billing_reserve_draft).
  if not private.billing_enforced() then
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
  end if;

  -- Billing (ADR 001, 3.4 and 7.1). Nothing is reserved while billing is
  -- not enforced.
  new_id := gen_random_uuid();
  select b.refusal, b.retry_after into billing
  from private.billing_reserve_draft(p_workspace_id, new_id, p_prompt_version_id, p_estimated_tokens::bigint) b;
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
-- Billing page: the tokens of a line
-- -----------------------------------------------------------------------------
-- As in 20261015170000_billing_page.sql, with tokensUsed and tokensAllowance
-- (null when the line has no limit).
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
  with line as (
    select
      case when p_plan = 'trial' then 'trial' when p_mission then 'mission' else 'subscription' end as pool,
      p_drafts_total is null as monthly
  )
  select jsonb_build_object(
    'used', private.billing_drafts_used(p_organization_id, p_entitlement_id, line.pool, line.monthly),
    'allowance', coalesce(p_drafts_total, p_drafts_per_month),
    'period', case when p_drafts_total is not null then 'total' else 'month' end,
    'tokensUsed', private.billing_tokens_used(p_organization_id, p_entitlement_id, line.pool, line.monthly),
    'tokensAllowance', coalesce(p_drafts_total, p_drafts_per_month)::bigint * private.billing_tokens_per_draft()
  )
  from line;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.billing_tokens_per_draft() from public, anon, authenticated;
revoke all on function private.billing_tokens_used(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function private.billing_pack_tokens_used(uuid) from public, anon, authenticated;
revoke all on function private.billing_reserve_draft(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function private.billing_settle_draft() from public, anon, authenticated;
revoke all on function private.billing_line_drafts(uuid, boolean, uuid, text, integer, integer)
  from public, anon, authenticated;
