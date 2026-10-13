-- =============================================================================
-- KolabReport: AI section drafts (Story KRB-16)
--
-- Each request for a draft is one row of ai_generations: who asked, with
-- which prompt version and model, what went in (hashes, truncation), what
-- came out (the checked object and the raw text), what it cost, and what the
-- expert did with it. A draft is a proposal: it reaches
-- report_sections.content only when the expert accepts it.
--
-- The app writes generations with the service role, after its own access
-- checks: start_ai_generation applies the hourly limit per user and the
-- monthly token budget per workspace under a lock, so parallel requests
-- can't both slip under them. Users read the generations of the sections
-- they can edit, rate their own, and accept or discard a proposal through
-- the two functions at the end, which check the same rights.
-- =============================================================================

create type public.ai_generation_status as enum ('running', 'succeeded', 'failed');

create table public.ai_generations (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null,
  section_id         uuid not null,
  requested_by       uuid references public.profiles (id) on delete set null,
  prompt_version_id  uuid references public.prompt_library (id) on delete set null,
  output_schema      text not null
    check (output_schema in ('section_draft', 'executive_summary', 'recommendations', 'data_analysis')),
  schema_version     smallint not null check (schema_version > 0),
  provider           text not null check (char_length(provider) between 1 and 40),
  model              text not null check (char_length(model) between 1 and 120),
  -- Temperature, output cap and model tier the call used.
  params             jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  -- sha256 of the whole context, and of each deliverable's parsed text by id.
  input_hash         text check (input_hash ~ '^[0-9a-f]{64}$'),
  input_hashes       jsonb not null default '{}' check (jsonb_typeof(input_hashes) = 'object'),
  -- Deliverables sent and what was cut, summarized or left out.
  context_meta       jsonb not null default '{}' check (jsonb_typeof(context_meta) = 'object'),
  truncated          boolean not null default false,
  status             public.ai_generation_status not null default 'running',
  error_code         text check (char_length(error_code) <= 40),
  -- The first answer failed the schema and a second call fixed it.
  repaired           boolean not null default false,
  -- Counted against the budget while the generation runs.
  estimated_tokens   integer not null check (estimated_tokens >= 0),
  -- Every call of the generation together: summaries, draft and repair.
  input_tokens       integer check (input_tokens >= 0),
  output_tokens      integer check (output_tokens >= 0),
  total_tokens       integer generated always as (coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) stored,
  cost_estimate      numeric(12, 6) check (cost_estimate >= 0),
  latency_ms         integer check (latency_ms >= 0),
  output             jsonb,
  raw_output         text check (char_length(raw_output) <= 200000),
  -- Words of the proposal's Markdown, to read edit_distance against.
  draft_words        integer check (draft_words >= 0),
  -- Null until the expert decides: true accepted, false discarded.
  accepted           boolean,
  decided_at         timestamptz,
  -- Words added or removed between the proposal and what was accepted.
  edit_distance      integer check (edit_distance >= 0),
  user_rating        smallint check (user_rating in (-1, 1)),
  feedback_comment   text check (char_length(feedback_comment) <= 1000),
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  updated_at         timestamptz not null default now(),
  foreign key (section_id, workspace_id)
    references public.report_sections (id, workspace_id) on delete cascade,
  check (status <> 'succeeded' or output is not null),
  check (accepted is null or status = 'succeeded'),
  check ((accepted is null) = (decided_at is null)),
  check (edit_distance is null or accepted)
);

comment on table public.ai_generations is
  'One AI draft request per row (Story KRB-16). Written by the app with the service role.';

create index ai_generations_section_idx   on public.ai_generations (section_id, created_at desc);
create index ai_generations_requester_idx on public.ai_generations (requested_by, created_at desc);
create index ai_generations_workspace_idx on public.ai_generations (workspace_id, created_at desc);
create index ai_generations_prompt_idx    on public.ai_generations (prompt_version_id);

-- One draft at a time per section.
create unique index ai_generations_one_running
  on public.ai_generations (section_id) where status = 'running';

create trigger set_updated_at before update on public.ai_generations
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS and privileges
-- -----------------------------------------------------------------------------
alter table public.ai_generations enable row level security;

-- Managers, and the expert who can edit the section, see its drafts.
create policy "ai_generations: section editors read"
  on public.ai_generations for select to authenticated
  using (private.is_workspace_manager(workspace_id) or private.can_edit_section(section_id));

-- The person who asked rates the proposal, while still in the workspace.
create policy "ai_generations: requester rates"
  on public.ai_generations for update to authenticated
  using (
    requested_by = (select auth.uid())
    and status = 'succeeded'
    and private.is_workspace_member(workspace_id)
  )
  with check (requested_by = (select auth.uid()) and status = 'succeeded');

revoke all on public.ai_generations from anon, authenticated;
grant select on public.ai_generations to authenticated;
grant update (user_rating, feedback_comment) on public.ai_generations to authenticated;

