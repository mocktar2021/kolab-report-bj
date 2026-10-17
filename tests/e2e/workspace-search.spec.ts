import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations, signIn } from "./a11y";
import { adminClient, createTestUser, createWorkspaceFor, setPlan, type TestUser } from "./supabase";

// KRB-206: the workspace switcher groups the workspaces by organization, and
// the workspace search (from the switcher or Ctrl+K) finds one by its name or
// its organization's, without accents or capitals.
test.describe.configure({ mode: "serial" });

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser("Sena Plusieurs");
  // The first workspace is the one each test lands in: every test has a new
  // browser, without the cookie of the workspace chosen before.
  const zinsou = await createWorkspaceFor(user, "Mission Parakou");
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
