-- =============================================================================
-- KolabReport: demo data for local development and the e2e stack (KRB-45)
--
-- The Supabase CLI loads this file after the migrations on `supabase start`
-- with a new database and on every `supabase db reset`, CI included (see
-- [db.seed] in supabase/config.toml). It is local only. `supabase db push`
-- runs without --include-seed (npm run db:push and the deploy workflow), so
-- staging and production never get these accounts.
--
-- Demo accounts, all with the password Kolab-demo-2026:
--   awa.dossou@kolabreport.test          Awa Dossou          owner
--   koffi.agossou@kolabreport.test       Koffi Agossou       admin
--   rachida.yessoufou@kolabreport.test   Rachida Yessoufou   expert
--   sylvain.kouagou@kolabreport.test     Sylvain Kouagou     expert
--   prudence.ahouansou@kolabreport.test  Prudence Ahouansou  viewer
--
-- They share one organization, one workspace and one draft report with 8
-- sections: 2 completed, 2 in progress, 4 not started, 2 of them unassigned.
-- No deliverables (they need files in Storage) and no AI drafts.
--
-- Every row has a fixed id starting with 5eed0000, so it never collides with
-- the pgTAP fixture ids (00000000-0000-4000-...). Every insert skips rows that
-- already exist: running the file again changes nothing. It runs in one
-- transaction, so a failure leaves nothing behind.
--
-- Ids:
--   5eed0000-0000-4000-8000-0000000000NN  auth users (01 to 05)
--   5eed0000-0000-4000-8000-0000000001NN  their e-mail identities
--   5eed0000-0000-4000-8000-000000000201  organization
--   5eed0000-0000-4000-8000-000000000301  workspace
--   5eed0000-0000-4000-8000-000000000401  report
--   5eed0000-0000-4000-8000-0000000005NN  report sections (01 to 08)
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Users
-- -----------------------------------------------------------------------------
-- Same shape as a user GoTrue creates with a confirmed e-mail, so password
-- sign-in works. GoTrue reads the token columns as strings and fails on null,
-- hence the empty strings. The on_auth_user_created trigger adds the profile
-- with full_name from raw_user_meta_data.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('Kolab-demo-2026', extensions.gen_salt('bf', 10)), now(),
  '', '', '', '',
  '', '', '', '',
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name, 'email_verified', true),
  now(), now()
from (values
  ('5eed0000-0000-4000-8000-000000000001'::uuid, 'awa.dossou@kolabreport.test', 'Awa Dossou'),
  ('5eed0000-0000-4000-8000-000000000002'::uuid, 'koffi.agossou@kolabreport.test', 'Koffi Agossou'),
  ('5eed0000-0000-4000-8000-000000000003'::uuid, 'rachida.yessoufou@kolabreport.test', 'Rachida Yessoufou'),
  ('5eed0000-0000-4000-8000-000000000004'::uuid, 'sylvain.kouagou@kolabreport.test', 'Sylvain Kouagou'),
  ('5eed0000-0000-4000-8000-000000000005'::uuid, 'prudence.ahouansou@kolabreport.test', 'Prudence Ahouansou')
) as u (id, email, full_name)
on conflict (id) do nothing;

-- GoTrue signs in with an e-mail identity, not with auth.users alone.
insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
select
  i.id, u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  now(), now()
from (values
  ('5eed0000-0000-4000-8000-000000000101'::uuid, '5eed0000-0000-4000-8000-000000000001'::uuid),
  ('5eed0000-0000-4000-8000-000000000102'::uuid, '5eed0000-0000-4000-8000-000000000002'::uuid),
  ('5eed0000-0000-4000-8000-000000000103'::uuid, '5eed0000-0000-4000-8000-000000000003'::uuid),
  ('5eed0000-0000-4000-8000-000000000104'::uuid, '5eed0000-0000-4000-8000-000000000004'::uuid),
  ('5eed0000-0000-4000-8000-000000000105'::uuid, '5eed0000-0000-4000-8000-000000000005'::uuid)
) as i (id, user_id)
join auth.users u on u.id = i.user_id
on conflict (provider_id, provider) do nothing;

-- -----------------------------------------------------------------------------
-- Organization, workspace and members
-- -----------------------------------------------------------------------------
insert into public.organizations (id, name, slug, owner_id)
values (
  '5eed0000-0000-4000-8000-000000000201', 'Cabinet Sèdo Conseil', 'cabinet-sedo-conseil',
  '5eed0000-0000-4000-8000-000000000001'
)
on conflict (id) do nothing;

