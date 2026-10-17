import { adminClient, setPlan, signedInClient, type TestUser } from "../e2e/supabase";

// Demo data of the guide screenshots (KRB-199), written to the local Supabase
// stack with the helpers of the end-to-end tests. Every name is invented and
// every address ends in .test, a domain that can never receive mail. The
// people have fixed addresses, so each run first deletes what the previous
// one left: their organizations, then their accounts.

const DOMAIN = "demo.kolabreport.test";
const PASSWORD = "Kolab-guide-2026";

const PEOPLE = {
  owner: { name: "Clémence Adjovi", email: `clemence.adjovi@${DOMAIN}` },
  admin: { name: "Rodrigue Sossa", email: `rodrigue.sossa@${DOMAIN}` },
  expert: { name: "Nadège Houngbo", email: `nadege.houngbo@${DOMAIN}` },
  otherExpert: { name: "Fabrice Kpadonou", email: `fabrice.kpadonou@${DOMAIN}` },
  viewer: { name: "Estelle Dossa", email: `estelle.dossa@${DOMAIN}` },
} as const;

type Person = keyof typeof PEOPLE;

/** Typed in the invitation form of the members page, never sent anywhere real. */
export const INVITED_EMAIL = `ghislain.tossou@${DOMAIN}`;

export const ORGANIZATION = "Cabinet Lagune Études";
export const WORKSPACE = "Assainissement Porto-Novo";
export const REPORT = "Étude d'impact du programme d'assainissement";
export const SECOND_REPORT = "Rapport de fin de mission";

export type Demo = {
  people: Record<Person, TestUser>;
  organizationId: string;
  workspaceId: string;
  reportId: string;
  secondReportId: string;
  sections: {
    context: string;
    diagnosis: string;
    survey: string;
  };
};

/** Deletes the demo accounts of an earlier run, with the organizations they own. */
async function removePreviousRun() {
  const admin = adminClient();
  // Every account has a profile with its e-mail. The Auth admin list is no
  // help here: it fails on accounts written by SQL, like those of the seed.
  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, email")
    .like("email", `%@${DOMAIN}`);
  if (profilesError) throw profilesError;
  const demo = profiles ?? [];

  for (const user of demo) {
    const { data: organizations, error } = await admin
      .from("organizations")
      .select("id, name")
      .eq("owner_id", user.id);
    if (error) throw error;
    if (!organizations?.length) continue;
    // The owner deletes them the way the app does, so nothing is left behind.
    const { error: passwordError } = await admin.auth.admin.updateUserById(user.id, { password: PASSWORD });
    if (passwordError) throw passwordError;
    const api = await signedInClient({ id: user.id, name: "", email: user.email, password: PASSWORD });
    for (const organization of organizations) {
      const { error: deleteError } = await api.rpc("delete_organization", {
        p_organization_id: organization.id,
        p_confirmation: organization.name,
      });
      if (deleteError) throw deleteError;
    }
  }
  for (const user of demo) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  }
}

async function createPerson(person: Person): Promise<TestUser> {
  const { name, email } = PEOPLE[person];
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) throw error ?? new Error(`Could not create ${email}`);
  return { id: data.user.id, name, email, password: PASSWORD };
}

const CONTEXT = `## Le programme

Le programme d'assainissement de Porto-Novo équipe les ménages de latrines améliorées et organise la vidange des fosses dans trois arrondissements.

- 2 400 latrines construites depuis 2024
- 18 points de collecte des boues
- 6 opérateurs de vidange formés

## Objectifs de l'étude

| Objectif | Indicateur |
| --- | --- |
| Mesurer l'accès | Part des ménages équipés |
| Suivre la vidange | Fosses vidées par an |`;

const SURVEY_NOTES = `## Enquête ménages, février 2026

Questionnaire passé auprès de 412 ménages des arrondissements 1, 3 et 5.

| Arrondissement | Ménages | Latrine améliorée |
| --- | --- | --- |
| 1 | 140 | 61 % |
| 3 | 152 | 48 % |
| 5 | 120 | 55 % |

Les ménages sans latrine citent d'abord le coût de la construction.`;

