import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor, signedInClient, type TestUser } from "./supabase";

// KRB-15: prompt library, versions and who may change them. Local stack only, no storage.
test.describe.configure({ mode: "serial" });

const GLOBAL_TITLES = ["Rédaction de section", "Résumé exécutif", "Recommandations", "Analyse de données"];
const VERSION_URL = /\/fr\/espaces\/[0-9a-f-]{36}\/modeles\/([0-9a-f-]{36})$/;

type Setup = {
  owner: TestUser;
  expert: TestUser;
  viewer: TestUser;
  workspaceId: string;
  /** A published workspace template, for the read-only checks. */
  sharedId: string;
};

let setup: Setup;

test.beforeAll(async () => {
  const [owner, expert, viewer] = await Promise.all([
    createTestUser("Prisca Owner"),
    createTestUser("Edgar Expert"),
    createTestUser("Vanessa Viewer"),
  ]);
  const { api, workspace_id: workspaceId } = await createWorkspaceFor(owner, "Audit Ouidah");
  const { error: membersError } = await adminClient()
    .from("workspace_members")
    .insert([
      { workspace_id: workspaceId, user_id: expert.id, role: "expert" },
      { workspace_id: workspaceId, user_id: viewer.id, role: "viewer" },
    ]);
  if (membersError) throw membersError;
  // Saved by the owner through RLS, like the editor does.
  const { data: shared, error } = await api
    .from("prompt_library")
    .insert({
      workspace_id: workspaceId,
      template_key: "note-de-cadrage",
      version: 1,
      title: "Note de cadrage",
      template: "Rédige la note de cadrage du rapport {{report_title}}.",
      status: "published",
    })
    .select("id")
    .single();
  if (error || !shared) throw error ?? new Error("Could not create the workspace template");
  setup = { owner, expert, viewer, workspaceId, sharedId: shared.id };
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

/** The history entry of one version, found by its link. */
function historyItem(page: Page, version: number) {
  return page
    .getByRole("main")
    .getByRole("region", { name: "Historique" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: `Version ${version}`, exact: true }) });
}

