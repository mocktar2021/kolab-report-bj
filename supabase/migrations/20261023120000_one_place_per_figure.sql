-- =============================================================================
-- KolabReport: one place for each figure in the drafts (Jira KRB-224)
--
-- The full eval run on master after PR 110 passed every threshold but
-- structure (3.40, min 3.50). Nine drafts scored 3/5 for the same reason:
-- the summary, the key points and the body gave the same figures, even with
-- "say each finding once" in the template and in the final checks. The
-- model reads "once" as once per field. These versions say which field holds
-- the figures instead:
--   synthese-section: a summary without figures, a figure in each key point,
--     and a body with only what the key points don't say;
--   resume-executif: the figures in the summary, about 200 words, and key
--     points that say what to keep or decide without the summary's figures;
--   analyse-donnees: a summary without figures, one to three limits, and a
--     total or a mean with its calculation when every value is there.
--
-- A saved version never changes, so each template gets a new published
-- version, as the app publishes one: the trigger numbers it (version 3) and
-- archives version 2, and an active rollout of the template ends. The title,
-- description, variables, schema, tier, temperature and output cap are those
-- of version 2. The evals read the latest insert of each template_key, so
-- they pick these rows up.
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
Mets chaque chiffre à un seul endroit :
- le résumé dit l'essentiel en deux ou trois phrases, sans chiffre ;
- chaque point clé donne un constat principal avec son chiffre ;
- le corps n'apporte que ce que les points clés ne disent pas : le contexte, le détail par site, par période ou par poste, et les données qui manquent. Il ne redonne aucun chiffre des points clés, ni dans le texte ni dans un tableau.
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
  'Chaque chiffre est à un seul endroit : un résumé sans chiffre, un chiffre par point clé, et un corps qui n''apporte que ce que les points clés ne disent pas. Les réglages ne changent pas.'
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

Écris un résumé de 150 à 250 mots, autour de 200 : l'objet de l'expertise, les constats principaux avec leurs chiffres et ce qu'ils impliquent.
Ajoute ensuite trois à cinq points clés, d'une phrase courte chacun : ce que le lecteur doit retenir ou décider. Ils ne reprennent ni les phrases ni les chiffres du résumé.
Ne reprends que des faits présents dans le contenu fourni. Si un point important manque, signale-le.$tpl$,
  '["report_title", "report_context", "deliverables"]',
  'executive_summary',
  'standard',
  0.30,
  2048,
  'published',
  'Le résumé vise 200 mots et porte les chiffres. Les points clés disent ce qu''il faut retenir ou décider, sans reprendre le résumé. Les réglages ne changent pas.'
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
Le résumé dit en deux ou trois phrases ce qu'il faut retenir, sans aucun chiffre. Les chiffres sont dans les observations, chacun une seule fois.
Reprends les chiffres exactement comme ils figurent dans les tableaux, avec leur unité.
Décris chaque indicateur pour lui-même : ne rapproche pas deux colonnes, par exemple un effectif et un taux, si les livrables ne le font pas.
Quand un total ou une moyenne aide la lecture et que toutes les valeurs sont présentes, donne-le avec son calcul. S'il manque une valeur, ne le calcule pas et dis laquelle manque.
Termine par une à trois limites, pas plus, d'une phrase chacune : ce qui manque ou reste douteux, et ce qu'il faudrait vérifier.
Vise 250 à 400 mots en tout, sauf si les consignes demandent plus de détail.$tpl$,
  '["report_title", "section_title", "section_instructions", "deliverables"]',
  'data_analysis',
  'standard',
  0.20,
  4096,
  'published',
  'Un résumé sans chiffre, une à trois limites, et un total ou une moyenne avec son calcul quand toutes les valeurs sont là. Les réglages ne changent pas.'
);
