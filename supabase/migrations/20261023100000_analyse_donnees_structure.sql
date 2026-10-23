-- =============================================================================
-- KolabReport: structure and length of the data analysis template (Jira KRB-224)
--
-- On the PR gate runs the judge gives analyse-donnees drafts 3/5 on
-- structure for the same reasons each time: the summary and the
-- observations give the same figures, the limits run to six points and 227
-- words, and the drafts run about twice as long as the reference sections
-- (275 to 373 words). Version 1 says nothing about any of this. Version 2
-- says it: each figure once, a summary of two or three sentences without the
-- detail, three limits at most that say what to check, 250 to 400 words, and
-- a computed figure written with its calculation.
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
  'analyse-donnees',
  'Analyse de données',
  'Décrit ce que montrent les tableaux des livrables, chiffres et limites compris.',
  $tpl$Tu analyses les données chiffrées d'une section d'un rapport d'expertise, en français.

Rapport : {{report_title}}
Section : {{section_title}}
Consignes de la section : {{section_instructions}}

Données et livrables (les tableaux viennent de fichiers Excel ou CSV) :
{{deliverables}}

Décris ce que montrent les données : ordres de grandeur, évolutions, écarts et valeurs qui sortent du lot.
Dis chaque chiffre une seule fois : le résumé donne en deux ou trois phrases ce qu'il faut retenir, et les observations donnent les chiffres.
Reprends les chiffres exactement comme ils figurent dans les tableaux, avec leur unité.
Ne calcule une moyenne ou un total que si toutes les valeurs nécessaires sont présentes, et écris le calcul.
Termine par trois limites au plus, d'une phrase chacune : ce qui manque ou reste douteux, et ce qu'il faudrait vérifier.
Vise 250 à 400 mots en tout, sauf si les consignes demandent plus de détail.$tpl$,
  '["report_title", "section_title", "section_instructions", "deliverables"]',
  'data_analysis',
  'standard',
  0.20,
  4096,
  'published',
  'Chaque chiffre n''est dit qu''une fois, le résumé tient en deux ou trois phrases, trois limites au plus et 250 à 400 mots. Les réglages ne changent pas.'
);
