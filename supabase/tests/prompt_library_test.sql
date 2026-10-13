begin;
\ir fixtures.psql
select plan(32);

-- Seeded global templates (migration 20261013210100) ---------------------------
select is(
  (select count(*)::int from public.prompt_library
   where workspace_id is null and status = 'published' and created_by is null
     and template_key in ('synthese-section', 'resume-executif', 'recommandations', 'analyse-donnees')),
  4, 'the four global templates are published, with no author');
select is(
  (select variables from public.prompt_library where workspace_id is null and template_key = 'synthese-section'),
  '["report_title", "report_context", "section_title", "section_instructions", "deliverables"]'::jsonb,
  'a global template lists the variables it uses');

-- Reading ---------------------------------------------------------------------
select pg_temp.act_as('expert');
select set_eq('select template_key from public.prompt_library where workspace_id is not null', array['modele-a'],
  'expert sees the templates of w1 only');
select ok(exists (select 1 from public.prompt_library where id = pg_temp.id('p_global')), 'expert sees global templates');

select pg_temp.act_as('outsider');
select set_eq('select template_key from public.prompt_library where workspace_id is not null', array['modele-b'],
  'outsider sees the templates of w2 only');

-- Versions: numbered, signed, one published -----------------------------------
select pg_temp.act_as('admin');
select lives_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, changelog)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'Version deux', 'Plus court')$$, 'admin adds a version');
select is((select version from public.prompt_library where workspace_id = pg_temp.id('w1') and template_key = 'modele-a' and status = 'published'),
  2, 'the new version is numbered 2 and published');
select is((select status::text from public.prompt_library where id = pg_temp.id('p_w1')), 'archived',
  'publishing version 2 archives version 1');
select is((select created_by from public.prompt_library where workspace_id = pg_temp.id('w1') and template_key = 'modele-a' and version = 2),
  pg_temp.id('admin'), 'the trigger signs the version with its author');

select lives_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, status, changelog)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'Version trois', 'draft', 'Essai')$$, 'admin saves a draft');
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

select lives_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'autre-modele', 'Autre', 'x')$$, 'admin creates another template');
select is((select version from public.prompt_library where workspace_id = pg_temp.id('w1') and template_key = 'autre-modele'),
  1, 'a new template starts at version 1');

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
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, version)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'x', 42)$$, '42501', null, 'admin cannot choose a version number');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, created_by)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'x', pg_temp.id('owner'))$$, '42501', null, 'admin cannot sign as someone else');
select throws_ok($$delete from public.prompt_library where id = pg_temp.id('p_w1')$$,
  '42501', null, 'nobody deletes a version');

-- Global templates and other workspaces stay out of reach ----------------------
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (null, 'pirate', 'Global pirate', 'x')$$, '42501', null, 'admin cannot add a global template');
select is(pg_temp.affected($$update public.prompt_library set status = 'archived' where id = pg_temp.id('p_global')$$), 0,
  'admin cannot archive a global template');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w2'), 'pirate', 'Pirate', 'x')$$, '42501', null, 'admin cannot add a template to w2');

select pg_temp.act_as('expert');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'modele-a', 'Expert', 'x')$$, '42501', null, 'expert cannot add a version');
select is(pg_temp.affected($$update public.prompt_library set status = 'published' where workspace_id = pg_temp.id('w1')$$), 0,
  'expert cannot publish or archive');

-- The database checks what the editor checks -----------------------------------
select pg_temp.act_as('admin');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, variables)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', '{{client}}', '["client"]')$$, '23514', null, 'an unknown variable is refused');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, output_schema)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'x', 'poeme')$$, '23514', null, 'an unknown output schema is refused');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template)
  values (pg_temp.id('w1'), 'Pas Une Cle', 'Modele', 'x')$$, '23514', null, 'a key must be lowercase words and dashes');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, temperature)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'x', 1.5)$$, '23514', null, 'temperature stays between 0 and 1');
select throws_ok($$insert into public.prompt_library (workspace_id, template_key, title, template, model_tier)
  values (pg_temp.id('w1'), 'modele-a', 'Modele A', 'x', 'gpt-9')$$, '23514', null, 'model tier is standard or fast');

select * from finish();
rollback;
