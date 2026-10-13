-- =============================================================================
-- KolabReport: AI observability and prompt rollouts (Story KRB-17)
--
-- Prompt rollouts: a draft version of a template can serve a share of the
-- generations before it is published for everyone. Managers start, adjust,
-- publish or cancel a rollout of their workspace templates through the
-- functions below. Global templates are rolled out with the service role,
-- to a share of all workspaces or to one workspace. A published version can
-- go back to the one published before it in one call.
--
-- Each generation records the rollout it came from and its trace id, and
-- ai_prompt_metrics() sums what the dashboard shows per prompt version.
-- ai_cost_alerts keeps one row per day the estimated spend passed the alert
-- threshold, so the alert e-mail goes out once a day.
--
-- Errors: KR010 the rollout is over, KR011 only a draft can be rolled out,
-- KR012 the template has no published version (or the version isn't the
-- published one), KR013 nothing was published before this version.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- When a version was published, to find the one before it
-- -----------------------------------------------------------------------------
alter table public.prompt_library add column published_at timestamptz;

comment on column public.prompt_library.published_at is
  'Last time this version became the published one. Set by the triggers, with clock_timestamp() so two publishes in one transaction keep their order.';

-- History starts now: versions published before this migration count from
-- their creation.
update public.prompt_library set published_at = created_at where status = 'published';

create or replace function private.prepare_prompt_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  names text[] := private.prompt_placeholders(new.template);
  next_version integer;
begin
  -- The same rules as the editor, for anyone writing through the API.
  if strpos(regexp_replace(new.template, '\{\{.*?\}\}', '', 'g'), '{{') > 0 then
    raise exception 'the prompt template has a "{{" that is never closed' using errcode = '23514';
  end if;
  if not to_jsonb(names) <@ private.known_prompt_variables() then
    raise exception 'the prompt template uses an unknown variable' using errcode = '23514';
  end if;
  new.variables := to_jsonb(names);

  perform private.lock_prompt_template(new.workspace_id, new.template_key);
  if new.workspace_id is null then
    select coalesce(max(p.version), 0) + 1 into next_version
    from public.prompt_library p
    where p.workspace_id is null and p.template_key = new.template_key;
  else
    select coalesce(max(p.version), 0) + 1 into next_version
    from public.prompt_library p
    where p.workspace_id = new.workspace_id and p.template_key = new.template_key;
  end if;
  -- The app says which version it adds, so two saves from the same version,
  -- or two new templates given the same key, fail instead of silently
  -- becoming versions of each other.
  if new.version is null then
    new.version := next_version;
  elsif new.version <> next_version then
    raise exception 'version % of this prompt template is not the next one', new.version
      using errcode = '23505';
  end if;
  if new.version > 1 and coalesce(btrim(new.changelog), '') = '' then
    raise exception 'a new version of a prompt template needs a changelog' using errcode = '23514';
  end if;

  -- Null in migrations, which add the global templates.
  new.created_by := (select auth.uid());
  new.published_at := null;
  if new.status = 'published' then
    perform private.archive_published_prompt(new.workspace_id, new.template_key, null);
    new.published_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function private.update_prompt_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A saved version never changes, migrations and the service role included.
  -- Only its status moves, and created_by becomes null when the author's
  -- profile goes (on delete set null).
  if (new.id, new.workspace_id, new.template_key, new.version, new.title, new.description, new.template,
      new.variables, new.changelog, new.output_schema, new.model_tier, new.temperature,
      new.max_output_tokens, new.created_at)
     is distinct from
     (old.id, old.workspace_id, old.template_key, old.version, old.title, old.description, old.template,
      old.variables, old.changelog, old.output_schema, old.model_tier, old.temperature,
      old.max_output_tokens, old.created_at)
     or (new.created_by is distinct from old.created_by and new.created_by is not null) then
    raise exception 'a saved prompt version cannot change' using errcode = '42501';
  end if;
  if new.status = 'draft' and old.status <> 'draft' then
    raise exception 'a prompt version cannot go back to draft' using errcode = '22023';
  end if;
  new.published_at := old.published_at;
  if new.status = 'published' and old.status <> 'published' then
    perform private.lock_prompt_template(new.workspace_id, new.template_key);
    perform private.archive_published_prompt(new.workspace_id, new.template_key, new.id);
    new.published_at := clock_timestamp();
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- prompt_rollouts
-- -----------------------------------------------------------------------------
create table public.prompt_rollouts (
  id                   uuid primary key default gen_random_uuid(),
  -- The template's workspace, null for a global template.
  workspace_id         uuid references public.workspaces (id) on delete cascade,
  template_key         text not null,
  -- A draft version of the template, served instead of the published one.
  candidate_id         uuid not null references public.prompt_library (id) on delete cascade,
  -- The published version when the rollout started.
  base_id              uuid references public.prompt_library (id) on delete set null,
  -- Share of the generations, bucketed by section, that get the candidate.
  percent              smallint not null check (percent between 1 and 100),
  -- Global templates only: the one workspace the rollout is limited to.
  target_workspace_id  uuid references public.workspaces (id) on delete cascade,
  status               text not null default 'active' check (status in ('active', 'promoted', 'cancelled')),
  created_by           uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  ended_at             timestamptz,
  updated_at           timestamptz not null default now(),
  check (target_workspace_id is null or workspace_id is null),
  check ((status = 'active') = (ended_at is null))
);

