import { expect, test, type Browser, type Page } from "@playwright/test";
import { adminClient, createTestUser, signedInClient, type TestUser } from "./supabase";

// KRB-11: workspace creation, roles and section assignment.
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);
}

async function pageFor(browser: Browser, user: TestUser) {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, user);
  return page;
}

test("a user without a workspace creates one with the wizard", async ({ page }) => {
  const user = await createTestUser("Fatou Dossou");
  await signIn(page, user);

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Créez votre premier espace de travail" })).toBeVisible();
  await main.getByRole("link", { name: "Créer un espace de travail" }).click();
  await expect(page).toHaveURL(/\/fr\/espaces\/nouveau$/);

  // Each step is checked before the next one.
  await page.getByLabel("Nom de l'organisation").fill("A");
  await page.getByRole("button", { name: "Suivant" }).click();
  await expect(page.getByText("Saisissez entre 2 et 120 caractères.")).toBeVisible();
  await page.getByLabel("Nom de l'organisation").fill("Cabinet Dossou & Associés");
  await page.getByRole("button", { name: "Suivant" }).click();
  await page.getByLabel("Nom de l'espace de travail").fill("Audit énergétique 2026");
  await page.getByRole("button", { name: "Suivant" }).click();
  await page.getByLabel("Titre du rapport").fill("Audit énergétique du siège");
  await page.getByRole("button", { name: "Créer l'espace de travail" }).click();

  await expect(page).toHaveURL(/\/fr\/rapports\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Audit énergétique du siège");

  await page.getByLabel("Nouvelle section").fill("Contexte et périmètre");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(main.getByText("Contexte et périmètre", { exact: true })).toBeVisible();

  // The only owner cannot step down.
  await main.getByRole("link", { name: "Gérer les membres" }).click();
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Membres de Audit énergétique 2026");
  await page.getByLabel("Rôle de Fatou Dossou", { exact: true }).selectOption("admin");
  await page.getByRole("button", { name: "Enregistrer le rôle de Fatou Dossou" }).click();
  await expect(main.getByText(/doit garder au moins un propriétaire/)).toBeVisible();
  await expect(page.getByLabel("Rôle de Fatou Dossou", { exact: true })).toHaveValue("owner");
});

test("owners assign sections, admins leave owners alone, experts and viewers only read", async ({
  browser,
}) => {
  const [owner, admin, expert, viewer] = await Promise.all([
    createTestUser("Koffi Owner"),
    createTestUser("Awa Admin"),
    createTestUser("Eli Expert"),
    createTestUser("Vic Viewer"),
  ]);

  // Setup through the API: two workspaces for the owner, members added
  // directly (invitations come with KRB-12) and two sections.
  const ownerApi = await signedInClient(owner);
  const { data: created, error } = await ownerApi
    .rpc("create_workspace_with_owner", {
      organization_name: "Cabinet Koffi",
      workspace_name: "Audit Koffi",
      report_title: "Rapport Koffi",
    })
    .single();
  if (error || !created) throw error ?? new Error("create_workspace_with_owner returned nothing");
  await ownerApi.rpc("create_workspace_with_owner", {
    organization_name: "Cabinet Koffi",
    workspace_name: "Mission Cotonou",
    report_title: "Rapport Cotonou",
  });
  const { error: membersError } = await adminClient()
    .from("workspace_members")
    .insert([
      { workspace_id: created.workspace_id, user_id: admin.id, role: "admin" },
      { workspace_id: created.workspace_id, user_id: expert.id, role: "expert" },
      { workspace_id: created.workspace_id, user_id: viewer.id, role: "viewer" },
    ]);
  if (membersError) throw membersError;
  const { error: sectionsError } = await ownerApi.from("report_sections").insert([
    {
      workspace_id: created.workspace_id,
      report_id: created.report_id,
      title: "Analyse technique",
      position: 0,
    },
    { workspace_id: created.workspace_id, report_id: created.report_id, title: "Annexes", position: 1 },
  ]);
  if (sectionsError) throw sectionsError;
  const reportUrl = `/fr/rapports/${created.report_id}`;

  // The owner assigns "Analyse technique" to the expert, with weight 2.
  const ownerPage = await pageFor(browser, owner);
  await ownerPage.goto(reportUrl);
  const analysis = ownerPage.getByRole("listitem").filter({ hasText: "Analyse technique" });
  await expect(
    ownerPage.getByLabel("Expert de la section Annexes").locator("option", { hasText: viewer.name }),
  ).toHaveCount(0);
  await ownerPage.getByLabel("Expert de la section Analyse technique").selectOption({ label: expert.name });
  await ownerPage.getByLabel("Poids de la section Analyse technique").fill("2");
  await analysis.getByRole("button", { name: "Enregistrer" }).click();
  await expect(analysis.getByText("Enregistré.")).toBeVisible();

  // The admin manages the expert but not the owner.
  const adminPage = await pageFor(browser, admin);
  await adminPage.goto(`/fr/espaces/${created.workspace_id}/membres`);
  await expect(adminPage.getByLabel(`Rôle de ${expert.name}`, { exact: true })).toBeVisible();
  await expect(adminPage.getByLabel(`Rôle de ${owner.name}`, { exact: true })).toHaveCount(0);
  await expect(
    adminPage.getByRole("button", { name: `Retirer ${owner.name} de l'espace de travail` }),
  ).toHaveCount(0);

  // The expert reads every section, edits none of the assignments, and sees
  // their own section marked. They only belong to one workspace.
  const expertPage = await pageFor(browser, expert);
  await expect(
    expertPage.getByRole("button", { name: /Espace de travail actuel : Audit Koffi/ }),
  ).toBeVisible();
  await expertPage.getByRole("button", { name: /Espace de travail actuel/ }).click();
  await expect(expertPage.getByRole("menuitemradio")).toHaveCount(1);
  await expertPage.keyboard.press("Escape");
  await expertPage.goto(reportUrl);
  await expect(
    expertPage.getByText("Vous modifiez celles qui vous sont attribuées.", { exact: false }),
  ).toBeVisible();
  await expect(expertPage.getByRole("combobox")).toHaveCount(0);
  await expect(
    expertPage.getByRole("listitem").filter({ hasText: "Analyse technique" }).getByText("Votre section"),
  ).toBeVisible();
  await expertPage.goto(`/fr/espaces/${created.workspace_id}/membres`);
  await expect(expertPage.getByRole("heading", { name: "Page réservée" })).toBeVisible();

  // A viewer's write through the API touches no row.
  const viewerApi = await signedInClient(viewer);
  const { data: updated, error: viewerError } = await viewerApi
    .from("report_sections")
    .update({ status: "completed" })
    .eq("report_id", created.report_id)
    .select("id");
  expect(viewerError).toBeNull();
  expect(updated).toEqual([]);

  // The owner switches to the other workspace from the sidebar.
  await ownerPage.goto("/fr/tableau-de-bord");
  await ownerPage.getByRole("button", { name: /Espace de travail actuel : Audit Koffi/ }).click();
  await ownerPage.getByRole("menuitemradio", { name: /Mission Cotonou/ }).click();
  await expect(ownerPage.getByText("Avancement des sections de l'espace Mission Cotonou.")).toBeVisible();
});
