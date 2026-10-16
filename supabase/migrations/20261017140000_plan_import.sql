-- =============================================================================
-- KolabReport: create a report's sections from its plan (KRB-196)
--
-- * import_report_plan creates a whole plan in one go, or nothing: owners
--   and admins, while the report is not final. The plan is a list of 1 to
--   200 items (title, level 1 or 2, instructions). Sections go after the
--   report's own; a subsection goes under the closest section before it in
--   the plan. The triggers on report_sections still check the parent, a
--   final report and a read-only workspace.
-- * Reading a PDF plan is an AI call. It counts as one AI draft of the
--   month: start_plan_import_call reserves it in billing_draft_usage, under
--   the organization lock, with private.billing_reserve_draft, as
--   start_ai_generation does. The reservation counts when the reading
--   succeeds and is released when it fails, by the same trigger functions.
-- * plan_import_calls keeps one row per reading, with the model, tokens and
--   estimated cost, so the AI dashboard and the daily cost alert see the
--   spend. Neither the file nor its text is kept.
-- * claim_ai_cost_alert adds these calls to the day's spend.
--
-- Error codes:
--   KR052  the report would have more than 500 sections
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Creating the sections of a plan
-- -----------------------------------------------------------------------------
-- p_items is a JSON array of {"title", "level", "instructions"} objects, in
-- the order of the plan. The first item is a section. Returns how many
-- sections were created. Any invalid item stops the whole import (22023).
create or replace function public.import_report_plan(p_report_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := (select auth.uid());
  v_report       public.reports;
  v_role         public.workspace_role;
  v_count        integer;
  v_next         integer;
  v_parent       uuid;
  v_child        integer := 0;
  v_item         jsonb;
  v_index        bigint;
  v_title        text;
  v_level        text;
  v_instructions text;
begin
  if v_actor is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  -- A report the caller cannot see answers like a missing one.
  select r.* into v_report from public.reports r where r.id = p_report_id;
  if not found or not private.is_workspace_member(v_report.workspace_id) then
    raise exception 'Rapport introuvable' using errcode = 'P0002';
  end if;
  select m.role into v_role
  from public.workspace_members m
  where m.workspace_id = v_report.workspace_id and m.user_id = v_actor;
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Seuls les propriétaires et administrateurs importent un plan' using errcode = '42501';
  end if;

  -- Two imports of the same report run one after the other, so their
  -- positions follow each other. The report can't become final meanwhile.
  perform pg_advisory_xact_lock(hashtextextended('report_sections/report/' || v_report.id::text, 0));
  select r.* into v_report from public.reports r where r.id = p_report_id for share;
  if v_report.status = 'final' then
    raise exception 'Ce rapport est final : rouvrez-le pour le modifier' using errcode = 'KR020';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Le plan doit être une liste' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count not between 1 and 200 then
    raise exception 'Un plan compte de 1 à 200 éléments' using errcode = '22023';
  end if;
  -- reorder_report_sections takes at most 500 ids from the app.
  if (select count(*) from public.report_sections s where s.report_id = v_report.id) + v_count > 500 then
    raise exception 'Un rapport compte au plus 500 sections' using errcode = 'KR052';
  end if;

  select coalesce(max(s.position) + 1, 0) into v_next
  from public.report_sections s
  where s.report_id = v_report.id and s.parent_id is null;

  for v_item, v_index in select e.value, e.ordinality from jsonb_array_elements(p_items) with ordinality e loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'title') is distinct from 'string' then
      raise exception 'L''élément % du plan n''a pas de titre', v_index using errcode = '22023';
    end if;
    v_title := regexp_replace(btrim(v_item ->> 'title'), '\s+', ' ', 'g');
    if char_length(v_title) not between 1 and 200 then
      raise exception 'Le titre de l''élément % compte de 1 à 200 caractères', v_index using errcode = '22023';
    end if;

    v_level := case when jsonb_typeof(v_item -> 'level') = 'number' then v_item ->> 'level' end;
    if v_level is null or v_level not in ('1', '2') then
      raise exception 'L''élément % est une section (1) ou une sous-section (2)', v_index using errcode = '22023';
    end if;

    if coalesce(jsonb_typeof(v_item -> 'instructions'), 'null') not in ('string', 'null') then
      raise exception 'Les consignes de l''élément % sont du texte', v_index using errcode = '22023';
    end if;
    v_instructions := nullif(btrim(v_item ->> 'instructions'), '');
    if char_length(v_instructions) > 4000 then
      raise exception 'Les consignes de l''élément % comptent 4000 caractères au plus', v_index
        using errcode = '22023';
    end if;

    if v_level = '1' then
      insert into public.report_sections (workspace_id, report_id, title, instructions, position)
      values (v_report.workspace_id, v_report.id, v_title, v_instructions, v_next)
      returning id into v_parent;
      v_next := v_next + 1;
      v_child := 0;
    else
      if v_parent is null then
        raise exception 'Le premier élément du plan est une section' using errcode = '22023';
      end if;
      insert into public.report_sections (workspace_id, report_id, parent_id, title, instructions, position)
      values (v_report.workspace_id, v_report.id, v_parent, v_title, v_instructions, v_child);
      v_child := v_child + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- AI readings of a PDF plan
