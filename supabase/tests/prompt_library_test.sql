begin;
\ir fixtures.psql
select plan(52);

-- Seeded global templates (migration 20261013210100) ---------------------------
select is(
  (select count(*)::int from public.prompt_library
   where workspace_id is null and status = 'published' and created_by is null
     and template_key in ('synthese-section', 'resume-executif', 'recommandations', 'analyse-donnees')),
  4, 'the four global templates are published, with no author');
select is(
  (select variables from public.prompt_library
   where workspace_id is null and template_key = 'synthese-section' and status = 'published'),
  '["report_title", "report_context", "section_title", "section_instructions", "deliverables"]'::jsonb,
  'a global template lists the variables it uses, in order');

-- Raised output caps (migration 20261015120000, KRB-184) ------------------------
select results_eq(
  $$select template_key, version, max_output_tokens from public.prompt_library
    where workspace_id is null and status = 'published'
      and template_key in ('synthese-section', 'resume-executif', 'recommandations', 'analyse-donnees')
    order by template_key$$,
  $$values ('analyse-donnees', 1, 4096), ('recommandations', 2, 4096), ('resume-executif', 2, 2048),
    ('synthese-section', 2, 4096)$$,
  'recommandations and resume-executif publish a version 2 with a higher output cap, synthese-section one with new text');
select results_eq(
  $$select template_key, status::text, max_output_tokens from public.prompt_library
    where workspace_id is null and version = 1 and template_key in ('resume-executif', 'recommandations')
    order by template_key$$,
  $$values ('recommandations', 'archived', 2048), ('resume-executif', 'archived', 1024)$$,
  'their version 1 is archived and keeps its cap');
select is(
  (select count(*)::int from public.prompt_library v1
   join public.prompt_library v2 on v2.workspace_id is null and v2.template_key = v1.template_key and v2.version = 2
   where v1.workspace_id is null and v1.version = 1 and v1.template_key in ('resume-executif', 'recommandations')
     and (v2.title, v2.description, v2.template, v2.variables, v2.output_schema, v2.model_tier, v2.temperature)
         = (v1.title, v1.description, v1.template, v1.variables, v1.output_schema, v1.model_tier, v1.temperature)
     and v2.published_at > v1.published_at
     and v2.created_by is null
     and v2.changelog is not null),
  2, 'version 2 keeps the text and settings of version 1 and was published after it');

-- Section template, structure and length (migration 20261022220000, KRB-224) ---
select is(
  (select status::text from public.prompt_library
   where workspace_id is null and template_key = 'synthese-section' and version = 1),
  'archived', 'version 1 of synthese-section is archived');
select is(
  (select count(*)::int from public.prompt_library v1
   join public.prompt_library v2 on v2.workspace_id is null and v2.template_key = v1.template_key and v2.version = 2
   where v1.workspace_id is null and v1.version = 1 and v1.template_key = 'synthese-section'
     and (v2.title, v2.description, v2.variables, v2.output_schema, v2.model_tier, v2.temperature,
          v2.max_output_tokens)
         = (v1.title, v1.description, v1.variables, v1.output_schema, v1.model_tier, v1.temperature,
            v1.max_output_tokens)
     and v2.template <> v1.template
     and v2.template like '%Vise 200 à 500 mots%'
     and v2.published_at > v1.published_at
     and v2.created_by is null
     and v2.changelog is not null),
  1, 'version 2 of synthese-section changes the text only and was published after version 1');

-- Reading ---------------------------------------------------------------------
select pg_temp.act_as('expert');
select set_eq('select template_key from public.prompt_library where workspace_id is not null', array['modele-a'],
  'expert sees the templates of w1 only');
select ok(exists (select 1 from public.prompt_library where id = pg_temp.id('p_global')), 'expert sees global templates');

select pg_temp.act_as('outsider');
select set_eq('select template_key from public.prompt_library where workspace_id is not null', array['modele-b'],
  'outsider sees the templates of w2 only');