const STATION_NOTES = `## Relevés des ouvrages

Visite des 18 points de collecte du 10 au 14 février 2026.

- 14 points en service, 3 à réparer, 1 fermé
- Dalles fissurées sur 5 latrines publiques
- Accès difficile en saison des pluies pour 4 points`;

const INVENTORY = `### Feuille « Ouvrages »

| Ouvrage | Arrondissement | État |
| --- | --- | --- |
| Point de collecte Ouando | 3 | En service |
| Point de collecte Djègan | 5 | À réparer |
| Latrine publique marché Ouando | 3 | Dalle fissurée |`;

/** A deliverable row without a stored file, like addParsedDeliverable: the local stack has no Storage. */
async function addDeliverable(
  demo: Pick<Demo, "workspaceId">,
  sectionId: string,
  uploadedBy: string,
  file: { name: string; mime: string; content: string | null; size: number },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const parsed = file.content !== null;
  const { error } = await adminClient()
    .from("deliverables")
    .insert({
      id,
      workspace_id: demo.workspaceId,
      section_id: sectionId,
      uploaded_by: uploadedBy,
      storage_path: `${demo.workspaceId}/${sectionId}/${id}-${file.name}`,
      file_name: file.name,
      mime_type: file.mime,
      size_bytes: file.size,
      uploaded_at: now,
      parse_status: parsed ? "parsed" : "skipped",
      parsed_content: file.content,
      parsed_at: parsed ? now : null,
    });
  if (error) throw error;
}