-- -----------------------------------------------------------------------------
create table public.plan_import_calls (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  -- Kept when the report goes, so the spend still shows.
  report_id      uuid references public.reports (id) on delete set null,
  user_id        uuid references public.profiles (id) on delete set null,
  provider       text not null check (char_length(provider) between 1 and 40),
  model          text not null check (char_length(model) between 1 and 120),
  status         text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  error_code     text check (char_length(error_code) <= 40),
  -- Characters of text and pages read from the PDF, before any cut.
  input_chars    integer not null check (input_chars >= 0),
  pages          integer not null check (pages >= 0),
  -- Items of the plan the AI proposed.
  items          integer check (items between 0 and 200),
  input_tokens   integer check (input_tokens >= 0),
  output_tokens  integer check (output_tokens >= 0),
  total_tokens   integer generated always as (coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) stored,
  cost_estimate  numeric(12, 6) check (cost_estimate >= 0),
  latency_ms     integer check (latency_ms >= 0),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  check ((status = 'running') = (completed_at is null)),
  check (status <> 'failed' or error_code is not null)
);

comment on table public.plan_import_calls is
  'One AI reading of a PDF plan per row (KRB-196): usage and cost only, no text. Written with the service role.';

-- The hourly limit counts a user's calls, the dashboard a workspace's, and
-- the cost alert the whole environment's day.
create index plan_import_calls_user_idx      on public.plan_import_calls (user_id, created_at desc);
create index plan_import_calls_workspace_idx on public.plan_import_calls (workspace_id, created_at desc);
create index plan_import_calls_report_idx    on public.plan_import_calls (report_id) where report_id is not null;
create index plan_import_calls_created_idx   on public.plan_import_calls (created_at);

alter table public.plan_import_calls enable row level security;

