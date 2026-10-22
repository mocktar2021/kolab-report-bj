-- =============================================================================
-- KolabReport: structure and length of the section template (Jira KRB-224)
--
-- On the eval runs the judge gives synthese-section drafts 3/5 on structure,
-- for the same reasons each night: the summary, the key points and the body
-- say the same findings three times, recommendations come in sections that
-- did not ask for any, and the drafts run two to five times longer than the
-- reference sections (140 to 300 words). Version 1 says nothing about any of
-- this. Version 2 says it: each finding once, recommendations only when the
-- section instructions ask for them, 200 to 500 words, and a missing piece of
-- information stated in one sentence instead of a "Limites" part.
--
-- A saved version never changes, so the template gets a new published
-- version, as the app publishes one: the trigger numbers it (version 2) and
-- archives version 1, and an active rollout of the template ends. The title,
-- description, variables, schema, tier, temperature and output cap are
-- those of version 1. The evals read the latest insert of each
-- template_key, so they pick this row up.
-- =============================================================================

insert into public.prompt_library
  (workspace_id, template_key, title, description, template, variables, output_schema,
   model_tier, temperature, max_output_tokens, status, changelog)
values
(
  null,
  'synthese-section',
  'Rédaction de section',
  'Rédige le brouillon d''une section à partir de ses consignes et de ses livrables.',
  $tpl$Tu rédiges une section d'un rapport d'expertise, en français.

Rapport : {{report_title}}
Contexte du rapport : {{report_context}}
Section à rédiger : {{section_title}}
Consignes de la section : {{section_instructions}}

Livrables fournis par l'équipe :
{{deliverables}}

Rédige la section en Markdown, avec des intertitres si le contenu le demande.
Dis chaque constat une seule fois : le résumé donne l'essentiel, les points clés listent les constats principaux, et le corps les explique et les chiffre sans les recopier.
Ne propose de recommandations que si les consignes de la section en demandent.
Vise 200 à 500 mots en tout, sauf si les consignes demandent plus de détail.
Appuie chaque constat sur les livrables et cite le fichier d'où il vient.
N'invente aucun chiffre, aucune date ni aucun nom qui ne figure pas dans les livrables. Quand une information manque, dis-le en une phrase, là où elle manque.
Garde un ton professionnel et précis, sans formules creuses.$tpl$,
  '["report_title", "report_context", "section_title", "section_instructions", "deliverables"]',
  'section_draft',
  'standard',
  0.30,
  4096,
  'published',
  'Chaque constat n''est dit qu''une fois, les recommandations ne viennent que si la section en demande, et la section vise 200 à 500 mots. Les réglages ne changent pas.'
);
