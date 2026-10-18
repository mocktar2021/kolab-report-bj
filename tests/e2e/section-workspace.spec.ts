import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { testPdf } from "../../src/lib/pdf/test-pdf";
import { adminClient, createTestUser, createWorkspaceFor, type TestUser } from "./supabase";

// KRB-14: files are read after upload, previewed, retried, deleted, and the
// section status changes. KRB-214: PDFs are read too, and one kept before
// that can be read with "Analyser". Needs the storage service (CI).
test.describe.configure({ mode: "serial" });

const DOCX = readFileSync("tests/e2e/fixtures/rapport-etude.docx");
const NOT_A_DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("pas un vrai document"),
]);
// A "#" line shows the text is not read as Markdown.
const PDF = Buffer.from(testPdf([["# Plan masse", "Surface habitable : 1 200 m²"], ["Annexe : coupe A-A"]]));
const SCANNED_PDF = Buffer.from(testPdf([[]], { image: true }));

type Setup = {
  owner: TestUser;
  expert: TestUser;
  otherExpert: TestUser;
  viewer: TestUser;
  workspaceId: string;
  sectionId: string;
};

let setup: Setup;

test.beforeAll(async () => {
  const [owner, expert, otherExpert, viewer] = await Promise.all([
    createTestUser("Olga Owner"),
    createTestUser("Elie Expert"),
    createTestUser("Omar Autre"),
    createTestUser("Vera Viewer"),
  ]);
  const { api, workspace_id: workspaceId, report_id: reportId } = await createWorkspaceFor(owner, "Lecture");
  const { error: membersError } = await adminClient()
    .from("workspace_members")
    .insert([
      { workspace_id: workspaceId, user_id: expert.id, role: "expert" },
      { workspace_id: workspaceId, user_id: otherExpert.id, role: "expert" },
      { workspace_id: workspaceId, user_id: viewer.id, role: "viewer" },
    ]);
  if (membersError) throw membersError;
  const { data: section, error } = await api
    .from("report_sections")
    .insert({
      workspace_id: workspaceId,
      report_id: reportId,
      title: "Bilan thermique",
      assigned_to: expert.id,
    })
    .select("id")
    .single();
  if (error || !section) throw error ?? new Error("Could not create the section");
  setup = { owner, expert, otherExpert, viewer, workspaceId, sectionId: section.id };
});

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

function sectionUrl() {
  return `/fr/espaces/${setup.workspaceId}/sections/${setup.sectionId}`;
}

function filesList(page: Page) {
  return page.getByRole("main").getByRole("region", { name: "Livrables", exact: true });
}

/** The list item of a file, found by its name. */
function fileItem(page: Page, name: string) {
  return filesList(page).getByRole("listitem").filter({ hasText: name });
}

