-- =============================================================================
-- KolabReport: versioned prompt templates (Story KRB-15)
--
-- Each row is one version of a template, and a template is identified by
-- (workspace_id, template_key). A version's content never changes: editing a
-- template adds a version, numbered and signed by a trigger. Only its status
-- moves. One version per template is published, the one drafts use; the
-- others are drafts or archived, and any of them can be published again.
-- Global templates (workspace_id null) come from migrations only.
-- =============================================================================

create type public.prompt_status as enum ('draft', 'published', 'archived');

alter table public.prompt_library
  add column template_key text,
  add column status public.prompt_status not null default 'published',
  add column changelog text,
  add column output_schema text not null default 'section_draft',
  add column model_tier text not null default 'standard',
  add column temperature numeric(3, 2),
  add column max_output_tokens integer;

-- Rows from before versioning become one template each, keyed by their id.
update public.prompt_library
set
  template_key = 'modele-' || replace(id::text, '-', ''),
  status = case when is_active then 'published' else 'archived' end::public.prompt_status;

alter table public.prompt_library
  alter column template_key set not null,
  drop column is_active,
  drop column category,
  add constraint prompt_library_template_key_format
    check (char_length(template_key) <= 60 and template_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint prompt_library_template_length check (char_length(template) between 1 and 20000),
  add constraint prompt_library_description_length
    check (description is null or char_length(description) <= 500),
  add constraint prompt_library_changelog_length check (changelog is null or char_length(changelog) <= 500),
  -- Same lists as src/lib/prompts/catalog.ts.
  add constraint prompt_library_variables_known check (
    variables <@ '["section_title", "section_instructions", "report_title", "report_context", "deliverables", "workspace_name"]'::jsonb
  ),
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
comment on column public.prompt_library.output_schema is
  'Key of the structured output the draft generation asks for (src/lib/prompts/catalog.ts).';

create unique index prompt_library_one_published
  on public.prompt_library (workspace_id, template_key) nulls not distinct
  where status = 'published';

-- -----------------------------------------------------------------------------
-- Numbering, author and the single published version
-- -----------------------------------------------------------------------------
-- These run with the caller's rights: the archive of the previous published
-- version goes through the same RLS and column privileges as the caller's own
-- status change.

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

create or replace function private.prepare_prompt_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.lock_prompt_template(new.workspace_id, new.template_key);
  select coalesce(max(p.version), 0) + 1 into new.version
  from public.prompt_library p
  where p.workspace_id is not distinct from new.workspace_id
    and p.template_key = new.template_key;
  -- Null in migrations, which add the global templates.
  new.created_by := (select auth.uid());
  if new.status = 'published' then
    update public.prompt_library p
    set status = 'archived'
    where p.workspace_id is not distinct from new.workspace_id
      and p.template_key = new.template_key
      and p.status = 'published';
  end if;
  return new;
end;
$$;

create trigger prepare_prompt_version
  before insert on public.prompt_library
  for each row execute function private.prepare_prompt_version();

create or replace function private.publish_prompt_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and old.status <> 'published' then
    perform private.lock_prompt_template(new.workspace_id, new.template_key);
    update public.prompt_library p
    set status = 'archived'
    where p.workspace_id is not distinct from new.workspace_id
      and p.template_key = new.template_key
      and p.status = 'published'
      and p.id <> new.id;
  end if;
  return new;
end;
$$;

create trigger publish_prompt_version
  before update of status on public.prompt_library
  for each row execute function private.publish_prompt_version();

-- -----------------------------------------------------------------------------
-- Privileges: users add versions and move their status, nothing else
-- -----------------------------------------------------------------------------
-- No user deletes a version: archiving takes a template out of use and keeps
-- its history. Workspace deletion still removes its templates (cascade).
revoke insert, update, delete on public.prompt_library from authenticated;

grant insert (
  workspace_id, template_key, title, description, template, variables, status, changelog,
  output_schema, model_tier, temperature, max_output_tokens
) on public.prompt_library to authenticated;

grant update (status) on public.prompt_library to authenticated;

drop policy "prompt_library: managers delete workspace templates" on public.prompt_library;