/** Fresh demo data: an organization on the Cabinet plan, one workspace, two reports. */
export async function seedDemo(): Promise<Demo> {
  await removePreviousRun();
  const people = {
    owner: await createPerson("owner"),
    admin: await createPerson("admin"),
    expert: await createPerson("expert"),
    otherExpert: await createPerson("otherExpert"),
    viewer: await createPerson("viewer"),
  };

  const owner = await signedInClient(people.owner);
  const { data: created, error } = await owner
    .rpc("create_workspace_with_owner", {
      organization_name: ORGANIZATION,
      workspace_name: WORKSPACE,
      report_title: REPORT,
    })
    .single();
  if (error || !created) throw error ?? new Error("create_workspace_with_owner returned nothing");
  const { organization_id: organizationId, workspace_id: workspaceId, report_id: reportId } = created;
  // Cabinet: room for the team, custom templates, and a second active report.
  await setPlan(organizationId, "cabinet");

  const admin = adminClient();
  const { error: membersError } = await admin.from("workspace_members").insert([
    { workspace_id: workspaceId, user_id: people.admin.id, role: "admin" },
    { workspace_id: workspaceId, user_id: people.expert.id, role: "expert" },
    { workspace_id: workspaceId, user_id: people.otherExpert.id, role: "expert" },
    { workspace_id: workspaceId, user_id: people.viewer.id, role: "viewer" },
  ]);
  if (membersError) throw membersError;

  const { error: reportError } = await owner
    .from("reports")
    .update({
      description:
        "Évaluation du programme d'assainissement autonome de Porto-Novo pour la direction de l'hygiène : accès des ménages aux latrines et filière de vidange.",
    })
    .eq("id", reportId);
  if (reportError) throw reportError;

  const insertSection = async (row: {
    title: string;
    position: number;
    parentId?: string;
    assignedTo?: string;
    instructions?: string;
    status?: "not_started" | "in_progress" | "completed";
    content?: string;
    weight?: number;
  }) => {
    const { data, error: sectionError } = await owner
      .from("report_sections")
      .insert({
        workspace_id: workspaceId,
        report_id: reportId,
        title: row.title,
        position: row.position,
        parent_id: row.parentId ?? null,
        assigned_to: row.assignedTo ?? null,
        instructions: row.instructions ?? null,
        status: row.status ?? "not_started",
        content: row.content ?? null,
        weight: row.weight ?? 1,
      })
      .select("id")
      .single();
    if (sectionError || !data) throw sectionError ?? new Error(`Could not create ${row.title}`);
    return data.id;
  };

  const context = await insertSection({
    title: "Contexte et objectifs",
    position: 0,
    assignedTo: people.expert.id,
    status: "completed",
    content: CONTEXT,
    instructions: "Présenter le programme, ses chiffres clés et les objectifs de l'étude.",
  });
  await insertSection({
    title: "Contexte du programme",
    position: 0,
    parentId: context,
    assignedTo: people.expert.id,
    status: "completed",
    content: "Le programme a démarré en 2024 avec l'appui de la commune.",
  });
  await insertSection({
    title: "Objectifs de l'étude",
    position: 1,
    parentId: context,
    assignedTo: people.otherExpert.id,
    status: "in_progress",
    content: "L'étude mesure l'accès des ménages aux latrines et le suivi de la vidange.",
  });
  await insertSection({
    title: "Méthodologie",
    position: 1,
    assignedTo: people.otherExpert.id,
    status: "in_progress",
    content: "Enquête auprès de 412 ménages et visite des 18 points de collecte.",
  });
  const diagnosis = await insertSection({
    title: "Diagnostic des ouvrages",
    position: 2,
    assignedTo: people.expert.id,
    weight: 2,
    instructions:
      "Décrire l'état des points de collecte et des latrines publiques, arrondissement par arrondissement. Citer les relevés de terrain et signaler les ouvrages à réparer en priorité.",
  });
  const survey = await insertSection({
    title: "Résultats de l'enquête ménages",
    position: 3,
    assignedTo: people.expert.id,
    weight: 2,
  });
  await insertSection({
    title: "Accès aux latrines",
    position: 0,
    parentId: survey,
    assignedTo: people.expert.id,
  });
  await insertSection({
    title: "Gestion des boues de vidange",
    position: 1,
    parentId: survey,
    assignedTo: people.otherExpert.id,
  });
  await insertSection({ title: "Recommandations", position: 4 });

  await addDeliverable({ workspaceId }, diagnosis, people.expert.id, {
    name: "releves-points-de-collecte.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    content: STATION_NOTES,
    size: 184_320,
  });
  await addDeliverable({ workspaceId }, diagnosis, people.expert.id, {
    name: "inventaire-ouvrages.xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    content: INVENTORY,
    size: 46_080,
  });
  await addDeliverable({ workspaceId }, diagnosis, people.expert.id, {
    name: "photo-point-djegan.jpg",
    mime: "image/jpeg",
    content: null,
    size: 2_457_600,
  });
  await addDeliverable({ workspaceId }, survey, people.expert.id, {
    name: "enquete-menages-fevrier-2026.md",
    mime: "text/markdown",
    content: SURVEY_NOTES,
    size: SURVEY_NOTES.length,
  });

  const { data: second, error: secondError } = await owner
    .from("reports")
    .insert({ workspace_id: workspaceId, title: SECOND_REPORT })
    .select("id")
    .single();
  if (secondError || !second) throw secondError ?? new Error("Could not create the second report");

  const { error: templateError } = await owner.from("prompt_library").insert({
    workspace_id: workspaceId,
    template_key: "diagnostic-terrain",
    version: 1,
    title: "Diagnostic de terrain",
    description: "Une section factuelle, ouvrage par ouvrage, à partir des relevés de terrain.",
    template:
      "Rédige la section {{section_title}} du rapport {{report_title}}. Suis les consignes : {{section_instructions}}. Appuie-toi uniquement sur les livrables :\n\n{{deliverables}}",
    status: "published",
  });
  if (templateError) throw templateError;

  return {
    people,
    organizationId,
    workspaceId,
    reportId,
    secondReportId: second.id,
    sections: { context, diagnosis, survey },
  };
}