async function workbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Consommations");
  sheet.addRow(["Bâtiment", "kWh/an"]);
  sheet.addRow(["Siège", 182000]);
  sheet.addRow(["Annexe", 45000]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

test("Word, Excel and PDF files are read and previewed, a scanned PDF is kept as is", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  await page.getByLabel("Choisir des fichiers").setInputFiles([
    { name: "Rapport d'étude.docx", mimeType: "application/octet-stream", buffer: DOCX },
    { name: "Consommations.xlsx", mimeType: "application/octet-stream", buffer: await workbook() },
    { name: "Plan masse.pdf", mimeType: "application/pdf", buffer: PDF },
    { name: "Plan scanné.pdf", mimeType: "application/pdf", buffer: SCANNED_PDF },
  ]);

  // The page refreshes itself while files are being read.
  const word = fileItem(page, "Rapport d'étude.docx");
  await expect(word.getByText("Analysé", { exact: true })).toBeVisible({ timeout: 30_000 });
  await word.getByRole("button", { name: "Aperçu de Rapport d'étude.docx" }).click();
  await expect(word.getByRole("heading", { name: "Étude énergétique du siège" })).toBeVisible();
  await expect(word.getByText(/consomme 182 kWh\/m² par an/)).toBeVisible();

  const excel = fileItem(page, "Consommations.xlsx");
  await expect(excel.getByText("Analysé", { exact: true })).toBeVisible({ timeout: 30_000 });
  await excel.getByRole("button", { name: "Aperçu de Consommations.xlsx" }).click();
  await expect(excel.getByRole("heading", { name: "Consommations" })).toBeVisible();
  await expect(excel.getByRole("cell", { name: "182000" })).toBeVisible();

  // The text of a PDF shows as plain text: no heading.
  const pdf = fileItem(page, "Plan masse.pdf");
  await expect(pdf.getByText("Analysé", { exact: true })).toBeVisible({ timeout: 30_000 });
  await pdf.getByRole("button", { name: "Aperçu de Plan masse.pdf" }).click();
  await expect(pdf.locator("pre")).toContainText("# Plan masse\nSurface habitable : 1 200 m²");
  await expect(pdf.locator("pre")).toContainText("Annexe : coupe A-A");
  await expect(pdf.getByRole("heading")).toHaveCount(0);

  const scanned = fileItem(page, "Plan scanné.pdf");
  await expect(scanned.getByText("Non analysé")).toBeVisible({ timeout: 30_000 });
  await expect(scanned.getByText("Ce PDF ne contient pas de texte lisible", { exact: false })).toBeVisible();
  await expect(scanned.getByRole("button", { name: /Aperçu|Analyser|Relancer/ })).toHaveCount(0);
  await expect(scanned.getByRole("link", { name: "Télécharger Plan scanné.pdf" })).toBeVisible();

  const { data: rows } = await adminClient()
    .from("deliverables")
    .select("file_name, parse_status, parsed_content, parse_meta")
    .eq("section_id", setup.sectionId);
  const parsed = new Map((rows ?? []).map((row) => [row.file_name, row]));
  expect(parsed.get("Rapport d'étude.docx")?.parsed_content).toContain("# Étude énergétique du siège");
  expect(parsed.get("Consommations.xlsx")?.parsed_content).toContain("| Siège | 182000 |");
  expect(parsed.get("Consommations.xlsx")?.parse_meta).toMatchObject({
    kind: "spreadsheet",
    sheets: [{ name: "Consommations", rows: 3, keptRows: 3 }],
  });
  expect(parsed.get("Plan masse.pdf")?.parse_status).toBe("parsed");
  expect(parsed.get("Plan masse.pdf")?.parse_meta).toMatchObject({ kind: "pdf", pages: 2, pagesRead: 2 });
  expect(parsed.get("Plan scanné.pdf")?.parse_status).toBe("skipped");
  expect(parsed.get("Plan scanné.pdf")?.parse_meta).toMatchObject({ kind: "pdf", reason: "noText" });
});