select pg_temp.act_as('stranger');
select is((select count(*)::int from public.prompt_library where workspace_id is not null), 0,
  'a user with no workspace sees no workspace template');
select ok(exists (select 1 from public.prompt_library where id = pg_temp.id('p_global')), 'and still sees global templates');

-- Versions: numbered, checked, signed, one published ---------------------------
select pg_temp.act_as('admin');
select lives_ok($$insert into public.prompt_library (workspace_id, template_key, version, title, template, changelog)
  values (pg_temp.id('w1'), 'modele-a', 2, 'Modele A', 'Version deux pour {{ section_title }}', 'Plus court')$$,
  'admin adds version 2');
select is((select version from public.prompt_library where workspace_id = pg_temp.id('w1') and template_key = 'modele-a' and status = 'published'),
  2, 'version 2 is published');
select is((select status::text from public.prompt_library where id = pg_temp.id('p_w1')), 'archived',
  'publishing version 2 archives version 1');
select is((select created_by from public.prompt_library where workspace_id = pg_temp.id('w1') and template_key = 'modele-a' and version = 2),
  pg_temp.id('admin'), 'the trigger signs the version with its author');
select is((select variables from public.prompt_library where workspace_id = pg_temp.id('w1') and template_key = 'modele-a' and version = 2),
  '["section_title"]'::jsonb, 'the trigger reads the variables from the template');

select throws_ok($$insert into public.prompt_library (workspace_id, template_key, version, title, template, changelog)
  values (pg_temp.id('w1'), 'modele-a', 2, 'Modele A', 'Autre version deux', 'En parallele')$$,
  '23505', null, 'a second save made from version 1 is refused instead of becoming version 3');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, version, title, template)
  values (pg_temp.id('w1'), 'modele-a', 1, 'Nouveau modele', 'x')$$,
  '23505', null, 'a new template cannot take the key of an existing one');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'Sans note')$$,
  '23514', null, 'a version after the first needs a changelog');

select lives_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, status, changelog)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'Version trois', 'draft', 'Essai')$$,
  'admin saves a draft, numbered by the trigger');
select results_eq(
  $$select version, status::text from public.prompt_library where workspace_id = pg_temp.id('w1') and template_key = 'modele-a' order by version$$,
  $$values (1, 'archived'), (2, 'published'), (3, 'draft')$$,
  'a draft leaves the published version in place');

select is(pg_temp.affected($$update public.prompt_library set status = 'published' where id = pg_temp.id('p_w1')$$), 1,
  'admin publishes version 1 again');
select results_eq(
  $$select version, status::text from public.prompt_library where workspace_id = pg_temp.id('w1') and template_key = 'modele-a' order by version$$,
  $$values (1, 'published'), (2, 'archived'), (3, 'draft')$$,
  'publishing an older version archives the one published before');
select throws_ok($$update public.prompt_library set status = 'draft' where id = pg_temp.id('p_w1')$$,
  '22023', null, 'a version cannot go back to draft');

select results_eq(
  $$select template_key, version, status::text, state::text, version_count::int, latest_version
    from public.prompt_templates where workspace_id = pg_temp.id('w1')$$,
  $$values ('modele-a', 1, 'published', 'published', 3, 3)$$,
  'prompt_templates gives one row per template, its published version first');

select lives_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'autre-modele', 'Autre', 'x')$$, 'admin creates another template');
select is((select version from public.prompt_library where workspace_id = pg_temp.id('w1') and template_key = 'autre-modele'),
  1, 'a new template starts at version 1');
select is(pg_temp.affected($$update public.prompt_library set status = 'archived'
  where workspace_id = pg_temp.id('w1') and template_key = 'autre-modele'$$), 1, 'admin archives a template');
select results_eq(
  $$select state::text, version::int from public.prompt_templates
    where workspace_id = pg_temp.id('w1') and template_key = 'autre-modele'$$,
  $$values ('archived', 1)$$, 'a template with every version archived shows as archived');