-- People read their own calls while they belong to the workspace, and its
-- owners and admins read all of them for the AI dashboard.
create policy "plan_import_calls: own calls and managers read"
  on public.plan_import_calls for select to authenticated
  using (
    (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
    or private.is_workspace_manager(workspace_id)
  );

-- No insert, update or delete for users: the functions below write.
revoke all on public.plan_import_calls from anon, authenticated;
grant select on public.plan_import_calls to authenticated;

-- The AI draft a reading reserved counts when it succeeds and is released
-- when it fails or when its row goes, like a section draft.
create trigger billing_settle_draft
  after update of status on public.plan_import_calls
  for each row execute function private.billing_settle_draft();

create trigger billing_release_deleted_draft
  after delete on public.plan_import_calls
  for each row execute function private.billing_release_deleted_draft();

-- Called by the app with the service role, once the PDF's text is read and
-- before the model is called. Checks the role and the report again, the
-- hourly limit of the user, then reserves one AI draft of the plan (read-only
-- and quota included) and records the call as running. Returns the call id,
-- or why there is none: 'forbidden', 'reportFinal', 'rateLimited' (with the
-- seconds until a call leaves the hour), 'readOnly' or 'quotaExceeded' (with
-- the seconds to the next month for a monthly allowance).
create or replace function public.start_plan_import_call(
  p_workspace_id uuid,
  p_report_id    uuid,
  p_user_id      uuid,
  p_provider     text,
  p_model        text,
  p_input_chars  integer,
  p_pages        integer,
  p_hourly_limit integer
)
returns table (call_id uuid, refusal text, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  public.report_status;
  v_recent  integer;
  v_freed   timestamptz;
  v_new_id  uuid := gen_random_uuid();
  v_billing record;
begin
  if p_hourly_limit is null or p_hourly_limit < 1 then
    raise exception 'The hourly limit must be at least 1' using errcode = '22023';
  end if;

  -- The user first, then the organization (in billing_reserve_draft), as
  -- start_ai_generation does.
  perform pg_advisory_xact_lock(hashtextextended('plan_import/user/' || coalesce(p_user_id::text, ''), 0));

  if p_user_id is null or not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) then
    return query select null::uuid, 'forbidden'::text, null::integer;
    return;
  end if;
  select r.status into v_status
  from public.reports r
  where r.id = p_report_id and r.workspace_id = p_workspace_id;
  if not found then
    return query select null::uuid, 'forbidden'::text, null::integer;
    return;
  end if;
  if v_status = 'final' then
    return query select null::uuid, 'reportFinal'::text, null::integer;
    return;
  end if;

  -- A call still running after 10 minutes died with its request.
  update public.plan_import_calls c
  set status = 'failed', error_code = 'stale', completed_at = now()
  where c.user_id = p_user_id and c.status = 'running' and c.created_at < now() - interval '10 minutes';

  select count(*) into v_recent
  from public.plan_import_calls c
  where c.user_id = p_user_id and c.created_at > now() - interval '1 hour';
  if v_recent >= p_hourly_limit then
    -- The call that has to leave the hour before one more fits.
    select c.created_at into v_freed
    from public.plan_import_calls c
    where c.user_id = p_user_id and c.created_at > now() - interval '1 hour'
    order by c.created_at
    offset (v_recent - p_hourly_limit)
    limit 1;
    return query select null::uuid, 'rateLimited'::text,
      greatest(1, ceil(extract(epoch from v_freed + interval '1 hour' - now())))::integer;
    return;
  end if;

  -- One AI draft of the plan (ADR 001, 3.4). Nothing is reserved or checked
  -- while billing is not enforced.
  select b.refusal, b.retry_after into v_billing
  from private.billing_reserve_draft(p_workspace_id, v_new_id, null) b;
  if v_billing.refusal is not null then
    return query select null::uuid, v_billing.refusal, v_billing.retry_after;
    return;
  end if;

  insert into public.plan_import_calls (id, workspace_id, report_id, user_id, provider, model, input_chars, pages)
  values (v_new_id, p_workspace_id, p_report_id, p_user_id, p_provider, p_model,
    greatest(coalesce(p_input_chars, 0), 0), greatest(coalesce(p_pages, 0), 0));

  return query select v_new_id, null::text, null::integer;
end;
$$;

-- Records how a running call ended. False when it was no longer running
-- (marked stale meanwhile) or belongs to another workspace.
create or replace function public.finish_plan_import_call(
  p_call_id       uuid,
  p_workspace_id  uuid,
  p_status        text,
  p_error_code    text,
  p_items         integer,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_cost_estimate numeric,
  p_latency_ms    integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  if p_status is null or p_status not in ('succeeded', 'failed') then
    raise exception 'A call ends as succeeded or failed' using errcode = '22023';
  end if;

  update public.plan_import_calls c
  set status = p_status,
      error_code = case when p_status = 'failed' then coalesce(left(nullif(btrim(p_error_code), ''), 40), 'failed') end,
      items = case when p_items is null then null else least(greatest(p_items, 0), 200) end,
      input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
      output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
      cost_estimate = case when p_cost_estimate is null then null else greatest(p_cost_estimate, 0) end,
      latency_ms = greatest(coalesce(p_latency_ms, 0), 0),
      completed_at = now()
  where c.id = p_call_id and c.workspace_id = p_workspace_id and c.status = 'running';
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- AI dashboard: the readings of a workspace per model
-- -----------------------------------------------------------------------------
-- Runs with the caller's rights: RLS gives owners and admins the whole
-- workspace, anyone else their own calls.
create or replace function public.plan_import_metrics(p_workspace_id uuid, p_since timestamptz)
returns table (
  model         text,
  calls         bigint,
  succeeded     bigint,
  failed        bigint,
  input_tokens  bigint,
  output_tokens bigint,
  cost          numeric,
  last_call     timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.model,
    count(*),
    count(*) filter (where c.status = 'succeeded'),
    count(*) filter (where c.status = 'failed'),
    coalesce(sum(c.input_tokens), 0)::bigint,
    coalesce(sum(c.output_tokens), 0)::bigint,
    sum(c.cost_estimate),
    max(c.created_at)
  from public.plan_import_calls c
  where c.workspace_id = p_workspace_id
    and c.created_at >= coalesce(p_since, '-infinity'::timestamptz)
  group by c.model
  order by max(c.created_at) desc;
$$;

-- -----------------------------------------------------------------------------
-- Daily cost alert
-- -----------------------------------------------------------------------------
-- Same as in 20261014000000_ai_observability_rollouts.sql, with the plan
-- readings in the day's spend.
create or replace function public.claim_ai_cost_alert(p_threshold numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  today    date := (now() at time zone 'utc')::date;
  day_from timestamptz := (now() at time zone 'utc')::date::timestamp at time zone 'utc';
  spent    numeric;
begin
  select
    coalesce((select sum(g.cost_estimate) from public.ai_generations g where g.created_at >= day_from), 0)
    + coalesce((select sum(c.cost_estimate) from public.plan_import_calls c where c.created_at >= day_from), 0)
  into spent;
  if spent <= p_threshold then
    return null;
  end if;
  insert into public.ai_cost_alerts (day, total_usd, threshold_usd)
  values (today, spent, p_threshold)
  on conflict (day) do nothing;
  return case when found then spent else null end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function public.import_report_plan(uuid, jsonb) from public, anon;
grant execute on function public.import_report_plan(uuid, jsonb) to authenticated;

revoke all on function public.start_plan_import_call(uuid, uuid, uuid, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.start_plan_import_call(uuid, uuid, uuid, text, text, integer, integer, integer)
  to service_role;
revoke all on function public.finish_plan_import_call(uuid, uuid, text, text, integer, integer, integer, numeric, integer)
  from public, anon, authenticated;
grant execute on function public.finish_plan_import_call(uuid, uuid, text, text, integer, integer, integer, numeric, integer)
  to service_role;

revoke all on function public.plan_import_metrics(uuid, timestamptz) from public, anon;
grant execute on function public.plan_import_metrics(uuid, timestamptz) to authenticated;

revoke all on function public.claim_ai_cost_alert(numeric) from public, anon, authenticated;
grant execute on function public.claim_ai_cost_alert(numeric) to service_role;
