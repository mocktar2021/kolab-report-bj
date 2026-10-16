import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor, setPlan, type TestUser } from "./supabase";

// KRB-198: the three starts of "Nouveau modèle" (describe, copy a KolabReport
// template, copy one of the workspace), "Rédiger avec l'IA" with the mock
// model (AI_PROVIDER=mock and AI_DRAFTS_ENABLED=true, see
// scripts/ci-env-local.sh), the folded settings and the plan notice.
test.describe.configure({ mode: "serial" });

const VERSION_URL = /\/fr\/espaces\/[0-9a-f-]{36}\/modeles\/([0-9a-f-]{36})$/;

type Setup = {
  owner: TestUser;
  workspaceId: string;
  organizationId: string;
  /** A published workspace template, to copy. */
  sharedId: string;
};

let setup: Setup;

test.beforeAll(async () => {
  const owner = await createTestUser("Prudence Owner");
  const {
    api,
    workspace_id: workspaceId,
    organization_id: organizationId,
  } = await createWorkspaceFor(owner, "Modèles Bohicon");
  const { data: shared, error } = await api
    .from("prompt_library")
    .insert({
      workspace_id: workspaceId,
      template_key: "note-de-cadrage",
      version: 1,
      title: "Note de cadrage",
      template: "Rédige la note de cadrage du rapport {{report_title}} à partir de {{deliverables}}.",
      status: "published",
    })
    .select("id")
    .single();
  if (error || !shared) throw error ?? new Error("Could not create the workspace template");
  setup = { owner, workspaceId, organizationId, sharedId: shared.id };
});

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

function libraryUrl() {
  return `/fr/espaces/${setup.workspaceId}/modeles`;
}

function versionIdOf(page: Page) {
  const match = VERSION_URL.exec(new URL(page.url()).pathname);
  if (!match?.[1]) throw new Error(`Not a version page: ${page.url()}`);
  return match[1];
}

async function savedVersion(id: string) {
  const { data, error } = await adminClient()
    .from("prompt_library")
    .select(
      "workspace_id, title, template, status, output_schema, model_tier, temperature, max_output_tokens, changelog",
    )
    .eq("id", id)
    .single();
  if (error || !data) throw error ?? new Error(`No version ${id}`);
  return data;
}

async function openStart(page: Page) {
  await page.goto(libraryUrl());
  await page.getByRole("main").getByRole("link", { name: "Nouveau modèle" }).click();
  await expect(page).toHaveURL(new RegExp(`${libraryUrl()}/nouveau$`));
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText("Nouveau modèle");
}