-- -----------------------------------------------------------------------------
-- Starting a generation: limits, budget and the running row in one step
-- -----------------------------------------------------------------------------
-- Called by the app with the service role once it has checked that the user
-- can edit the section. Returns the new generation id, or why there is none
-- and how many seconds to wait. Requests are counted when they start, failed
-- ones included. The budget month is the calendar month in UTC, and a running
-- generation counts for its estimate until it finishes.
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
  p_monthly_budget    bigint
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
begin
  -- Same order everywhere, so two requests never wait on each other's lock.
  perform pg_advisory_xact_lock(hashtextextended('ai_generations/user/' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('ai_generations/workspace/' || p_workspace_id::text, 0));

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

  -- The hashes and the context are recorded when the generation ends.
  insert into public.ai_generations (
    workspace_id, section_id, requested_by, prompt_version_id, output_schema, schema_version,
    provider, model, params, estimated_tokens
  ) values (
    p_workspace_id, p_section_id, p_user_id, p_prompt_version_id, p_output_schema, p_schema_version,
    p_provider, p_model, coalesce(p_params, '{}'), p_estimated_tokens
  )
  returning id into new_id;

  return query select new_id, null::text, null::integer;
end;
$$;

revoke all on function public.start_ai_generation(
  uuid, uuid, uuid, uuid, text, smallint, text, text, jsonb, integer, integer, bigint
) from public, anon, authenticated;
grant execute on function public.start_ai_generation(
  uuid, uuid, uuid, uuid, text, smallint, text, text, jsonb, integer, integer, bigint
) to service_role;

-- -----------------------------------------------------------------------------
-- Accepting or discarding a proposal
-- -----------------------------------------------------------------------------
-- Errors: 42501 when the caller can't edit the section, P0002 when the
-- generation doesn't exist, 55000 when it isn't a proposal waiting for a
-- decision, 40001 when the section changed since the page was loaded.

-- Locks the generation and checks that the caller can decide on it.
create or replace function private.lock_proposal(generation uuid)
returns public.ai_generations
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.ai_generations;
begin
  select * into proposal from public.ai_generations g where g.id = generation for update;
  if not found then
    raise exception 'Brouillon introuvable' using errcode = 'P0002';
  end if;
  if not private.can_edit_section(proposal.section_id) then
    raise exception 'Seules les personnes qui rédigent la section décident de ses brouillons'
      using errcode = '42501';
  end if;
  if proposal.status <> 'succeeded' or proposal.accepted is not null then
    raise exception 'Ce brouillon n''attend plus de décision' using errcode = '55000';
  end if;
  return proposal;
end;
$$;

-- Puts the text the expert accepted (the proposal, edited or not) in the
-- section, moves a section not started yet to in progress, and records the
-- decision. Returns the section's new updated_at.
create or replace function public.accept_ai_generation(
  p_generation_id      uuid,
  p_content            text,
  p_edit_distance      integer,
  p_section_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.ai_generations;
  section  public.report_sections;
  saved_at timestamptz;
begin
  proposal := private.lock_proposal(p_generation_id);

  if p_content is null or char_length(btrim(p_content)) = 0 or char_length(p_content) > 100000 then
    raise exception 'Le texte accepté doit compter entre 1 et 100 000 caractères' using errcode = '22023';
  end if;
  if p_edit_distance is null or p_edit_distance < 0 then
    raise exception 'Distance d''édition invalide' using errcode = '22023';
  end if;

  select * into section from public.report_sections s where s.id = proposal.section_id for update;
  if p_section_updated_at is not null and section.updated_at <> p_section_updated_at then
    raise exception 'La section a changé depuis le chargement de la page' using errcode = '40001';
  end if;

  update public.report_sections s
  set content = p_content,
      status = case when s.status = 'not_started' then 'in_progress'::public.section_status else s.status end,
      ai_draft = proposal.output,
      ai_generated_at = proposal.completed_at
  where s.id = proposal.section_id
  returning s.updated_at into saved_at;

  update public.ai_generations g
  set accepted = true, decided_at = now(), edit_distance = p_edit_distance
  where g.id = proposal.id;

  return saved_at;
end;
$$;

create or replace function public.discard_ai_generation(p_generation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.ai_generations;
begin
  proposal := private.lock_proposal(p_generation_id);
  update public.ai_generations g set accepted = false, decided_at = now() where g.id = proposal.id;
end;
$$;

revoke all on function private.lock_proposal(uuid) from public, anon;
revoke all on function public.accept_ai_generation(uuid, text, integer, timestamptz) from public, anon;
revoke all on function public.discard_ai_generation(uuid) from public, anon;
grant execute on function public.accept_ai_generation(uuid, text, integer, timestamptz) to authenticated;
grant execute on function public.discard_ai_generation(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Online metrics per prompt version and model (read by Story KRB-17)
-- -----------------------------------------------------------------------------
-- RLS on ai_generations applies (security_invoker): managers see their
-- workspace's figures, experts those of the sections they edit.
create view public.ai_generation_metrics
with (security_invoker = true)
as
select
  g.workspace_id,
  g.prompt_version_id,
  g.model,
  count(*)                                                    as generations,
  count(*) filter (where g.status = 'succeeded')              as succeeded,
  count(*) filter (where g.status = 'failed')                 as failed,
  count(*) filter (where g.repaired)                          as repaired,
  count(*) filter (where g.accepted)                          as accepted,
  count(*) filter (where g.accepted = false)                  as discarded,
  round(avg(g.edit_distance::numeric / nullif(g.draft_words, 0)) filter (where g.accepted), 4)
                                                              as mean_edit_ratio,
  count(*) filter (where g.user_rating = 1)                   as thumbs_up,
  count(*) filter (where g.user_rating = -1)                  as thumbs_down,
  round(avg(g.latency_ms) filter (where g.status = 'succeeded'))::integer as mean_latency_ms,
  sum(g.total_tokens)                                         as total_tokens,
  sum(g.cost_estimate)                                        as total_cost
from public.ai_generations g
group by g.workspace_id, g.prompt_version_id, g.model;

revoke all on public.ai_generation_metrics from anon, authenticated;
grant select on public.ai_generation_metrics to authenticated;
