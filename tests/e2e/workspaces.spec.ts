import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  adminClient,
  createTestUser,
  createWorkspaceFor,
  setPlan,
  signedInClient,
  type TestUser,
} from "./supabase";

// KRB-11: workspace creation, roles and section assignment. KRB-175: a new
// workspace in an organization the user manages, and "Nouveau rapport".
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

test("an owner adds a second workspace to their organization, an expert only creates a new one", async ({
  page,
  browser,
}) => {
  const [owner, expert] = await Promise.all([createTestUser("Rose Parakou"), createTestUser("Ines Experte")]);
  const first = await createWorkspaceFor(owner, "Audit Parakou");
  // The new workspace comes with its own report, and the trial allows one
  // active report (KRB-175): the organization is on Cabinet.
  await setPlan(first.organization_id, "cabinet");
  const { error: memberError } = await adminClient()
    .from("workspace_members")
    .insert({ workspace_id: first.workspace_id, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;

  await signIn(page, owner);
  await page.goto("/fr/espaces/nouveau");
  const main = page.getByRole("main");

  // The organization of the current workspace is checked. "Nouvelle
  // organisation" asks for a name, the existing one does not.
  const choice = main.getByRole("group", { name: "Organisation (cabinet)" });
  await expect(choice.getByRole("radio", { name: "Cabinet Audit Parakou" })).toBeChecked();
  await expect(main.getByLabel("Nom de l'organisation")).toHaveCount(0);
  await choice.getByRole("radio", { name: "Nouvelle organisation" }).check();
  await expect(main.getByLabel("Nom de l'organisation")).toBeVisible();
  await choice.getByRole("radio", { name: "Cabinet Audit Parakou" }).check();
  await expect(main.getByLabel("Nom de l'organisation")).toHaveCount(0);

  await main.getByRole("button", { name: "Suivant" }).click();
  await main.getByLabel("Nom de l'espace de travail").fill("Mission Natitingou");
  await main.getByRole("button", { name: "Suivant" }).click();
  await expect(main.getByRole("definition").first()).toHaveText("Cabinet Audit Parakou");
  await main.getByLabel("Titre du rapport").fill("Rapport Natitingou");
  await main.getByRole("button", { name: "Créer l'espace de travail" }).click();

  await expect(page).toHaveURL(/\/fr\/rapports\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Rapport Natitingou");

  // Both workspaces sit in the one organization of the owner.
  const admin = adminClient();
  const { data: workspaces, error } = await admin
    .from("workspaces")
    .select("name, organization_id")
    .eq("created_by", owner.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  expect(workspaces).toEqual([
    { name: "Audit Parakou", organization_id: first.organization_id },
    { name: "Mission Natitingou", organization_id: first.organization_id },
  ]);
  const { count } = await admin
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", owner.id);
  expect(count).toBe(1);

  // The expert of "Audit Parakou" cannot add to that organization: the
  // wizard only asks for the name of a new one.
  const expertPage = await pageFor(browser, expert);
  await expertPage.goto("/fr/espaces/nouveau");
  await expect(expertPage.getByRole("main").getByLabel("Nom de l'organisation")).toBeVisible();
  await expect(expertPage.getByRole("radio")).toHaveCount(0);
});

test("owners create a report from the dashboard, experts do not get the button", async ({
  page,
  browser,
}) => {
  const [owner, expert] = await Promise.all([createTestUser("Paul Bohicon"), createTestUser("Lea Experte")]);
  const { workspace_id: workspaceId, organization_id: organizationId } = await createWorkspaceFor(
    owner,
    "Audit Bohicon",
  );
  // The trial allows one active report (KRB-175): the organization is on
  // Cabinet so a second one fits.
  await setPlan(organizationId, "cabinet");
  const { error: memberError } = await adminClient()
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;

  await signIn(page, owner);
  const main = page.getByRole("main");
  const reports = main.getByRole("region", { name: "Rapports", exact: true });
  await expect(reports.getByRole("link")).toHaveCount(1);

  // The dialog opens on the title field and Escape gives the focus back.
  const opener = reports.getByRole("button", { name: "Nouveau rapport" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Nouveau rapport" });
  const title = dialog.getByLabel("Titre du rapport");
  await expect(title).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  // A title that is too short stays in the dialog, tied to the field.
  await page.keyboard.press("Enter");
  await title.fill("x");
  await dialog.getByRole("button", { name: "Créer le rapport" }).click();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(title).toHaveAccessibleDescription("Saisissez entre 2 et 200 caractères.");
  await expect(title).toBeFocused();

  await title.fill("Rapport de fin de mission");
  await dialog.getByRole("button", { name: "Créer le rapport" }).click();
  await expect(page).toHaveURL(/\/fr\/rapports\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Rapport de fin de mission");

  await page.goto("/fr/tableau-de-bord");
  await expect(reports.getByText("2 rapports")).toBeVisible();
  await expect(reports.getByRole("link", { name: "Rapport de fin de mission" })).toBeVisible();

  // The expert reads both reports and gets no button.
  const expertPage = await pageFor(browser, expert);
  const expertReports = expertPage.getByRole("main").getByRole("region", { name: "Rapports", exact: true });
  await expect(expertReports.getByRole("link")).toHaveCount(2);
  await expect(expertReports.getByRole("button", { name: "Nouveau rapport" })).toHaveCount(0);
});