test("the start screen offers to describe, or copy a KolabReport or workspace template", async ({ page }) => {
  await signIn(page, setup.owner);
  await openStart(page);
  const main = page.getByRole("main");
  await expect(main.getByRole("region", { name: "Décrire ce que vous attendez" })).toBeVisible();
  const globals = main.getByRole("region", { name: "Copier un modèle KolabReport" });
  await expect(globals.getByRole("link", { name: "Copier « Résumé exécutif »" })).toBeVisible();
  const own = main.getByRole("region", { name: "Copier un modèle de l'espace" });
  await expect(own.getByRole("link", { name: "Copier « Note de cadrage »" })).toBeVisible();

  // Copying a KolabReport template opens the editor on it.
  await globals.getByRole("link", { name: "Copier « Résumé exécutif »" }).click();
  await expect(page).toHaveURL(/\/modeles\/nouveau\?depuis=[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Titre", { exact: true })).toHaveValue("Résumé exécutif");
  await expect(page.getByLabel("Modèle", { exact: true })).toHaveValue(/\{\{deliverables\}\}/);
  // The type of result stays in view, the technical settings are folded.
  await expect(page.getByLabel("Type de résultat")).toHaveValue("executive_summary");
  await expect(page.getByLabel("Liberté de formulation")).toBeHidden();
  await main.getByText("Réglages avancés").click();
  await expect(page.getByLabel("Liberté de formulation")).toHaveValue("0,3");
  await expect(page.getByLabel("Longueur maximale du texte")).toHaveValue("2048");
  await expect(main.getByText(/Soit environ 1\s250 mots/)).toBeVisible();
  await main.getByRole("button", { name: "Enregistrer en brouillon" }).click();
  await expect(page).toHaveURL(VERSION_URL);
  expect(await savedVersion(versionIdOf(page))).toMatchObject({
    workspace_id: setup.workspaceId,
    title: "Résumé exécutif",
    status: "draft",
    output_schema: "executive_summary",
    // The global template is at version 2 since KRB-184 raised its cap.
    changelog: expect.stringMatching(/^Repris de « Résumé exécutif », version \d+\.$/),
  });

  // A workspace template is copied the same way, from the start screen.
  await openStart(page);
  await own.getByRole("link", { name: "Copier « Note de cadrage »" }).click();
  await expect(page.getByLabel("Titre", { exact: true })).toHaveValue("Note de cadrage");
  await page.getByLabel("Titre", { exact: true }).fill("Note de cadrage courte");
  await main.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(page).toHaveURL(VERSION_URL);
  const copyId = versionIdOf(page);
  expect(copyId).not.toBe(setup.sharedId);
  expect(await savedVersion(copyId)).toMatchObject({
    title: "Note de cadrage courte",
    status: "published",
    changelog: "Repris de « Note de cadrage », version 1.",
  });
  // The original did not change.
  expect(await savedVersion(setup.sharedId)).toMatchObject({ title: "Note de cadrage", status: "published" });

  // And from its page, with "Copier".
  await page.goto(`${libraryUrl()}/${setup.sharedId}`);
  await main.getByRole("link", { name: "Copier", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/modeles/nouveau\\?depuis=${setup.sharedId}$`));
  await expect(page.getByLabel("Titre", { exact: true })).toHaveValue("Note de cadrage");
});

test("the short form builds the template without the AI", async ({ page }) => {
  await signIn(page, setup.owner);
  await openStart(page);
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Décrire le modèle" }).click();
  await expect(page).toHaveURL(new RegExp(`${libraryUrl()}/nouveau/description$`));
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Décrire le modèle");

  await page.getByLabel("Nom du modèle").fill("Diagnostic des forages");
  await page
    .getByLabel("Ce que la section doit contenir")
    .fill("L'état de chaque forage, le débit mesuré et les pannes relevées depuis la dernière visite.");
  await page.getByLabel(/Structure attendue/).fill("État des forages\nPannes\nPoints à vérifier");
  await page.getByRole("radio", { name: "Laisser un repère « [À compléter] » à l'endroit concerné" }).check();
  await main.getByRole("button", { name: "Créer le texte du modèle" }).click();

  await expect(main.getByRole("heading", { name: "Relire et enregistrer le modèle" })).toBeFocused();
  await expect(page.getByLabel("Titre", { exact: true })).toHaveValue("Diagnostic des forages");
  const template = page.getByLabel("Modèle", { exact: true });
  await expect(template).toHaveValue(/^Tu rédiges une section d'un rapport d'expertise/);
  await expect(template).toHaveValue(/- État des forages\n- Pannes\n- Points à vérifier/);
  await expect(template).toHaveValue(/« \[À compléter : ce qui manque\] »/);
  await expect(main.getByText(/Variable inconnue/)).toHaveCount(0);
  await expect(
    main.getByRole("region", { name: "Aperçu" }).getByText(/Section à rédiger : Bilan des consommations/),
  ).toBeVisible();

  await main.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(page).toHaveURL(VERSION_URL);
  const saved = await savedVersion(versionIdOf(page));
  expect(saved).toMatchObject({
    title: "Diagnostic des forages",
    status: "published",
    output_schema: "section_draft",
    // The defaults: nothing set in the advanced settings.
    model_tier: "standard",
    temperature: null,
    max_output_tokens: null,
    changelog: "Créé avec le formulaire « Décrire le modèle ».",
  });
  expect(saved.template).toContain("Contenu attendu :\nL'état de chaque forage");
});

test("« Rédiger avec l'IA » fills the editor, counts in its own ledger and saves nothing", async ({
  page,
}) => {
  await signIn(page, setup.owner);
  await page.goto(`${libraryUrl()}/nouveau/description`);
  const main = page.getByRole("main");
  await main.getByRole("radio", { name: "Décrire en quelques phrases" }).check();
  await expect(main.getByText(/par personne et par jour/)).toBeVisible();

  const admin = adminClient();
  const before = await admin
    .from("prompt_library")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", setup.workspaceId);

  await page
    .getByLabel("Décrivez le modèle en quelques phrases")
    .fill(
      "Une section qui reprend les constats de terrain, du plus important au moins important, avec leurs sources.",
    );
  await main.getByRole("button", { name: "Rédiger avec l'IA" }).click();

  await expect(main.getByRole("heading", { name: "Relire et enregistrer le modèle" })).toBeVisible();
  await expect(main.getByText(/rien n'est enregistré pour le moment/)).toBeVisible();
  // The mock model's answer (src/lib/ai/template-writer.ts).
  await expect(page.getByLabel("Titre", { exact: true })).toHaveValue("Synthèse des constats de terrain");
  await expect(page.getByLabel("Modèle", { exact: true })).toHaveValue(/\{\{deliverables\}\}/);

  // Nothing saved yet, and no AI draft counted: the call has its own ledger.
  const after = await admin
    .from("prompt_library")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", setup.workspaceId);
  expect(after.count).toBe(before.count);
  const { data: calls } = await admin
    .from("prompt_assist_calls")
    .select("user_id, status, model, input_tokens, output_tokens")
    .eq("workspace_id", setup.workspaceId);
  expect(calls).toEqual([
    expect.objectContaining({ user_id: setup.owner.id, status: "succeeded", model: "mock" }),
  ]);
  expect(calls?.[0]?.input_tokens).toBeGreaterThan(0);
  const { count: drafts } = await admin
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", setup.workspaceId);
  expect(drafts).toBe(0);

  // The manager edits the text, then saves it.
  const template = page.getByLabel("Modèle", { exact: true });
  await template.fill(`${await template.inputValue()}\nTermine par les points à confirmer.`);
  await main.getByRole("button", { name: "Enregistrer en brouillon" }).click();
  await expect(page).toHaveURL(VERSION_URL);
  const saved = await savedVersion(versionIdOf(page));
  expect(saved).toMatchObject({
    title: "Synthèse des constats de terrain",
    status: "draft",
    changelog: "Premier jet rédigé avec l'IA à partir d'une description.",
  });
  expect(saved.template).toContain("Termine par les points à confirmer.");

  // The call shows on the AI dashboard.
  await page.goto(`/fr/espaces/${setup.workspaceId}/ia`);
  const writer = page.getByRole("main").getByRole("region", { name: "Modèles rédigés avec l'IA" });
  await expect(writer.getByText("1 appel", { exact: true })).toBeVisible();
});

test("a plan without custom templates says so and links to the offers", async ({ page }) => {
  await setPlan(setup.organizationId, "independant");
  try {
    await signIn(page, setup.owner);
    await page.goto(libraryUrl());
    const main = page.getByRole("main");
    await expect(
      main.getByText(/L'offre Indépendant de votre organisation n'inclut pas les modèles personnalisés/),
    ).toBeVisible();
    await expect(main.getByRole("link", { name: "Voir les offres" })).toHaveAttribute(
      "href",
      `/fr/organisations/${setup.organizationId}/abonnement`,
    );
    await expect(main.getByRole("button", { name: "Nouveau modèle" })).toBeDisabled();
    await expect(main.getByRole("link", { name: "Nouveau modèle" })).toHaveCount(0);

    // The pages that would fail on save say it too.
    await page.goto(`${libraryUrl()}/nouveau`);
    await expect(main.getByRole("link", { name: "Voir les offres" })).toBeVisible();
    await expect(main.getByRole("region", { name: "Copier un modèle KolabReport" })).toHaveCount(0);
    await page.goto(`${libraryUrl()}/nouveau/description`);
    await expect(main.getByRole("link", { name: "Voir les offres" })).toBeVisible();
    await expect(page.getByLabel("Nom du modèle")).toHaveCount(0);
    await page.goto(`${libraryUrl()}/${setup.sharedId}`);
    await expect(main.getByRole("button", { name: "Copier", exact: true })).toBeDisabled();
    await expect(main.getByRole("button", { name: "Nouvelle version" })).toBeDisabled();
  } finally {
    await setPlan(setup.organizationId, "cabinet");
  }
});
