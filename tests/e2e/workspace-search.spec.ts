import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations, signIn } from "./a11y";
import { adminClient, createTestUser, createWorkspaceFor, setPlan, type TestUser } from "./supabase";

// KRB-206: the workspace switcher groups the workspaces by organization, and
// the workspace search (from the switcher or Ctrl+K) finds one by its name or
// its organization's, without accents or capitals. KRB-208: the name of an
// organization opens the reports of that organization.
test.describe.configure({ mode: "serial" });

let user: TestUser;
let zinsouId: string;

test.beforeAll(async () => {
  user = await createTestUser("Sena Plusieurs");
  // The first workspace is the one each test lands in: every test has a new
  // browser, without the cookie of the workspace chosen before.
  const zinsou = await createWorkspaceFor(user, "Mission Parakou");
  zinsouId = zinsou.organization_id;
  const agence = await createWorkspaceFor(user, "Énergie Kandi");
  const admin = adminClient();
  const names = [
    { id: zinsou.organization_id, name: "Cabinet Zinsou" },
    { id: agence.organization_id, name: "Agence Ahouandjinou" },
  ];
  for (const { id, name } of names) {
    const { error } = await admin.from("organizations").update({ name }).eq("id", id);
    if (error) throw error;
  }
  // A trial counts one active report; the second workspace brings its own.
  await setPlan(zinsou.organization_id, "cabinet");
  const { error } = await zinsou.api.rpc("create_workspace_in_organization", {
    p_organization_id: zinsou.organization_id,
    p_workspace_name: "Audit Ouidah",
    p_report_title: "Rapport Audit Ouidah",
  });
  if (error) throw error;
});

function switcher(page: Page, name: string) {
  return page.getByRole("button", { name: `Espace de travail actuel : ${name}. Changer d'espace` });
}

test("the switcher groups the workspaces by organization", async ({ page }) => {
  await signIn(page, user);
  await switcher(page, "Mission Parakou").click();
  const menu = page.getByRole("menu", { name: /^Espace de travail actuel/ });
  await expect(
    menu.getByRole("group", { name: "Agence Ahouandjinou" }).getByRole("menuitemradio"),
  ).toHaveText([/^Énergie Kandi/]);
  await expect(menu.getByRole("group", { name: "Cabinet Zinsou" }).getByRole("menuitemradio")).toHaveText([
    /^Audit Ouidah/,
    /^Mission Parakou/,
  ]);
  await expectNoAxeViolations(page, "the grouped workspace menu");
});

test("from the switcher, the search finds a workspace by its organization, with the keyboard only", async ({
  page,
}) => {
  await signIn(page, user);
  const trigger = switcher(page, "Mission Parakou");
  await trigger.focus();
  await page.keyboard.press("Enter");
  // The menu opens on its first item, the search.
  await expect(page.getByRole("menuitem", { name: "Rechercher un espace" })).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Rechercher un espace de travail" });
  const input = dialog.getByRole("combobox", { name: "Rechercher un espace de travail" });
  await expect(input).toBeFocused();
  await expectNoAxeViolations(page, "the workspace search");

  // Without the accent or the capital of "Agence Ahouandjinou".
  await input.pressSequentially("ahouandjinou");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(dialog.getByRole("option")).toContainText("Énergie Kandi");
  await page.keyboard.press("Enter");
  await expect(switcher(page, "Énergie Kandi")).toBeVisible();
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);
});

test("Ctrl+K finds a workspace by its name and switches to it", async ({ page }) => {
  await signIn(page, user);
  await expect(switcher(page, "Mission Parakou")).toBeVisible();
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Palette de commandes" });
  await palette
    .getByRole("combobox", { name: "Rechercher une action ou un espace" })
    .pressSequentially("ouidah");
  await expect(palette.getByRole("option").first()).toContainText("Audit Ouidah");
  await expect(palette.getByRole("option").first()).toContainText("Cabinet Zinsou");
  await page.keyboard.press("Enter");
  await expect(switcher(page, "Audit Ouidah")).toBeVisible();
});

test("closing the search gives the focus back to the switcher", async ({ page }) => {
  await signIn(page, user);
  const trigger = switcher(page, "Mission Parakou");
  await trigger.click();
  await page.getByRole("menuitem", { name: "Rechercher un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Rechercher un espace de travail" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("with the keyboard, an organization name opens the reports of that organization", async ({ page }) => {
  await signIn(page, user);
  await switcher(page, "Mission Parakou").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Rechercher un espace" })).toBeFocused();
  // The first organization by name comes right after the search.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Agence Ahouandjinou : voir les rapports" })).toBeFocused();
  await page.keyboard.press("Enter");

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Agence Ahouandjinou");
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(["Énergie Kandi"]);
  await expect(main.getByRole("link", { name: "Rapport Énergie Kandi" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Rapport Mission Parakou" })).toHaveCount(0);
});

test("the reports of an organization list each of its workspaces and open a report", async ({ page }) => {
  await signIn(page, user);
  await switcher(page, "Mission Parakou").click();
  await page.getByRole("menuitem", { name: "Cabinet Zinsou : voir les rapports" }).click();
  await expect(page).toHaveURL(`/fr/organisations/${zinsouId}/rapports`);
  await expect(page).toHaveTitle("Rapports de l'organisation Cabinet Zinsou · KolabReport");

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Cabinet Zinsou");
  await expect(main.getByText("2 rapports dans 2 espaces de travail, dont 2 actifs.")).toBeVisible();
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(["Audit Ouidah", "Mission Parakou"]);
  await expect(main.getByRole("link", { name: "Rapport Énergie Kandi" })).toHaveCount(0);
  await expectNoAxeViolations(page, "the reports of an organization");

  await main.getByRole("link", { name: "Rapport Audit Ouidah" }).click();
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Rapport Audit Ouidah");
});

test("someone with no workspace in the organization gets a 404", async ({ page }) => {
  const outsider = await createTestUser("Koffi Ailleurs");
  await createWorkspaceFor(outsider, "Projet Lokossa");
  await signIn(page, outsider);
  const answer = await page.goto(`/fr/organisations/${zinsouId}/rapports`);
  expect(answer?.status()).toBe(404);
  const invalid = await page.goto("/fr/organisations/pas-un-identifiant/rapports");
  expect(invalid?.status()).toBe(404);
});
