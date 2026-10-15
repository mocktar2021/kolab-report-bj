-- =============================================================================
-- KolabReport: output caps of the global prompt templates (Jira KRB-184)
--
-- Drafts run without thinking, so max_output_tokens is all for the answer:
-- the JSON of the output schema, its sources and the French text. Two caps
-- were too tight for the longest answer the golden set accepts, estimated at
-- 3 characters per token (CHARS_PER_TOKEN):
--   recommandations: 1000 words, about 2120 tokens, cap from 2048 to 4096
--   resume-executif: 520 words, about 1020 tokens, cap from 1024 to 2048
-- On the eval runs, mixed-voirie-vierzon hit the 2048 cap twice and its JSON
-- was cut, on the first answer and on the repair. synthese-section (1100
-- words, about 2160 tokens) and analyse-donnees (1000 words, about 1960
-- tokens) keep 4096. evals/golden/cases.test.ts checks every cap against
-- 1.5 times its estimate.
--
-- A saved version never changes, so each template gets a new published
-- version, as the app publishes one: the trigger numbers it (version 2) and
-- archives version 1, and an active rollout of the template ends. The text,
-- title, schema, tier and temperature are those of version 1. The evals read
-- the latest insert of each template_key, so they pick these rows up.
-- =============================================================================

insert into public.prompt_library
  (workspace_id, template_key, title, description, template, variables, output_schema,
   model_tier, temperature, max_output_tokens, status, changelog)
values
(
  null,
  'resume-executif',
  'Résumé exécutif',
  'Résume le rapport pour un lecteur pressé : objet, constats principaux et points clés.',
  $tpl$Tu rédiges le résumé exécutif d'un rapport d'expertise, en français, pour un lecteur qui n'a que deux minutes.

Rapport : {{report_title}}
Contexte du rapport : {{report_context}}

Contenu dont tu disposes :
{{deliverables}}

Écris un résumé de 150 à 250 mots : l'objet de l'expertise, les constats principaux et ce qu'ils impliquent.
Ajoute ensuite trois à cinq points clés, d'une phrase chacun.
Ne reprends que des faits présents dans le contenu fourni. Si un point important manque, signale-le.$tpl$,
  '["report_title", "report_context", "deliverables"]',
  'executive_summary',
  'standard',
  0.30,
  2048,
  'published',
  'Longueur maximale portée de 1024 à 2048 jetons : un résumé long, avec ses points clés et ses sources, pouvait être coupé avant la fin. Le texte ne change pas.'
),
(
  null,
  'recommandations',
  'Recommandations',
  'Tire des constats de la section des recommandations classées par priorité.',
  $tpl$Tu formules les recommandations d'un rapport d'expertise, en français.

Rapport : {{report_title}}
Section : {{section_title}}
Consignes de la section : {{section_instructions}}

Constats et livrables :
{{deliverables}}

Propose des recommandations concrètes, chacune avec :
- un titre court ;
- le constat qui la justifie, et le livrable d'où il vient ;
- une priorité (haute, moyenne ou basse) et ce qui la motive.
Classe-les de la plus prioritaire à la moins prioritaire. Ne recommande rien qui ne découle pas des constats fournis.$tpl$,
  '["report_title", "section_title", "section_instructions", "deliverables"]',
  'recommendations',
  'standard',
  0.30,
  4096,
  'published',
  'Longueur maximale portée de 2048 à 4096 jetons : une réponse longue, avec sa structure et ses sources, était coupée avant la fin. Le texte ne change pas.'
);
