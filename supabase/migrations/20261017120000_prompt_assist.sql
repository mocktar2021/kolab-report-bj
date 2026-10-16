-- =============================================================================
-- KolabReport: AI help to write a prompt template (Story KRB-198)
--
-- "Rédiger avec l'IA" on the new template page turns a few sentences into a
-- template text that the manager reads and edits before saving. It is not a
-- draft of a section: it stays out of ai_generations, the monthly token
-- budget per workspace and the AI drafts of the plan. Each call is one row of
-- prompt_assist_calls, with its model, tokens and estimated cost, so the
-- spend shows on the AI dashboard and counts in the daily cost alert.
--
-- The app writes the rows with the service role, after its own checks.
-- start_prompt_assist checks the role and the plan again, applies the daily
-- limit per user under a lock and records the call as running, before any
-- model call. finish_prompt_assist records how it ended. Users only read:
-- their own calls, and owners and admins those of their workspace. Neither
-- the description nor the answer is kept, only counts.
--
-- Only new objects: claim_ai_cost_alert stays as it was for the app version
-- that runs between this migration and the deploy, and the app moves to
-- claim_ai_daily_cost_alert, which adds these calls to the day's spend.
-- =============================================================================

create table public.prompt_assist_calls (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  user_id        uuid references public.profiles (id) on delete set null,
  provider       text not null check (char_length(provider) between 1 and 40),
  model          text not null check (char_length(model) between 1 and 120),
  status         text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  error_code     text check (char_length(error_code) <= 40),
  -- Length of the description the manager wrote, in characters.
  input_chars    integer not null check (input_chars between 0 and 10000),
  input_tokens   integer check (input_tokens >= 0),
  output_tokens  integer check (output_tokens >= 0),
  total_tokens   integer generated always as (coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) stored,
  cost_estimate  numeric(12, 6) check (cost_estimate >= 0),
  latency_ms     integer check (latency_ms >= 0),
  trace_id       text check (trace_id ~ '^[0-9a-f]{32}$'),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  check ((status = 'running') = (completed_at is null)),
  check (status <> 'failed' or error_code is not null)
);

comment on table public.prompt_assist_calls is
  'One "Rédiger avec l''IA" call per row (Story KRB-198): usage and cost only. Written with the service role.';

-- The daily limit counts a user's calls, the dashboard a workspace's, and
-- the cost alert the whole environment's day.
create index prompt_assist_calls_user_idx      on public.prompt_assist_calls (user_id, created_at desc);
create index prompt_assist_calls_workspace_idx on public.prompt_assist_calls (workspace_id, created_at desc);
create index prompt_assist_calls_created_idx   on public.prompt_assist_calls (created_at);

-- -----------------------------------------------------------------------------
-- RLS and privileges
-- -----------------------------------------------------------------------------
alter table public.prompt_assist_calls enable row level security;

