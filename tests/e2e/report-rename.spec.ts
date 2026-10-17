import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor, signedInClient, type TestUser } from "./supabase";

// KRB-202: owners and admins rename an open report from its page. Experts
// get no button, nobody renames a final report, and the database refuses
// both even without the page.
test.describe.configure({ mode: "serial" });

const NEW_TITLE = "Bilan de mission Parakou 2026";

type Setup = { owner: TestUser; expert: TestUser; workspaceId: string; reportId: string; sectionId: string };

let setup: Setup;

test.beforeAll(async () => {
  const [owner, expert] = await Promise.all([createTestUser("Rita Renomme"), createTestUser("Elie Expert")]);
  const { workspace_id: workspaceId, report_id: reportId } = await createWorkspaceFor(owner, "Titre Parakou");
  const admin = adminClient();
  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;
  const { data: section, error } = await admin
    .from("report_sections")
    .insert({
      workspace_id: workspaceId,
      report_id: reportId,
      title: "Contexte",
      position: 0,
      assigned_to: expert.id,
    })
    .select("id")
    .single();
  if (error || !section) throw error ?? new Error("Could not create the section");
  setup = { owner, expert, workspaceId, reportId, sectionId: section.id };
});

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

function reportUrl() {
  return `/fr/rapports/${setup.reportId}`;
}

async function storedTitle() {
  const { data, error } = await adminClient()
    .from("reports")
    .select("title")
    .eq("id", setup.reportId)
    .single();
  if (error) throw error;
  return data.title;
}

test("an owner renames the report and finds the new title on every page", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(reportUrl());
  const main = page.getByRole("main");
  const heading = main.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Rapport Titre Parakou");

  const rename = main.getByRole("button", { name: "Renommer le rapport" });
  const field = main.getByLabel("Titre du rapport", { exact: true });
  // The table of contents has "Enregistrer" buttons too. The inner locator of
  // `has` is read from the form, so it starts from the page, not from main.
  const save = main
    .locator("form")
    .filter({ has: page.getByLabel("Titre du rapport", { exact: true }) })
    .getByRole("button", { name: "Enregistrer" });

  // Escape closes the field without saving and gives the focus back.
  await rename.click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Rapport Titre Parakou");
  await field.fill("Brouillon de titre");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(rename).toBeFocused();
  await expect(heading).toHaveText("Rapport Titre Parakou");

  // Same rule and message as "Nouveau rapport".
  await rename.click();
  await field.fill(" a ");
  await save.click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription("Saisissez entre 2 et 200 caractères.");
  await expect(field).toBeFocused();

  await field.fill(NEW_TITLE);
  await save.click();
  await expect(main.getByRole("status").filter({ hasText: "Titre enregistré." })).toBeVisible();
  await expect(heading).toHaveText(NEW_TITLE);
  await expect(rename).toBeFocused();
  expect(await storedTitle()).toBe(NEW_TITLE);

  await page.reload();
  await expect(page).toHaveTitle(`${NEW_TITLE} · KolabReport`);
  await expect(heading).toHaveText(NEW_TITLE);

  await page.goto("/fr/tableau-de-bord");
  await expect(
    page.getByRole("region", { name: "Rapports" }).getByRole("link", { name: NEW_TITLE }),
  ).toBeVisible();

  // The section page links back to the report under its new title.
  await page.goto(`/fr/espaces/${setup.workspaceId}/sections/${setup.sectionId}`);
  await expect(page.getByRole("main").getByRole("link", { name: NEW_TITLE })).toBeVisible();
});

test("an expert gets no rename button, and the database ignores their change", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(reportUrl());
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText(NEW_TITLE);
  await expect(main.getByRole("button", { name: /^Renommer/ })).toHaveCount(0);

  // RLS lets no row through: no error, nothing updated.
  const api = await signedInClient(setup.expert);
  const { data, error } = await api
    .from("reports")
    .update({ title: "Titre de l'expert" })
    .eq("id", setup.reportId)
    .select("id");
  expect(error).toBeNull();
  expect(data).toEqual([]);
  expect(await storedTitle()).toBe(NEW_TITLE);
});

test("a final report has no rename button, even for its owner", async ({ page }) => {
  const { error: finalError } = await adminClient()
    .from("reports")
    .update({ status: "final" })
    .eq("id", setup.reportId);
  if (finalError) throw finalError;

  await signIn(page, setup.owner);
  await page.goto(reportUrl());
  const main = page.getByRole("main");
  await expect(main.getByText(/^Ce rapport est final : ses sections sont en lecture seule/)).toBeVisible();
  await expect(main.getByRole("heading", { level: 1 })).toHaveText(NEW_TITLE);
  await expect(main.getByRole("button", { name: /^Renommer/ })).toHaveCount(0);

  const api = await signedInClient(setup.owner);
  const { data, error } = await api
    .from("reports")
    .update({ title: "Titre après finalisation" })
    .eq("id", setup.reportId)
    .select("id");
  expect(error).toBeNull();
  expect(data).toEqual([]);
  expect(await storedTitle()).toBe(NEW_TITLE);
});
