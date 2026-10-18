import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import { pngImage } from "../../src/lib/export/test-images";
import { adminClient, createTestUser, createWorkspaceFor, type TestUser } from "./supabase";

// KRB-216: PNG and JPEG deliverables in a section's text. "Insérer dans le
// texte" in the deliverable list, a paste in the editor, the image in the
// section view and the report, and in the .docx export. Uploads and exports
// need the Storage container (CI only).
test.describe.configure({ mode: "serial" });

type Setup = { owner: TestUser; workspaceId: string; reportId: string; sectionId: string };

let setup: Setup;

const PIXEL = "https://example.com/pixel.png";

test.beforeAll(async () => {
  const owner = await createTestUser("Inès Images");
  const { workspace_id: workspaceId, report_id: reportId } = await createWorkspaceFor(owner, "Images Ouidah");
  const { data: section, error } = await adminClient()
    .from("report_sections")
    .insert({
      workspace_id: workspaceId,
      report_id: reportId,
      title: "Relevés de terrain",
      assigned_to: owner.id,
      // An image of another site: its caption shows, it is never fetched.
      content: `Introduction.\n\n![Pixel espion](${PIXEL})`,
    })
    .select("id")
    .single();
  if (error || !section) throw error ?? new Error("Could not create the section");
  setup = { owner, workspaceId, reportId, sectionId: section.id };
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

async function sectionContent(): Promise<string> {
  const { data, error } = await adminClient()
    .from("report_sections")
    .select("content")
    .eq("id", setup.sectionId)
    .single();
  if (error) throw error;
  return data.content ?? "";
}

async function deliverableId(name: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("deliverables")
    .select("id")
    .eq("section_id", setup.sectionId)
    .eq("file_name", name)
    .single();
  if (error) throw error;
  return data.id;
}

/** The image was loaded and decoded, so the route let the browser through to storage. */
async function expectLoaded(image: Locator) {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth))
    .toBeGreaterThan(0);
}

/** Pastes files the way a browser does after Ctrl+V on a copied image. */
async function paste(target: Locator, files: { name: string; type: string; bytes: number[] }[]) {
  await target.evaluate((element, list) => {
    const data = new DataTransfer();
    for (const file of list)
      data.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, files);
}

test("an owner inserts a PNG deliverable and finds it in the section, the report and the .docx", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://example.com/")) external.push(request.url());
  });
  await signIn(page, setup.owner);
  await page.goto(sectionUrl());
  const main = page.getByRole("main");

  await page.getByLabel("Choisir des fichiers").setInputFiles({
    name: "Façade nord.png",
    mimeType: "image/png",
    buffer: pngImage(64, 32),
  });
  const list = main.getByRole("region", { name: "Livrables", exact: true });
  await expect(list.getByText("Façade nord.png", { exact: true })).toBeVisible();
  const id = await deliverableId("Façade nord.png");

  // The editor opens with the image after the text.
  await list.getByRole("button", { name: "Insérer Façade nord.png dans le texte" }).click();
  const field = main.getByRole("textbox", { name: "Texte de la section", exact: true });
  await expectLoaded(field.getByRole("img", { name: "Façade nord" }));
  await expect(main.getByText("Image insérée dans le texte. Enregistrez pour la garder.")).toBeVisible();
  await main.getByRole("button", { name: "Enregistrer" }).click();
  await expect(main.getByText("Texte enregistré.")).toBeVisible();
  expect(await sectionContent()).toBe(
    `Introduction.\n\n![Pixel espion](${PIXEL})\n\n![Façade nord](/api/deliverables/${id}/file)`,
  );

  // The section view shows it, and the other image as its caption only.
  await expectLoaded(main.getByRole("img", { name: "Façade nord" }));
  await expect(main.getByText("Pixel espion")).toBeVisible();
  expect(external).toEqual([]);

  // The text of the report shows it too.
  await page.goto(`/fr/rapports/${setup.reportId}`);
  await main.getByRole("button", { name: "Aperçu du texte du rapport" }).click();
  const text = main.getByRole("region", { name: "Texte du rapport" });
  await expectLoaded(text.getByRole("img", { name: "Façade nord" }));

  // The .docx holds the image in word/media, and nothing of the other site.
  const downloading = page.waitForEvent("download");
  await main.getByRole("button", { name: "Exporter en .docx" }).click();
  const download = await downloading;
  const zip = await JSZip.loadAsync(readFileSync(await download.path()));
  const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/"));
  expect(media).toHaveLength(1);
  expect(media[0]).toMatch(/\.png$/);
  const documentXml = await zip.file("word/document.xml")!.async("string");
  expect(documentXml).toContain('descr="Façade nord"');
  expect(documentXml).toContain("Pixel espion");
  expect(documentXml).not.toContain("example.com");
  expect(external).toEqual([]);
});

test("a PNG pasted in the editor is uploaded as a deliverable and goes in the text", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(sectionUrl());
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Modifier le texte" }).click();
  const field = main.getByRole("textbox", { name: "Texte de la section", exact: true });
  await expect(field).toBeFocused();
  // The cursor at the start: the image goes before the introduction.
  await paste(field, [{ name: "collage.png", type: "image/png", bytes: [...pngImage(40, 20)] }]);

  await expectLoaded(field.getByRole("img", { name: "collage" }));
  const list = main.getByRole("region", { name: "Livrables", exact: true });
  await expect(list.getByText("collage.png", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Enregistrer" }).click();
  await expect(main.getByText("Texte enregistré.")).toBeVisible();
  const id = await deliverableId("collage.png");
  expect(await sectionContent()).toMatch(
    new RegExp(`^!\\[collage\\]\\(/api/deliverables/${id}/file\\)\\n\\nIntroduction\\.`),
  );
});

test("a pasted file that is not a PNG or a JPEG is refused before any upload", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(sectionUrl());
  const main = page.getByRole("main");
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/deliverables/upload-url")) uploads.push(request.url());
  });
  await main.getByRole("button", { name: "Modifier le texte" }).click();
  const field = main.getByRole("textbox", { name: "Texte de la section", exact: true });
  await expect(field).toBeFocused();
  await paste(field, [{ name: "schema.svg", type: "image/svg+xml", bytes: [...Buffer.from("<svg/>")] }]);

  await expect(
    main.getByText(/^schema\.svg n'a pas été ajoutée au texte : Seules les images PNG et JPEG/),
  ).toBeVisible();
  expect(uploads).toEqual([]);
});
