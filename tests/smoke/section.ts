import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { FILE_PREFIX, SMOKE_SECTION_TITLE, escapeRegExp } from "./support";

// Steps of the signed-in checks on the smoke section, through the pages only,
// with the smoke account's own rights. Same labels as the e2e specs
// (tests/e2e/section-workspace.spec.ts, tests/e2e/master-report.spec.ts).

/**
 * Heading of the uploaded file. The preview shows Markdown files as written,
 * in plain text (KRB-14), so it comes back as the line `# Contrôle après déploiement`.
 */
export const DELIVERABLE_HEADING = "Contrôle après déploiement";

const DELIVERABLE = `# ${DELIVERABLE_HEADING}

Fichier déposé par les tests de fumée de KolabReport. Il est supprimé à la fin du test.

## Mesures

| Poste | Consommation |
| --- | --- |
| Climatisation | 58 % |
| Éclairage | 21 % |
`;

export type SmokeSection = { reportPath: string; sectionPath: string };

function filesList(page: Page) {
  return page.getByRole("main").getByRole("region", { name: "Livrables", exact: true });
}

/** The list item of a file, found by its name. */
function fileItem(page: Page, name: string) {
  return filesList(page).getByRole("listitem").filter({ hasText: name });
}

/**
 * Opens the first report of the smoke workspace from the dashboard, then its
 * first section. On the first run of an environment the report has no section
 * yet: the owner adds one, which later runs reuse.
 */
export async function openSmokeSection(page: Page): Promise<SmokeSection> {
  await page.goto("/fr/tableau-de-bord");
  const main = page.getByRole("main");
  const reports = main.getByRole("region", { name: "Rapports" });
  await expect(reports.getByRole("link").first(), "the smoke workspace has no report").toBeVisible();
  await reports.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/fr\/rapports\/[0-9a-f-]{36}$/);
  const reportPath = new URL(page.url()).pathname;

  const toc = main.getByRole("region", { name: "Sommaire" });
  await expect(toc).toBeVisible();
  // A final report refuses uploads.
  const frozen = main.getByText(/^Ce rapport est final/);
  await expect(frozen, "the smoke report is final: reopen it as a draft").toHaveCount(0);
  const edit = toc.getByRole("link", { name: /^Modifier la section / });
  if ((await edit.count()) === 0) {
    await page.getByLabel("Nouvelle section").fill(SMOKE_SECTION_TITLE);
    await page.getByRole("button", { name: "Ajouter" }).click();
    await expect(toc.getByText(SMOKE_SECTION_TITLE, { exact: true })).toBeVisible();
  }
  await edit.first().click();
  await expect(page).toHaveURL(/\/fr\/espaces\/[0-9a-f-]{36}\/sections\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
  return { reportPath, sectionPath: new URL(page.url()).pathname };
}

/** Uploads a small Markdown file through "Choisir des fichiers". */
export async function uploadMarkdown(page: Page, name: string) {
  await page.getByLabel("Choisir des fichiers").setInputFiles({
    name,
    mimeType: "text/markdown",
    buffer: Buffer.from(DELIVERABLE),
  });
  // exact: the list's status line names the file once its read ends.
  const listed = filesList(page).getByText(name, { exact: true });
  // The uploader's screen reader log says why a file was refused.
  const refused = page.getByRole("log").getByText(new RegExp(`^${escapeRegExp(name)} n'a pas été ajouté`));
  await expect(listed.or(refused)).toBeVisible({ timeout: 60_000 });
  if (await refused.isVisible()) throw new Error(`The upload failed: "${await refused.innerText()}"`);
}

/** Waits for the read of the file to end, and fails on any state but "Analysé". */
export async function waitUntilParsed(page: Page, name: string) {
  const item = fileItem(page, name);
  // The page refreshes itself while a file is being read.
  const ended = item.getByText(/^(Analysé|Échec|Bloqué|Non analysé)$/);
  await expect(ended).toBeVisible({ timeout: 90_000 });
  await expect(ended, `the read of ${name} did not succeed`).toHaveText("Analysé");
}

/** Opens the preview of the file and finds the text the app read from it. */
export async function previewShowsContent(page: Page, name: string) {
  const item = fileItem(page, name);
  await item.getByRole("button", { name: `Aperçu de ${name}` }).click();
  // Plain text, not a heading: the first line keeps its "#".
  await expect(item.getByText(`# ${DELIVERABLE_HEADING}`)).toBeVisible();
}

/** "Exporter en .docx" on the report page, and checks the downloaded file. */
export async function exportDocx(page: Page, reportPath: string) {
  await page.goto(reportPath);
  const main = page.getByRole("main");
  const downloading = page.waitForEvent("download", { timeout: 60_000 });
  await main.getByRole("button", { name: "Exporter en .docx" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.docx$/);
  const bytes = readFileSync(await download.path());
  // A .docx is a zip file.
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  await expect(main.getByText(/le téléchargement commence/)).toBeVisible();
}

/**
 * Asks for an AI draft, waits for it to stream in, then discards it. The
 * section keeps its text; the generation stays in the AI usage history.
 */
export async function generateAndDiscardDraft(page: Page) {
  const panel = page.getByRole("main").getByRole("region", { name: "Brouillon de l'IA" });
  const generate = panel.getByRole("button", { name: "Générer un brouillon" });
  await expect(generate, "drafts are off or have no published template on this site").toBeEnabled();
  await generate.click();
  const ready = panel.getByText("Brouillon prêt. Relisez-le avant de l'accepter.");
  const failed = panel.getByRole("alert");
  await expect(ready.or(failed)).toBeVisible({ timeout: 120_000 });
  if (await failed.isVisible()) throw new Error(`The draft failed: "${await failed.innerText()}"`);

  await panel.getByRole("button", { name: "Rejeter" }).click();
  await panel.getByRole("button", { name: "Confirmer le rejet" }).click();
  await expect(panel.getByText("Brouillon rejeté.", { exact: false })).toBeVisible();
}

/**
 * Deletes, through the page, every file of the section whose name starts with
 * "smoke-": this run's, and any left by an earlier run that stopped halfway.
 * Nothing else in the section is touched.
 */
export async function deleteSmokeFiles(page: Page, sectionPath: string) {
  await page.goto(sectionPath);
  const list = filesList(page);
  await expect(list).toBeVisible();
  const deleteButtons = list.getByRole("button", { name: new RegExp(`^Supprimer ${FILE_PREFIX}`) });
  for (let left = 20; left > 0 && (await deleteButtons.count()) > 0; left--) {
    const button = deleteButtons.first();
    const name = ((await button.getAttribute("aria-label")) ?? "").replace(/^Supprimer /, "");
    await button.click();
    await page
      .getByRole("dialog", { name: `Supprimer ${name} ?` })
      .getByRole("button", { name: "Supprimer", exact: true })
      .click();
    // The dialog stays open until the deletion answers, and hides the page from role queries meanwhile.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(list.getByText(name, { exact: true })).toHaveCount(0);
  }
  await expect(deleteButtons, "files of the smoke tests are left in the section").toHaveCount(0);
}