comment on table public.prompt_rollouts is
  'Progressive rollouts of a draft prompt version (Story KRB-17). Written through functions only.';

create unique index prompt_rollouts_one_active
  on public.prompt_rollouts (workspace_id, template_key) nulls not distinct where status = 'active';
create index prompt_rollouts_candidate_idx on public.prompt_rollouts (candidate_id);

create trigger set_updated_at before update on public.prompt_rollouts
  for each row execute function private.set_updated_at();

-- A rollout serves a draft of its own template, measured against a version
-- of the same template. Global rollouts are written by hand with the service
-- role, so the table checks this itself.
create or replace function private.check_prompt_rollout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.prompt_library;
begin
  select * into candidate from public.prompt_library p where p.id = new.candidate_id;
  if candidate.workspace_id is distinct from new.workspace_id or candidate.template_key <> new.template_key then
    raise exception 'The candidate is not a version of this template' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and candidate.status <> 'draft' then
    raise exception 'Seul un brouillon se déploie progressivement' using errcode = 'KR011';
  end if;
  if new.base_id is not null and not exists (
    select 1 from public.prompt_library p
    where p.id = new.base_id
      and p.workspace_id is not distinct from new.workspace_id
      and p.template_key = new.template_key
  ) then
    raise exception 'The base is not a version of this template' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger check_prompt_rollout
  before insert or update of workspace_id, template_key, candidate_id, base_id on public.prompt_rollouts
  for each row execute function private.check_prompt_rollout();

alter table public.prompt_rollouts enable row level security;

-- Members see the rollouts of their workspace templates, and the global
-- ones that reach them.
create policy "prompt_rollouts: members read"
  on public.prompt_rollouts for select to authenticated
  using (
    (workspace_id is not null and private.is_workspace_member(workspace_id))
    or (workspace_id is null and (target_workspace_id is null or private.is_workspace_member(target_workspace_id)))
  );

revoke all on public.prompt_rollouts from anon, authenticated;
grant select on public.prompt_rollouts to authenticated;

-- A rollout ends with its candidate: publishing it by any path promotes the
-- rollout, archiving it cancels the rollout. Publishing another version of
-- the template (directly, or by a rollback) cancels the rollout too: its
-- candidate was measured against a version that is no longer live.
create or replace function private.end_rollouts_of_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'published' then
    update public.prompt_rollouts r
    set status = case when r.candidate_id = new.id then 'promoted' else 'cancelled' end,
        ended_at = now()
    where r.workspace_id is not distinct from new.workspace_id
      and r.template_key = new.template_key
      and r.status = 'active';
  elsif new.status = 'archived' then
    update public.prompt_rollouts r
    set status = 'cancelled', ended_at = now()
    where r.candidate_id = new.id and r.status = 'active';
  end if;
  return new;
end;
$$;

create trigger end_rollouts_of_version
  after insert or update of status on public.prompt_library
  for each row execute function private.end_rollouts_of_version();

-- Locks a rollout and checks the caller manages its workspace template.
create or replace function private.lock_rollout(rollout uuid)
returns public.prompt_rollouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_rollout public.prompt_rollouts;
begin
  select * into found_rollout from public.prompt_rollouts r where r.id = rollout for update;
  if not found then
    raise exception 'Déploiement introuvable' using errcode = 'P0002';
  end if;
  if found_rollout.workspace_id is null or not private.is_workspace_manager(found_rollout.workspace_id) then
    raise exception 'Seuls les propriétaires et administrateurs gèrent les déploiements' using errcode = '42501';
  end if;
  if found_rollout.status <> 'active' then
    raise exception 'Ce déploiement est terminé' using errcode = 'KR010';
  end if;
  return found_rollout;
end;
$$;

-- Starts serving a draft version to `percent` % of the generations of its
-- workspace template. Returns the rollout id.
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