select pg_temp.act_as('owner');
select lives_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, changelog)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'Version quatre', 'Par la proprietaire')$$, 'owner adds a version too');

select pg_temp.act_as('outsider');
select lives_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w2'), 'modele-a', 'Meme cle', 'x')$$, 'another workspace may reuse a key');
select is((select version from public.prompt_library where workspace_id = pg_temp.id('w2') and template_key = 'modele-a'),
  1, 'each workspace numbers its own versions');

-- A saved version never changes ------------------------------------------------
select pg_temp.act_as('admin');
select throws_ok($$update public.prompt_library set template = 'pirate' where id = pg_temp.id('p_w1')$$,
  '42501', null, 'admin cannot change the content of a version');
select throws_ok($$update public.prompt_library set version = 9 where id = pg_temp.id('p_w1')$$,
  '42501', null, 'admin cannot renumber a version');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, created_by)
  values (pg_temp.id('w1'), 'nouveau', 'Nouveau', 'x', pg_temp.id('owner'))$$, '42501', null, 'admin cannot sign as someone else');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, variables)
  values (pg_temp.id('w1'), 'nouveau', 'Nouveau', 'x', '["deliverables"]')$$, '42501', null, 'admin cannot set the variables');
select throws_ok($$delete from public.prompt_library where id = pg_temp.id('p_w1')$$,
  '42501', null, 'nobody deletes a version');
reset role;
select throws_ok($$update public.prompt_library set template = 'reecrit' where id = pg_temp.id('p_global')$$,
  '42501', null, 'not even a migration rewrites a saved version');

-- Global templates and other workspaces stay out of reach ----------------------
select pg_temp.act_as('admin');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (null, 'pirate', 'Global pirate', 'x')$$, '42501', null, 'admin cannot add a global template');
select is(pg_temp.affected($$update public.prompt_library set status = 'archived' where id = pg_temp.id('p_global')$$), 0,
  'admin cannot archive a global template');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w2'), 'pirate', 'Pirate', 'x')$$, '42501', null, 'admin cannot add a template to w2');

select pg_temp.act_as('expert');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, changelog)
  values (pg_temp.id('w1'), 'modele-a', 'Expert', 'x', 'Essai')$$, '42501', null, 'expert cannot add a version');
select is((select version from public.prompt_library where workspace_id = pg_temp.id('w1') and template_key = 'modele-a' and status = 'published'),
  4, 'and the refused insert archived nothing');
select is(pg_temp.affected($$update public.prompt_library set status = 'published' where workspace_id = pg_temp.id('w1')$$), 0,
  'expert cannot publish or archive');

select pg_temp.act_as('viewer');
select is(pg_temp.affected($$update public.prompt_library set status = 'archived' where workspace_id = pg_temp.id('w1')$$), 0,
  'viewer cannot publish or archive');

-- The database checks what the editor checks -----------------------------------
select pg_temp.act_as('admin');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'nouveau', 'Nouveau', 'Pour {{client}}')$$, '23514', null, 'an unknown variable is refused');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'nouveau', 'Nouveau', 'Pour {{section_title}} et {{report_title')$$, '23514', null,
  'braces that never close are refused');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, output_schema)
  values (pg_temp.id('w1'), 'nouveau', 'Nouveau', 'x', 'poeme')$$, '23514', null, 'an unknown output schema is refused');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'Pas Une Cle', 'Nouveau', 'x')$$, '23514', null, 'a key must be lowercase words and dashes');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, temperature)
  values (pg_temp.id('w1'), 'nouveau', 'Nouveau', 'x', 1.5)$$, '23514', null, 'temperature stays between 0 and 1');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, model_tier)
  values (pg_temp.id('w1'), 'nouveau', 'Nouveau', 'x', 'gpt-9')$$, '23514', null, 'model tier is standard or fast');

select * from finish();
rollback;
