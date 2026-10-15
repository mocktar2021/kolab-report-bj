import { expect, type Page } from "@playwright/test";
import { REPORT_PREFIX, escapeRegExp } from "./support";

// The report the signed-in checks create and delete on every run (KRB-180,
// KRB-26 criterion 2), through the pages only. Same labels as
// tests/e2e/deletions.spec.ts.

function reportList(page: Page) {
  return page.getByRole("main").getByRole("region", { name: "Rapports" });
}

/** "Nouveau rapport" on the dashboard. The new report opens. */
export async function createSmokeReport(page: Page, title: string) {
  await page.goto("/fr/tableau-de-bord");
  const create = page.getByRole("main").getByRole("button", { name: "Nouveau rapport" });
  await expect(create, "the smoke account does not manage the smoke workspace").toBeVisible();
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Nouveau rapport" });
  await dialog.getByLabel("Titre du rapport").fill(title);
  await dialog.getByRole("button", { name: "Créer le rapport" }).click();

  // Either the report opens or the dialog says why not, such as the report limit of the plan.
  const heading = page.getByRole("main").getByRole("heading", { level: 1, name: title });
  const refused = dialog.getByRole("alert");
  await expect(heading.or(refused)).toBeVisible({ timeout: 30_000 });
  if (await refused.isVisible())
    throw new Error(`The report was not created: "${await refused.innerText()}"`);
  await expect(page).toHaveURL(/\/fr\/rapports\/[0-9a-f-]{36}$/);
}

/** "Supprimer le rapport" on the report page that is open, then back on the dashboard. */
export async function deleteOpenReport(page: Page, title: string) {
  const zone = page.getByRole("main").getByRole("region", { name: "Supprimer le rapport" });
  await expect(
    zone,
    "the delete action is missing: the smoke account must own the smoke workspace",
  ).toBeVisible();
  await zone.getByRole("button", { name: "Supprimer le rapport" }).click();
  const dialog = page.getByRole("dialog", { name: "Supprimer le rapport ?" });
  await dialog.getByRole("button", { name: "Supprimer le rapport" }).click();

  await expect(page).toHaveURL(/\/fr\/tableau-de-bord\?suppression=rapport$/, { timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: "Le rapport a été supprimé." })).toBeVisible();
  await expect(reportList(page).getByRole("link", { name: title, exact: true })).toHaveCount(0);
}

/**
 * Deletes, through the pages, every report of the smoke workspace whose title
 * starts with "smoke-rapport-": one left by a run that stopped halfway. The
 * smoke report itself and any other report are never touched.
 */
export async function deleteSmokeReports(page: Page) {
  const leftovers = () =>
    reportList(page).getByRole("link", { name: new RegExp(`^${escapeRegExp(REPORT_PREFIX)}`) });
  for (let left = 10; left > 0; left--) {
    await page.goto("/fr/tableau-de-bord");
    await expect(reportList(page)).toBeVisible();
    if ((await leftovers().count()) === 0) return;
    const link = leftovers().first();
    const title = (await link.innerText()).trim();
    await link.click();
    await expect(page).toHaveURL(/\/fr\/rapports\/[0-9a-f-]{36}$/);
    await deleteOpenReport(page, title);
  }
  await page.goto("/fr/tableau-de-bord");
  await expect(leftovers(), "reports of the smoke tests are left in the smoke workspace").toHaveCount(0);
}