create or replace function public.set_prompt_rollout_percent(p_rollout_id uuid, p_percent smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lock_rollout(p_rollout_id);
  if p_percent is null or p_percent not between 1 and 99 then
    raise exception 'Le pourcentage va de 1 à 99' using errcode = '22023';
  end if;
  update public.prompt_rollouts r set percent = p_percent where r.id = p_rollout_id;
end;
$$;

-- Publishes the candidate for everyone (p_promote) or stops the rollout and
-- leaves the candidate as a draft.
create or replace function public.end_prompt_rollout(p_rollout_id uuid, p_promote boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rollout public.prompt_rollouts;
begin
  rollout := private.lock_rollout(p_rollout_id);
  if p_promote then
    -- The status trigger archives the published version and promotes the rollout.
    update public.prompt_library p set status = 'published' where p.id = rollout.candidate_id;
  else
    update public.prompt_rollouts r set status = 'cancelled', ended_at = now() where r.id = rollout.id;
  end if;
end;
$$;

-- Puts back the version published before `p_version_id`, the published
-- version of a workspace template. Returns the version now published.
create or replace function public.rollback_prompt_publish(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version public.prompt_library;
  previous uuid;
begin
  select * into current_version from public.prompt_library p where p.id = p_version_id;
  if not found then
    raise exception 'Version introuvable' using errcode = 'P0002';
  end if;
  if current_version.workspace_id is null or not private.is_workspace_manager(current_version.workspace_id) then
    raise exception 'Seuls les propriétaires et administrateurs reviennent à une version' using errcode = '42501';
  end if;
  perform private.lock_prompt_template(current_version.workspace_id, current_version.template_key);
  -- Another rollback or publish may have finished while this call waited for
  -- the lock: check the version as it is now.
  select * into current_version from public.prompt_library p where p.id = p_version_id for update;
  if current_version.status <> 'published' then
    raise exception 'Seule la version publiée peut revenir à la précédente' using errcode = 'KR012';
  end if;

  select p.id into previous
  from public.prompt_library p
  where p.workspace_id = current_version.workspace_id
    and p.template_key = current_version.template_key
    and p.status = 'archived'
    and p.published_at is not null
    and p.published_at < current_version.published_at
  order by p.published_at desc
  limit 1;
  if previous is null then
    raise exception 'Aucune version publiée avant celle-ci' using errcode = 'KR013';
  end if;

  update public.prompt_library p set status = 'published' where p.id = previous;
  return previous;
end;
$$;

revoke all on function private.end_rollouts_of_version() from public, anon;
revoke all on function private.check_prompt_rollout() from public, anon;
revoke all on function private.lock_rollout(uuid) from public, anon;
revoke all on function public.start_prompt_rollout(uuid, smallint) from public, anon;
revoke all on function public.set_prompt_rollout_percent(uuid, smallint) from public, anon;
revoke all on function public.end_prompt_rollout(uuid, boolean) from public, anon;
revoke all on function public.rollback_prompt_publish(uuid) from public, anon;
grant execute on function public.start_prompt_rollout(uuid, smallint) to authenticated;
grant execute on function public.set_prompt_rollout_percent(uuid, smallint) to authenticated;
grant execute on function public.end_prompt_rollout(uuid, boolean) to authenticated;
grant execute on function public.rollback_prompt_publish(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Generations: rollout and trace
-- -----------------------------------------------------------------------------
alter table public.ai_generations
  add column rollout_id uuid references public.prompt_rollouts (id) on delete set null,
  add column trace_id text check (trace_id ~ '^[0-9a-f]{32}$');

create index ai_generations_rollout_idx on public.ai_generations (rollout_id);
-- The daily cost alert sums the whole environment's day.
create index ai_generations_created_idx on public.ai_generations (created_at);

-- The same checks as before, and a draft version is accepted when it is the
-- candidate of an active rollout that reaches this workspace. Which sections
-- get the candidate is the app's choice (a stable hash of the section).
drop function public.start_ai_generation(
  uuid, uuid, uuid, uuid, text, smallint, text, text, jsonb, integer, integer, bigint
);

create function public.start_ai_generation(
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

  -- The hashes and the context are recorded when the generation ends.
  insert into public.ai_generations (
    workspace_id, section_id, requested_by, prompt_version_id, rollout_id, output_schema, schema_version,
    provider, model, params, estimated_tokens
  ) values (
    p_workspace_id, p_section_id, p_user_id, p_prompt_version_id, p_rollout_id, p_output_schema, p_schema_version,
    p_provider, p_model, coalesce(p_params, '{}'), p_estimated_tokens
  )
  returning id into new_id;

  return query select new_id, null::text, null::integer;
end;
$$;

revoke all on function public.start_ai_generation(
  uuid, uuid, uuid, uuid, text, smallint, text, text, jsonb, integer, integer, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.start_ai_generation(
  uuid, uuid, uuid, uuid, text, smallint, text, text, jsonb, integer, integer, bigint, uuid
) to service_role;

-- -----------------------------------------------------------------------------
-- Dashboard figures per prompt version
-- -----------------------------------------------------------------------------
-- Runs with the caller's rights (RLS on ai_generations and prompt_library):
-- managers get their whole workspace. Acceptance counts decided drafts only,
-- and the edit ratio is words changed over words proposed, on accepted ones.
create or replace function public.ai_prompt_metrics(p_workspace_id uuid, p_since timestamptz)
returns table (
  prompt_version_id uuid,
  template_key      text,
  version           integer,
  title             text,
  prompt_scope      text,
  model             text,
  generations       bigint,
  succeeded         bigint,
  failed            bigint,
  failure_rate      numeric,
  accepted          bigint,
  discarded         bigint,
  acceptance_rate   numeric,
  rated             bigint,
  mean_rating       numeric,
  mean_edit_ratio   numeric,
  input_tokens      bigint,
  output_tokens     bigint,
  total_tokens      bigint,
  cost              numeric,
  p50_latency_ms    integer,
  p95_latency_ms    integer,
  from_rollout      bigint,
  last_generation   timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    g.prompt_version_id,
    p.template_key,
    p.version,
    p.title,
    case when p.workspace_id is null then 'global' else 'workspace' end,
    g.model,
    count(*),
    count(*) filter (where g.status = 'succeeded'),
    count(*) filter (where g.status = 'failed'),
    round(count(*) filter (where g.status = 'failed')::numeric
      / nullif(count(*) filter (where g.status <> 'running'), 0), 4),
    count(*) filter (where g.accepted),
    count(*) filter (where g.accepted = false),
    round(count(*) filter (where g.accepted)::numeric / nullif(count(g.accepted), 0), 4),
    count(g.user_rating),
    round(avg(g.user_rating), 4),
    round(avg(g.edit_distance::numeric / nullif(g.draft_words, 0)) filter (where g.accepted), 4),
    coalesce(sum(g.input_tokens), 0)::bigint,
    coalesce(sum(g.output_tokens), 0)::bigint,
    coalesce(sum(g.total_tokens), 0)::bigint,
    sum(g.cost_estimate),
    (percentile_cont(0.5) within group (order by g.latency_ms) filter (where g.status = 'succeeded'))::integer,
    (percentile_cont(0.95) within group (order by g.latency_ms) filter (where g.status = 'succeeded'))::integer,
    count(g.rollout_id),
    max(g.created_at)
  from public.ai_generations g
  left join public.prompt_library p on p.id = g.prompt_version_id
  where g.workspace_id = p_workspace_id
    and g.created_at >= coalesce(p_since, '-infinity'::timestamptz)
  group by g.prompt_version_id, p.template_key, p.version, p.title, p.workspace_id, g.model
  order by max(g.created_at) desc;
$$;

revoke all on function public.ai_prompt_metrics(uuid, timestamptz) from public, anon;
grant execute on function public.ai_prompt_metrics(uuid, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Daily cost alert
-- -----------------------------------------------------------------------------
-- Not tenant data: one row per day (UTC) the environment's estimated spend
-- passed the threshold. Only the service role reads or writes it.
create table public.ai_cost_alerts (
  day           date primary key,
  total_usd     numeric(12, 6) not null check (total_usd >= 0),
  threshold_usd numeric(12, 6) not null check (threshold_usd >= 0),
  created_at    timestamptz not null default now()
);

alter table public.ai_cost_alerts enable row level security;
revoke all on public.ai_cost_alerts from anon, authenticated;

-- Today's estimated spend of the whole environment when it passed
-- p_threshold and no alert went out yet today, else null. The caller sends
-- the alert: the row it adds keeps the others from sending it again.
create or replace function public.claim_ai_cost_alert(p_threshold numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  spent numeric;
begin
  select coalesce(sum(g.cost_estimate), 0) into spent
  from public.ai_generations g
  where g.created_at >= today::timestamp at time zone 'utc';
  if spent <= p_threshold then
    return null;
  end if;
  insert into public.ai_cost_alerts (day, total_usd, threshold_usd)
  values (today, spent, p_threshold)
  on conflict (day) do nothing;
  return case when found then spent else null end;
end;
$$;

revoke all on function public.claim_ai_cost_alert(numeric) from public, anon, authenticated;
grant execute on function public.claim_ai_cost_alert(numeric) to service_role;

-- Gives today back when the alert e-mail could not be sent, so the next
-- generation tries again.
create or replace function public.release_ai_cost_alert()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.ai_cost_alerts where day = (now() at time zone 'utc')::date;
$$;

revoke all on function public.release_ai_cost_alert() from public, anon, authenticated;
grant execute on function public.release_ai_cost_alert() to service_role;
