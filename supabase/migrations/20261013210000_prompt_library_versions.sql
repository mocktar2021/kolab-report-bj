-- =============================================================================
-- KolabReport: versioned prompt templates (Story KRB-15)
--
-- Each row is one version of a template, and a template is identified by
-- (workspace_id, template_key). A version's content never changes: editing a
-- template adds a version, numbered, checked and signed by a trigger. Only its
-- status moves. One version per template is published, the one drafts use;
-- the others are drafts or archived, and an archived one can be published
-- again. Global templates (workspace_id null) come from migrations only.
-- =============================================================================

create type public.prompt_status as enum ('draft', 'published', 'archived');

-- Same list as PROMPT_VARIABLES in src/lib/prompts/catalog.ts.
create or replace function private.known_prompt_variables()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '["section_title", "section_instructions", "report_title", "report_context", "deliverables", "workspace_name"]'::jsonb;
$$;

-- The names between {{ and }} in a template, in order of first use, read the
-- way checkTemplate reads them (src/lib/prompts/template.ts).
create or replace function private.prompt_placeholders(template text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(name order by first_seen), '{}')
  from (
    select btrim(found.match[1], E' \t\n\r') as name, min(found.position) as first_seen
    from regexp_matches(template, '\{\{(.*?)\}\}', 'g') with ordinality as found(match, position)
    group by 1
  ) placeholders;
$$;

alter table public.prompt_library
  add column template_key text,
  add column status public.prompt_status not null default 'published',
  add column changelog text,
  add column output_schema text not null default 'section_draft',
  add column model_tier text not null default 'standard',
  add column temperature numeric(3, 2),
  add column max_output_tokens integer;

-- Rows from before versioning become one template each, keyed by their id,
-- and are brought within the checks below.
update public.prompt_library
set
  template_key = 'modele-' || replace(id::text, '-', ''),
  status = case when is_active then 'published' else 'archived' end::public.prompt_status,
  template = case when btrim(template) = '' then '(vide)' else left(template, 20000) end,
  description = left(description, 500),
  variables = (
    select coalesce(jsonb_agg(variable), '[]'::jsonb)
    from jsonb_array_elements(variables) as variable
    where variable <@ private.known_prompt_variables()
  );

alter table public.prompt_library
  alter column template_key set not null,
  -- The trigger numbers a version unless the app says which one it adds.
  alter column version drop default,
  drop column is_active,
  drop column category,
  add constraint prompt_library_template_key_format
    check (char_length(template_key) <= 60 and template_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint prompt_library_template_length check (char_length(template) between 1 and 20000),
  add constraint prompt_library_description_length
    check (description is null or char_length(description) <= 500),
  add constraint prompt_library_changelog_length check (changelog is null or char_length(changelog) <= 500),
  add constraint prompt_library_variables_known check (variables <@ private.known_prompt_variables()),
  -- Same lists as src/lib/prompts/catalog.ts.
  add constraint prompt_library_output_schema_known
    check (output_schema in ('section_draft', 'executive_summary', 'recommendations', 'data_analysis')),
  add constraint prompt_library_model_tier_known check (model_tier in ('standard', 'fast')),
  add constraint prompt_library_temperature_range check (temperature is null or temperature between 0 and 1),
  add constraint prompt_library_max_output_tokens_range
    check (max_output_tokens is null or max_output_tokens between 256 and 8192),
  add constraint prompt_library_version_unique unique nulls not distinct (workspace_id, template_key, version);

comment on column public.prompt_library.template_key is
  'Identifies a template within its workspace (or among global templates). Versions share it.';
comment on column public.prompt_library.template is
  'Prompt body with {{variable}} placeholders. Never changes once saved.';
comment on column public.prompt_library.variables is
  'The variables the template uses, in order. Written by the trigger from the template.';
comment on column public.prompt_library.output_schema is
  'Key of the structured output the draft generation asks for (src/lib/prompts/catalog.ts).';

create unique index prompt_library_one_published
  on public.prompt_library (workspace_id, template_key) nulls not distinct
  where status = 'published';

-- -----------------------------------------------------------------------------
-- Checks, numbering, author and the single published version
-- -----------------------------------------------------------------------------
-- The triggers run with the caller's rights: archiving the version published
-- before goes through the same RLS and column privileges as the caller's own
-- status change, so it does nothing for someone who can't write the template.

-- Serializes writes to one template, so version numbers and publishing do not race.
create or replace function private.lock_prompt_template(ws uuid, template_key text)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(
    hashtextextended('prompt_library/' || coalesce(ws::text, 'global') || '/' || template_key, 0)
  );
$$;

-- Archives the published version of a template, except `keep`.
create or replace function private.archive_published_prompt(ws uuid, key text, keep uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if ws is null then
    update public.prompt_library p set status = 'archived'
    where p.workspace_id is null and p.template_key = key and p.status = 'published' and p.id is distinct from keep;
  else
    update public.prompt_library p set status = 'archived'
    where p.workspace_id = ws and p.template_key = key and p.status = 'published' and p.id is distinct from keep;
  end if;
end;
$$;

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
  if new.status = 'published' then
    perform private.archive_published_prompt(new.workspace_id, new.template_key, null);
  end if;
  return new;
end;
$$;

create trigger prepare_prompt_version
  before insert on public.prompt_library
  for each row execute function private.prepare_prompt_version();

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
  if new.status = 'published' and old.status <> 'published' then
    perform private.lock_prompt_template(new.workspace_id, new.template_key);
    perform private.archive_published_prompt(new.workspace_id, new.template_key, new.id);
  end if;
  return new;
end;
$$;

create trigger update_prompt_version
  before update on public.prompt_library
  for each row execute function private.update_prompt_version();

-- -----------------------------------------------------------------------------
-- One row per template, for the library
-- -----------------------------------------------------------------------------
-- The published version of each template, or its latest one when none is
-- published, with the number of versions and the template's state. RLS on
-- prompt_library applies (security_invoker).
create view public.prompt_templates
with (security_invoker = true)
as
select distinct on (p.workspace_id, p.template_key)
  p.id,
  p.workspace_id,
  p.template_key,
  p.version,
  p.status,
  p.title,
  p.description,
  p.output_schema,
  count(*) over template as version_count,
  max(p.version) over template as latest_version,
  case
    when p.status = 'published' then 'published'
    when bool_or(p.status = 'draft') over template then 'draft'
    else 'archived'
  end::public.prompt_status as state
from public.prompt_library p
window template as (partition by p.workspace_id, p.template_key)
order by p.workspace_id, p.template_key, p.status = 'published' desc, p.version desc;

-- -----------------------------------------------------------------------------
-- Privileges: users add versions and move their status, nothing else
-- -----------------------------------------------------------------------------
-- No user deletes a version: archiving takes a template out of use and keeps
-- its history. Workspace deletion still removes its templates (cascade).
revoke insert, update, delete on public.prompt_library from authenticated;

grant insert (
  workspace_id, template_key, version, title, description, template, status, changelog,
  output_schema, model_tier, temperature, max_output_tokens
) on public.prompt_library to authenticated;

grant update (status) on public.prompt_library to authenticated;

drop policy "prompt_library: managers delete workspace templates" on public.prompt_library;

revoke all on public.prompt_templates from anon, authenticated;
grant select on public.prompt_templates to authenticated;