test("a PDF kept before PDFs were read is read with Analyser", async ({ page }) => {
  // The file as KRB-14 left it: kept, with the meta of a file the app does not read.
  const { error } = await adminClient()
    .from("deliverables")
    .update({
      parse_status: "skipped",
      parsed_content: null,
      parse_meta: { version: 1, kind: "stored", words: 0, characters: 0, tokenEstimate: 0, truncated: false },
    })
    .eq("section_id", setup.sectionId)
    .eq("file_name", "Plan masse.pdf");
  if (error) throw error;

  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  const pdf = fileItem(page, "Plan masse.pdf");
  await expect(pdf.getByText("Non analysé")).toBeVisible();
  await expect(pdf.getByText("Ce fichier n'a pas encore été lu.", { exact: false })).toBeVisible();
  await pdf.getByRole("button", { name: "Analyser Plan masse.pdf" }).click();
  await expect(pdf.getByText("Analysé", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(pdf.getByRole("button", { name: "Analyser Plan masse.pdf" })).toHaveCount(0);

  const { data } = await adminClient()
    .from("deliverables")
    .select("parse_status, parsed_content")
    .eq("section_id", setup.sectionId)
    .eq("file_name", "Plan masse.pdf")
    .single();
  expect(data?.parse_status).toBe("parsed");
  expect(data?.parsed_content).toContain("Surface habitable : 1 200 m²");

  // A PDF read and found without text gets no button.
  const scanned = fileItem(page, "Plan scanné.pdf");
  await expect(scanned.getByRole("button", { name: /Analyser/ })).toHaveCount(0);
});

test("a file that cannot be read shows an error and can be retried", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  await page.getByLabel("Choisir des fichiers").setInputFiles({
    name: "Annexe abîmée.docx",
    mimeType: "application/octet-stream",
    buffer: NOT_A_DOCX,
  });
  const broken = fileItem(page, "Annexe abîmée.docx");
  await expect(broken.getByText("Échec")).toBeVisible({ timeout: 30_000 });
  await expect(
    broken.getByText("Le fichier est endommagé ou n'est pas un document Office valide."),
  ).toBeVisible();

  const brokenRow = async () => {
    const { data } = await adminClient()
      .from("deliverables")
      .select("parse_status, parse_error, updated_at")
      .eq("section_id", setup.sectionId)
      .eq("file_name", "Annexe abîmée.docx")
      .single();
    return data;
  };
  const before = await brokenRow();
  expect(before?.parse_status).toBe("failed");

  // "Échec" is already on screen, so wait for the second read to fail in the
  // database: the claim and the failure both move updated_at.
  await broken.getByRole("button", { name: "Relancer l'analyse de Annexe abîmée.docx" }).click();
  await expect
    .poll(
      async () => {
        const row = await brokenRow();
        return row?.updated_at !== before?.updated_at && row?.parse_status === "failed";
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  expect((await brokenRow())?.parse_error).toBe("corrupt");
  await expect(broken.getByText("Échec")).toBeVisible({ timeout: 30_000 });
});

test("the expert sets the section status and deletes a file", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(sectionUrl());

  await page.getByLabel("Statut de la section").selectOption("completed");
  await expect
    .poll(async () => {
      const { data } = await adminClient()
        .from("report_sections")
        .select("status, completed_at")
        .eq("id", setup.sectionId)
        .single();
      return data?.status === "completed" && data.completed_at !== null;
    })
    .toBe(true);
  await page.reload();
  await expect(page.getByLabel("Statut de la section")).toHaveValue("completed");

  const { data: before } = await adminClient()
    .from("deliverables")
    .select("storage_path")
    .eq("section_id", setup.sectionId)
    .eq("file_name", "Plan masse.pdf")
    .single();
  const pdf = fileItem(page, "Plan masse.pdf");
  await pdf.getByRole("button", { name: "Supprimer Plan masse.pdf" }).click();
  await page
    .getByRole("dialog", { name: "Supprimer Plan masse.pdf ?" })
    .getByRole("button", { name: "Supprimer", exact: true })
    .click();
  // The dialog stays open until the deletion answers. While it is open, the
  // rest of the page is hidden from role queries, so wait for it first.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(filesList(page).getByText("Plan masse.pdf", { exact: true })).toHaveCount(0);

  // The stored file goes with the row.
  const { data: left } = await adminClient()
    .storage.from("deliverables")
    .list(`${setup.workspaceId}/${setup.sectionId}`);
  expect((left ?? []).map((object) => object.name)).not.toContain(before?.storage_path.split("/").pop());
});

test("viewers and other experts read the section without changing anything", async ({ browser }) => {
  for (const user of [setup.viewer, setup.otherExpert]) {
    const page = await browser.newPage();
    await signIn(page, user);
    await page.goto(sectionUrl());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("1. Bilan thermique");
    await expect(page.getByLabel("Statut de la section")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Choisir des fichiers" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Supprimer/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Relancer/ })).toHaveCount(0);

    // Reading is open to every member.
    const word = fileItem(page, "Rapport d'étude.docx");
    await word.getByRole("button", { name: "Aperçu de Rapport d'étude.docx" }).click();
    await expect(word.getByRole("heading", { name: "Étude énergétique du siège" })).toBeVisible();
    await page.close();
  }
});
