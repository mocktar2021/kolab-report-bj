-- =============================================================================
-- KolabReport: global prompt templates (Story KRB-15)
--
-- The templates every workspace starts with, read-only in the app. They
-- change only through a new migration, which adds a version: the trigger
-- numbers it and archives the one before.
-- =============================================================================

insert into public.prompt_library
  (workspace_id, template_key, title, description, template, variables, output_schema,
   model_tier, temperature, max_output_tokens, changelog)
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
Appuie chaque constat sur les livrables et cite le fichier d'où il vient.
N'invente aucun chiffre, aucune date ni aucun nom qui ne figure pas dans les livrables. Quand une information manque, dis-le clairement.
Garde un ton professionnel et précis, sans formules creuses.$tpl$,
  '["report_title", "report_context", "section_title", "section_instructions", "deliverables"]',
  'section_draft',
  'standard',
  0.30,
  4096,
  'Version initiale.'
),
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
  1024,
  'Version initiale.'
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
  2048,
  'Version initiale.'
),
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
Reprends les chiffres exactement comme ils figurent dans les tableaux, avec leur unité.
Ne calcule une moyenne ou un total que si toutes les valeurs nécessaires sont présentes, et dis comment tu l'as obtenu.
Termine par les limites des données : périodes manquantes, valeurs douteuses, sources à confirmer.$tpl$,
  '["report_title", "section_title", "section_instructions", "deliverables"]',
  'data_analysis',
  'standard',
  0.20,
  4096,
  'Version initiale.'
);
