import { expect, test } from "@playwright/test";
import {
  deleteSmokeFiles,
  exportDocx,
  generateAndDiscardDraft,
  openSmokeSection,
  previewShowsContent,
  uploadMarkdown,
  waitUntilParsed,
} from "./section";
import { FILE_PREFIX, hasAccount, runTag, smoke } from "./support";

// Signed in as the smoke account (session from sign-in.setup.ts), in its
// smoke workspace, through the pages only. What a run leaves behind: one
// .docx export, removed by the storage cleanup job after 90 days, and with
// SMOKE_AI one discarded generation in the AI usage history. Every uploaded
// file is deleted after its test, even a failed one, or else by the next run.

test.skip(!hasAccount, "Set SMOKE_EMAIL and SMOKE_PASSWORD to run the signed-in checks");

/** Section whose smoke files go after the current test, once the test has opened it. */
let sectionToClean: string | undefined;

// After the test, not in a finally block: the failure screenshot is taken
// when the test function ends, so it shows the failure, not the cleanup.
test.afterEach(async ({ page }) => {
  const sectionPath = sectionToClean;
  sectionToClean = undefined;
  if (sectionPath) await deleteSmokeFiles(page, sectionPath);
});

test.describe("signed in", { tag: "@signed-in" }, () => {
  test("the dashboard shows the smoke workspace and its report", async ({ page }) => {
    await page.goto("/fr/tableau-de-bord");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Tableau de bord", level: 1 })).toBeVisible();
    await expect(main.getByText(/^Avancement des sections de l'espace /)).toBeVisible();
    await expect(main.getByRole("region", { name: "Indicateurs des sections" })).toBeVisible();
    const reports = main.getByRole("region", { name: "Rapports" });
    await expect(reports.getByRole("link").first()).toBeVisible();
    await expect(reports.getByRole("progressbar").first()).toBeVisible();
  });

  test("the workspace wizard checks each step, and nothing is created", async ({ page }) => {
    // Submitting would create an organization that no user can delete, so
    // the check stops before the last button. The smoke workspace itself
    // was made with this wizard (docs/operations/smoke-tests.md).
    await page.goto("/fr/espaces/nouveau");
    await page.getByLabel("Nom de l'organisation").fill("A");
    await page.getByRole("button", { name: "Suivant" }).click();
    await expect(page.getByText("Saisissez entre 2 et 120 caractères.")).toBeVisible();
    await page.getByLabel("Nom de l'organisation").fill("Cabinet des tests de fumée");
    await page.getByRole("button", { name: "Suivant" }).click();
    await page.getByLabel("Nom de l'espace de travail").fill("Espace jamais créé");
    await page.getByRole("button", { name: "Suivant" }).click();
    await page.getByLabel("Titre du rapport").fill("Rapport jamais créé");
    await expect(page.getByRole("button", { name: "Créer l'espace de travail" })).toBeEnabled();
    await expect(page).toHaveURL(/\/fr\/espaces\/nouveau$/);
  });

  test("a Markdown file is uploaded and read, and the report exports as .docx", async ({ page }) => {
    test.setTimeout(180_000);
    const fileName = `${FILE_PREFIX}${runTag()}.md`;
    const { reportPath, sectionPath } = await openSmokeSection(page);
    sectionToClean = sectionPath;
    await uploadMarkdown(page, fileName);
    await waitUntilParsed(page, fileName);
    await previewShowsContent(page, fileName);
    await exportDocx(page, reportPath);
  });
});

test.describe("AI draft", { tag: "@ai" }, () => {
  test.skip(!smoke.ai, "Set SMOKE_AI=true to call the model (it costs money)");

  test("a draft streams to « Brouillon prêt » and is discarded", async ({ page }) => {
    test.setTimeout(240_000);
    const fileName = `${FILE_PREFIX}ia-${runTag()}.md`;
    const { sectionPath } = await openSmokeSection(page);
    sectionToClean = sectionPath;
    await uploadMarkdown(page, fileName);
    await waitUntilParsed(page, fileName);
    await generateAndDiscardDraft(page);
  });
});