-- The on_workspace_created trigger makes Awa Dossou the owner.
insert into public.workspaces (id, organization_id, name, description, created_by)
values (
  '5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000201',
  'Eau potable Atacora',
  'Évaluation à mi-parcours du projet d''accès à l''eau potable en milieu rural dans quatre communes de l''Atacora.',
  '5eed0000-0000-4000-8000-000000000001'
)
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role, invited_by)
values
  ('5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000002', 'admin', '5eed0000-0000-4000-8000-000000000001'),
  ('5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000003', 'expert', '5eed0000-0000-4000-8000-000000000001'),
  ('5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000004', 'expert', '5eed0000-0000-4000-8000-000000000002'),
  ('5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000005', 'viewer', '5eed0000-0000-4000-8000-000000000001')
on conflict (workspace_id, user_id) do nothing;

-- -----------------------------------------------------------------------------
-- Report
-- -----------------------------------------------------------------------------
-- The due date is relative so the demo report is never overdue.
insert into public.reports (id, workspace_id, title, description, status, due_date, created_by)
values (
  '5eed0000-0000-4000-8000-000000000401', '5eed0000-0000-4000-8000-000000000301',
  'Rapport d''évaluation à mi-parcours',
  'Évaluation à mi-parcours (2024-2027) du projet d''accès à l''eau potable en milieu rural à Boukoumbé, Natitingou, Tanguiéta et Toucountouna. Mission de terrain du 7 au 25 septembre 2026.',
  'draft', current_date + 42,
  '5eed0000-0000-4000-8000-000000000001'
)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Sections
-- -----------------------------------------------------------------------------
-- Inserted after the members: the check_assignee trigger only accepts an
-- owner, admin or expert of the workspace. sync_completed_at fills
-- completed_at for the completed ones. Weights add up to 12.5, so the report
-- shows 40 % done (completed counts 1, in progress 0.5).
insert into public.report_sections
  (id, workspace_id, report_id, position, title, status, weight, assigned_to, instructions, content)
