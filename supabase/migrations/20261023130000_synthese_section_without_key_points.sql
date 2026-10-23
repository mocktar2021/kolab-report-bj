-- =============================================================================
-- KolabReport: section drafts without a key points list (Jira KRB-224)
--
-- A section draft had a summary, a key points list and a body. The body
-- explained the key points, so the three said the same findings: on the full
-- eval runs, seven of the nine drafts that scored 3/5 on structure did. The
-- section_draft schema drops the key points (src/lib/ai/schemas.ts): a
-- section is now a short summary and a body with its subheadings, as in an
-- expert report. This version stops naming the key points.
--
-- A saved version never changes, so the template gets a new published
-- version, as the app publishes one: the trigger numbers it (version 3) and
-- archives version 2, and an active rollout of the template ends. The title,
-- description, variables, schema, tier, temperature and output cap are those
-- of version 2. The evals read the latest insert of each template_key, so
-- they pick this row up.
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
Le résumé dit l'essentiel en deux ou trois phrases. Le corps développe les constats avec leurs chiffres, sans redire le résumé.
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
  'Plus de liste de points clés : un résumé de deux ou trois phrases, puis le corps avec ses intertitres. Les réglages ne changent pas.'
);