test("an owner customizes a global template, adds a version and publishes an older one again", async ({
  page,
}) => {
  await signIn(page, setup.owner);
  await page.goto(libraryUrl());
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Modèles de prompts");
  await expect(main.getByRole("link", { name: "Nouveau modèle" })).toBeVisible();

  // The four templates every workspace starts with, read-only. No exact count:
  // the pgTAP fixtures add a global row when a run leaves its data behind.
  const globals = main.getByRole("region", { name: "Modèles globaux" });
  for (const title of GLOBAL_TITLES) {
    await expect(globals.getByRole("link", { name: title, exact: true })).toBeVisible();
  }
  await globals.getByRole("link", { name: "Rédaction de section", exact: true }).click();
  await expect(page).toHaveURL(VERSION_URL);
  const header = main.locator("header");
  await expect(header.getByText("Global", { exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Nouvelle version" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Publier cette version" })).toHaveCount(0);

  // "Personnaliser" opens the editor on a copy.
  await main.getByRole("link", { name: "Personnaliser" }).click();
  await expect(page).toHaveURL(/\/modeles\/nouveau\?depuis=[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Nouveau modèle");
  await expect(page.getByLabel("Titre", { exact: true })).toHaveValue("Rédaction de section");
  const template = page.getByLabel("Modèle", { exact: true });
  await expect(template).toHaveValue(/\{\{deliverables\}\}/);
  const original = await template.inputValue();

  // An unknown variable is reported as you type and blocks saving.
  await template.fill(`${original}\nClient : {{client}}`);
  await expect(main.getByText(/Variable inconnue : \{\{client\}\}/)).toBeVisible();
  await expect(main.getByRole("button", { name: "Publier", exact: true })).toBeDisabled();
  await expect(main.getByRole("button", { name: "Enregistrer en brouillon" })).toBeDisabled();

  // A known variable inserted with its button goes at the cursor and shows in the preview.
  await template.fill(`${original}\nEspace : `);
  await main.getByRole("button", { name: /^Insérer \{\{workspace_name\}\}/ }).click();
  await expect(template).toHaveValue(/Espace : \{\{workspace_name\}\}$/);
  await expect(main.getByText(/Variable inconnue/)).toHaveCount(0);
  await expect(
    main.getByRole("region", { name: "Aperçu" }).getByText(/Espace : Audit énergétique 2026/),
  ).toBeVisible();

  await main.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(page).toHaveURL(VERSION_URL);
  const firstId = versionIdOf(page);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Rédaction de section");
  await expect(header.getByText("Version 1", { exact: true })).toBeVisible();
  await expect(header.getByText("Publié", { exact: true })).toBeVisible();
  await expect(header.getByText("Global", { exact: true })).toHaveCount(0);
  await expect(main.getByText("C'est la première version de ce modèle.")).toBeVisible();

  // A new version needs a changelog.
  await main.getByRole("link", { name: "Nouvelle version" }).click();
  await expect(page).toHaveURL(/\/modifier$/);
  await expect(main.getByText("Elle sera enregistrée comme version 2.", { exact: false })).toBeVisible();
  const added = "Termine par la liste des points à vérifier auprès de l'équipe.";
  await template.fill(`${await template.inputValue()}\n${added}`);
  await main.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(main.getByText("Décrivez ce qui change dans cette version.")).toBeVisible();
  await page.getByLabel("Note de version").fill("Ajoute la liste des points à vérifier.");
  await main.getByRole("button", { name: "Publier", exact: true }).click();

  await expect(page).toHaveURL(VERSION_URL);
  const secondId = versionIdOf(page);
  expect(secondId).not.toBe(firstId);
  await expect(header.getByText("Version 2", { exact: true })).toBeVisible();
  await expect(header.getByText("Publié", { exact: true })).toBeVisible();
  await expect(historyItem(page, 2).getByText("Publié", { exact: true })).toBeVisible();
  await expect(historyItem(page, 2).getByRole("link")).toHaveAttribute("aria-current", "page");
  await expect(historyItem(page, 1).getByText("Archivé", { exact: true })).toBeVisible();
  const diff = main.getByRole("region", { name: "Changements depuis la version 1" });
  await expect(diff.getByRole("insertion").filter({ hasText: added })).toBeVisible();

  // Publishing version 1 again archives version 2.
  await historyItem(page, 1).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/modeles/${firstId}$`));
  await expect(header.getByText("Archivé", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Publier cette version" }).click();
  await expect(header.getByText("Publié", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "Publier cette version" })).toHaveCount(0);
  await expect(historyItem(page, 2).getByText("Archivé", { exact: true })).toBeVisible();

  const admin = adminClient();
  const { data: first } = await admin
    .from("prompt_library")
    .select("template_key")
    .eq("id", firstId)
    .single();
  const { data: rows } = await admin
    .from("prompt_library")
    .select("id, version, status, created_by, changelog")
    .eq("workspace_id", setup.workspaceId)
    .eq("template_key", first?.template_key ?? "")
    .order("version");
  expect(rows).toEqual([
    {
      id: firstId,
      version: 1,
      status: "published",
      created_by: setup.owner.id,
      changelog: "Repris de « Rédaction de section », version 1.",
    },
    {
      id: secondId,
      version: 2,
      status: "archived",
      created_by: setup.owner.id,
      changelog: "Ajoute la liste des points à vérifier.",
    },
  ]);

  // Archiving the published version asks first, then moves the template to its own group.
  await main.getByRole("button", { name: "Archiver" }).click();
  const dialog = page.getByRole("dialog", { name: "Archiver la version publiée ?" });
  await dialog.getByRole("button", { name: "Archiver" }).click();
  await expect(header.getByText("Archivé", { exact: true })).toBeVisible();
  await page.goto(libraryUrl());
  await expect(
    main
      .getByRole("region", { name: "Modèles archivés" })
      .getByRole("link", { name: "Rédaction de section", exact: true }),
  ).toBeVisible();
});

test("an expert reads the library and versions but cannot create, edit, publish or archive", async ({
  page,
}) => {
  await signIn(page, setup.expert);
  // Every member gets the library in the sidebar.
  await page
    .getByRole("navigation", { name: "Navigation de l'application" })
    .getByRole("link", { name: "Modèles de prompts" })
    .click();
  await expect(page).toHaveURL(new RegExp(`${libraryUrl()}$`));

  const main = page.getByRole("main");
  await expect(main.getByText(/Vous consultez les modèles en lecture seule/)).toBeVisible();
  await expect(main.getByRole("link", { name: "Nouveau modèle" })).toHaveCount(0);
  for (const title of GLOBAL_TITLES) {
    await expect(
      main.getByRole("region", { name: "Modèles globaux" }).getByRole("link", { name: title, exact: true }),
    ).toBeVisible();
  }

  await main
    .getByRole("region", { name: "Modèles de l'espace" })
    .getByRole("link", { name: "Note de cadrage", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/modeles/${setup.sharedId}$`));
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Note de cadrage");
  await expect(main.locator("header").getByText("Publié", { exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Nouvelle version" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Publier cette version" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Archiver" })).toHaveCount(0);

  await page.goto(libraryUrl());
  await main
    .getByRole("region", { name: "Modèles globaux" })
    .getByRole("link", { name: "Résumé exécutif", exact: true })
    .click();
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Résumé exécutif");
  await expect(main.getByRole("link", { name: "Personnaliser" })).toHaveCount(0);

  await page.goto(`${libraryUrl()}/nouveau`);
  await expect(main.getByRole("heading", { name: "Page réservée" })).toBeVisible();
  await page.goto(`${libraryUrl()}/${setup.sharedId}/modifier`);
  await expect(main.getByRole("heading", { name: "Page réservée" })).toBeVisible();

  // RLS refuses the write too.
  const api = await signedInClient(setup.expert);
  const { error } = await api.from("prompt_library").insert({
    workspace_id: setup.workspaceId,
    template_key: "essai-expert",
    version: 1,
    title: "Essai",
    template: "Texte",
  });
  expect(error).not.toBeNull();
});

test("a viewer reads the library like an expert", async ({ page }) => {
  await signIn(page, setup.viewer);
  // The workspace menu links to the library too.
  await page.getByRole("button", { name: /Espace de travail actuel : Audit Ouidah/ }).click();
  await page.getByRole("menuitem", { name: "Modèles de prompts" }).click();
  await expect(page).toHaveURL(new RegExp(`${libraryUrl()}$`));

  const main = page.getByRole("main");
  await expect(main.getByText(/Vous consultez les modèles en lecture seule/)).toBeVisible();
  await expect(main.getByRole("link", { name: "Nouveau modèle" })).toHaveCount(0);
  await expect(
    main.getByRole("region", { name: "Modèles globaux" }).getByRole("link", {
      name: "Rédaction de section",
      exact: true,
    }),
  ).toBeVisible();

  await page.goto(`${libraryUrl()}/${setup.sharedId}`);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Note de cadrage");
  await expect(main.getByRole("link", { name: "Nouvelle version" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Publier cette version" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Archiver" })).toHaveCount(0);

  await page.goto(`${libraryUrl()}/nouveau`);
  await expect(main.getByRole("heading", { name: "Page réservée" })).toBeVisible();
});