values
(
  '5eed0000-0000-4000-8000-000000000501', '5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000401',
  0, 'Résumé exécutif', 'not_started', 1,
  '5eed0000-0000-4000-8000-000000000002',
  $$Une page au plus. Reprenez les principaux constats de chaque section, le taux d'avancement global du projet et les cinq recommandations prioritaires. À rédiger en dernier, une fois les autres sections terminées.$$,
  null
),
(
  '5eed0000-0000-4000-8000-000000000502', '5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000401',
  1, 'Contexte et justification', 'completed', 1,
  '5eed0000-0000-4000-8000-000000000003',
  $$Présentez la zone d'intervention, la situation de l'accès à l'eau avant le projet et les objectifs du projet. Citez vos sources (étude de référence, rapports des mairies). Deux pages au plus.$$,
  $$### Zone d'intervention

Le projet couvre quatre communes du département de l'Atacora : Boukoumbé, Natitingou, Tanguiéta et Toucountouna. La zone compte environ 400 000 habitants, dont près de 70 % en milieu rural.

Le relief de la chaîne de l'Atacora et le socle cristallin rendent la recherche d'eau souterraine difficile. Les forages y ont souvent un débit faible, et le taux d'échec à la foration dépasse 30 % dans certains villages.

### Situation de départ

L'étude de référence de 2024 donnait un taux de desserte en eau potable de 48 % en milieu rural. Dans les villages sans point d'eau moderne, les ménages puisent dans les marigots et les puits traditionnels, surtout en saison sèche, de novembre à avril. Les femmes et les enfants y passent en moyenne deux heures par jour.

Sur les 312 ouvrages recensés en 2024, 27 % étaient en panne depuis plus de trois mois, faute de pièces de rechange ou de comité de gestion actif.

### Objectifs du projet

Le projet, prévu de 2024 à 2027, doit :

- porter le taux de desserte rural à 70 % dans les quatre communes ;
- réaliser 120 forages équipés de pompes à motricité humaine et 18 adductions d'eau villageoises (AEV) ;
- remettre en service 60 ouvrages en panne ;
- installer et former un comité de gestion pour chaque point d'eau.
$$
),
(
  '5eed0000-0000-4000-8000-000000000503', '5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000401',
  2, 'Méthodologie de l''évaluation', 'completed', 1.5,
  '5eed0000-0000-4000-8000-000000000004',
  $$Décrivez la démarche : revue documentaire, choix des villages, outils de collecte, entretiens et limites de l'évaluation. Mettez la grille d'entretien en annexe.$$,
  $$L'évaluation suit les critères du CAD de l'OCDE : pertinence, cohérence, efficacité, efficience, impact et viabilité. Ce rapport à mi-parcours porte surtout sur l'efficacité et la viabilité des ouvrages déjà livrés.

### Démarche

La mission s'est déroulée du 7 au 25 septembre 2026, en trois temps :

1. revue documentaire : document de projet, rapports d'avancement semestriels, base de données des ouvrages tenue par l'unité de gestion du projet ;
2. collecte sur le terrain dans 36 villages tirés au sort, neuf par commune, en tenant compte de la taille et de l'éloignement ;
3. atelier de restitution à Natitingou avec les mairies, l'unité de gestion et les associations d'usagers.

### Outils de collecte

- Fiche d'inspection technique pour chaque ouvrage visité (142 ouvrages).
- Enquête auprès de 540 ménages, sur tablette avec KoboToolbox.
- 48 entretiens individuels : élus, agents des services techniques communaux, artisans réparateurs, fermiers des AEV.
- 12 groupes de discussion avec des femmes et des membres de comités de gestion.

### Limites

Les pluies de septembre ont coupé l'accès à six villages de Boukoumbé. La mission les a remplacés par des villages de taille proche dans la même commune.

Les débits cités viennent des fiches de réception des forages. La mission n'a pas refait d'essais de pompage.
$$
),
(
  '5eed0000-0000-4000-8000-000000000504', '5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000401',
  3, 'Résultats : accès à l''eau potable', 'in_progress', 3,
  '5eed0000-0000-4000-8000-000000000003',
  $$Comparez les réalisations aux cibles du cadre logique, commune par commune. Analysez la qualité des ouvrages : débits, qualité de l'eau, taux de panne. Appuyez-vous sur les fiches d'inspection et les résultats du laboratoire.$$,
  $$### Réalisations physiques

À mi-parcours, le projet a réalisé 74 forages équipés de pompes à motricité humaine sur les 120 prévus (62 %) et 9 AEV sur 18 (50 %).

| Commune | Forages prévus | Forages réalisés | AEV prévues | AEV réalisées |
| --- | ---: | ---: | ---: | ---: |
| Boukoumbé | 38 | 19 | 5 | 2 |
| Natitingou | 30 | 22 | 6 | 4 |
| Tanguiéta | 32 | 21 | 4 | 2 |
| Toucountouna | 20 | 12 | 3 | 1 |
| **Total** | **120** | **74** | **18** | **9** |

Boukoumbé a le plus de retard. Sur 31 forations, 12 ont donné un débit inférieur à 0,7 m³/h et ont été abandonnées, soit un taux d'échec de 39 %. L'entreprise de forage demande une étude géophysique complémentaire avant la deuxième campagne.

### Qualité de l'eau

_En attente des résultats du laboratoire pour les 40 prélèvements de septembre (fer, nitrates, fluor, analyse bactériologique)._

### Fonctionnement des ouvrages

À compléter avec les fiches d'inspection.
$$
),
(
  '5eed0000-0000-4000-8000-000000000505', '5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000401',
  4, 'Gestion des ouvrages et gouvernance locale', 'in_progress', 2,
  '5eed0000-0000-4000-8000-000000000004',
  $$Évaluez le modèle de gestion : comités de gestion des points d'eau, contrats d'affermage des AEV, recouvrement des redevances, rôle des mairies. Donnez le taux de comités actifs et le prix de l'eau pratiqué.$$,
  $$Le projet applique deux modèles de gestion : un comité de gestion par forage, et l'affermage à un opérateur privé pour les AEV.

### Comités de gestion des forages

Sur les 74 forages réalisés, 69 ont un comité de gestion installé et formé. Lors des visites, 51 comités étaient actifs : réunion tenue dans les trois derniers mois et cahier de caisse à jour. La bassine de 35 litres se vend de 10 à 25 FCFA selon les villages.

Le recouvrement baisse en saison des pluies, quand les ménages reviennent aux puits traditionnels. Plusieurs comités n'ont pas assez d'argent en caisse pour payer une réparation de pompe, qui coûte en moyenne 45 000 FCFA.

### Affermage des AEV

À rédiger après l'entretien avec les fermiers de Natitingou et de Tanguiéta.
$$
),
(
  '5eed0000-0000-4000-8000-000000000506', '5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000401',
  5, 'Hygiène et assainissement', 'not_started', 1.5,
  null,
  $$Présentez les résultats de la composante hygiène : villages certifiés FDAL (fin de la défécation à l'air libre), latrines construites, pratique du lavage des mains. Comparez avec l'étude de référence.$$,
  null
),
(
  '5eed0000-0000-4000-8000-000000000507', '5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000401',
  6, 'Recommandations', 'not_started', 2,
  '5eed0000-0000-4000-8000-000000000001',
  $$Dix recommandations au plus, classées par priorité. Pour chacune, indiquez l'acteur responsable (unité de gestion, mairies, maîtrise d'ouvrage) et l'échéance proposée.$$,
  null
),
(
  '5eed0000-0000-4000-8000-000000000508', '5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000401',
  7, 'Annexes', 'not_started', 0.5,
  null,
  $$Termes de référence, liste des villages visités, liste des personnes rencontrées, grille d'entretien et modèle de fiche d'inspection.$$,
  null
)
on conflict (id) do nothing;

commit;