-- People read their own calls while they belong to the workspace, and its
-- owners and admins read all of them for the AI dashboard.
create policy "prompt_assist_calls: own calls and managers read"
  on public.prompt_assist_calls for select to authenticated
  using (
    (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
    or private.is_workspace_manager(workspace_id)
  );

-- No insert, update or delete for users: the two functions below write.
revoke all on public.prompt_assist_calls from anon, authenticated;
grant select on public.prompt_assist_calls to authenticated;

-- -----------------------------------------------------------------------------
-- Starting a call: role, plan and daily limit in one locked step
-- -----------------------------------------------------------------------------
-- Called by the app with the service role. Returns the new call id, or why
-- there is none ('forbidden', 'readOnly', 'templatesNotIncluded',
-- 'rateLimited') and, for the limit, the seconds until the next UTC day.
-- Calls count when they start, failed ones included, across workspaces.
create or replace function public.start_prompt_assist(
  p_workspace_id uuid,
  p_user_id      uuid,
  p_provider     text,
  p_model        text,
  p_input_chars  integer,
  p_daily_limit  integer
)
returns table (call_id uuid, refusal text, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  day_from timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  used     integer;
  new_id   uuid;
begin
  if p_daily_limit is null or p_daily_limit < 1 then
    raise exception 'The daily limit must be at least 1' using errcode = '22023';
  end if;

  -- Two calls of the same person never both slip under the limit.
  perform pg_advisory_xact_lock(hashtextextended('prompt_assist/user/' || p_user_id::text, 0));

  -- Owners and admins, as for saving a template.
  if p_user_id is null or not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = p_user_id
      and m.role in ('owner', 'admin')
  ) then
    return query select null::uuid, 'forbidden'::text, null::integer;
    return;
  end if;

  -- The same plan rules as private.billing_check_templates (KR043, KR044).
  -- Nothing is checked while billing is not enforced.
  select * into a from private.workspace_access(p_workspace_id);
  if found and a.enforced then
    if a.state = 'read_only' then
      return query select null::uuid, 'readOnly'::text, null::integer;
      return;
    end if;
    if not a.custom_templates then
      return query select null::uuid, 'templatesNotIncluded'::text, null::integer;
      return;
    end if;
  end if;

  -- A call still running after 10 minutes died with its request.
  update public.prompt_assist_calls c
  set status = 'failed', error_code = 'stale', completed_at = now()
  where c.user_id = p_user_id and c.status = 'running' and c.created_at < now() - interval '10 minutes';

  select count(*) into used
  from public.prompt_assist_calls c
  where c.user_id = p_user_id and c.created_at >= day_from;
  if used >= p_daily_limit then
    return query select null::uuid, 'rateLimited'::text,
      greatest(1, ceil(extract(epoch from day_from + interval '1 day' - now())))::integer;
    return;
  end if;

  insert into public.prompt_assist_calls (workspace_id, user_id, provider, model, input_chars)
  values (p_workspace_id, p_user_id, p_provider, p_model, greatest(0, least(coalesce(p_input_chars, 0), 10000)))
  returning id into new_id;

  return query select new_id, null::text, null::integer;
end;
$$;

-- Records how a running call ended. False when it was no longer running
-- (marked stale meanwhile) or belongs to another workspace.
create or replace function public.finish_prompt_assist(
  p_call_id       uuid,
  p_workspace_id  uuid,
  p_status        text,
  p_error_code    text,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_cost_estimate numeric,
  p_latency_ms    integer,
  p_trace_id      text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_status is null or p_status not in ('succeeded', 'failed') then
    raise exception 'A call ends as succeeded or failed' using errcode = '22023';
  end if;

  update public.prompt_assist_calls c
  set status = p_status,
      error_code = case when p_status = 'failed' then coalesce(left(nullif(btrim(p_error_code), ''), 40), 'failed') end,
      input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
      output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
      cost_estimate = case when p_cost_estimate is null then null else greatest(p_cost_estimate, 0) end,
      latency_ms = greatest(coalesce(p_latency_ms, 0), 0),
      trace_id = p_trace_id,
      completed_at = now()
  where c.id = p_call_id and c.workspace_id = p_workspace_id and c.status = 'running';
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.start_prompt_assist(uuid, uuid, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.start_prompt_assist(uuid, uuid, text, text, integer, integer) to service_role;
revoke all on function public.finish_prompt_assist(uuid, uuid, text, text, integer, integer, numeric, integer, text)
  from public, anon, authenticated;
grant execute on function public.finish_prompt_assist(uuid, uuid, text, text, integer, integer, numeric, integer, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- AI dashboard: the calls of a workspace per model
-- -----------------------------------------------------------------------------
-- Runs with the caller's rights: RLS gives owners and admins the whole
-- workspace, anyone else their own calls.
create or replace function public.prompt_assist_metrics(p_workspace_id uuid, p_since timestamptz)
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
  from public.prompt_assist_calls c
  where c.workspace_id = p_workspace_id
    and c.created_at >= coalesce(p_since, '-infinity'::timestamptz)
  group by c.model
  order by max(c.created_at) desc;
$$;

revoke all on function public.prompt_assist_metrics(uuid, timestamptz) from public, anon;
grant execute on function public.prompt_assist_metrics(uuid, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Daily cost alert with the template writer
-- -----------------------------------------------------------------------------
-- Same as claim_ai_cost_alert (20261014000000), with the calls above in the
-- day's spend: today's estimated spend of the whole environment when it
-- passed p_threshold and no alert went out yet today, else null. The row it
-- adds to ai_cost_alerts keeps the other calls from sending it again, and
-- release_ai_cost_alert still gives the day back.
create or replace function public.claim_ai_daily_cost_alert(p_threshold numeric)
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
    + coalesce((select sum(c.cost_estimate) from public.prompt_assist_calls c where c.created_at >= day_from), 0)
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

revoke all on function public.claim_ai_daily_cost_alert(numeric) from public, anon, authenticated;
grant execute on function public.claim_ai_daily_cost_alert(numeric) to service_role;
