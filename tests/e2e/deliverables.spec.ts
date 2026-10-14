import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor, signedInClient, type TestUser } from "./supabase";

// KRB-13: deliverables go straight to storage and are checked afterwards.
test.describe.configure({ mode: "serial" });

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX = readFileSync("tests/e2e/fixtures/rapport-etude.docx");

type Setup = {
  owner: TestUser;
  expert: TestUser;
  otherExpert: TestUser;
  stranger: TestUser;
  workspaceId: string;
  sectionId: string;
};

let setup: Setup;

test.beforeAll(async () => {
  const [owner, expert, otherExpert, stranger] = await Promise.all([
    createTestUser("Olivia Owner"),
    createTestUser("Edgar Expert"),
    createTestUser("Odile Autre"),
    createTestUser("Sam Inconnu"),
  ]);
  const {
    api,
    workspace_id: workspaceId,
    report_id: reportId,
  } = await createWorkspaceFor(owner, "Livrables");
  const { error: membersError } = await adminClient()
    .from("workspace_members")
    .insert([
      { workspace_id: workspaceId, user_id: expert.id, role: "expert" },
      { workspace_id: workspaceId, user_id: otherExpert.id, role: "expert" },
    ]);
  if (membersError) throw membersError;
  const { data: section, error } = await api
    .from("report_sections")
    .insert({
      workspace_id: workspaceId,
      report_id: reportId,
      title: "Analyse énergétique",
      assigned_to: expert.id,
    })
    .select("id")
    .single();
  if (error || !section) throw error ?? new Error("Could not create the section");
  setup = { owner, expert, otherExpert, stranger, workspaceId, sectionId: section.id };
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

async function storedFiles() {
  const { data, error } = await adminClient()
    .storage.from("deliverables")
    .list(`${setup.workspaceId}/${setup.sectionId}`);
  if (error) throw error;
  return data.map((file) => file.name);
}

test("an expert uploads a Word file and downloads it back", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Analyse énergétique");
  await expect(main.getByText("Votre section")).toBeVisible();

  await page.getByLabel("Choisir des fichiers").setInputFiles({
    name: "Rapport d'étude.docx",
    mimeType: WORD,
    buffer: DOCX,
  });
  const list = main.getByRole("region", { name: "Livrables", exact: true });
  // exact: the list's status line names the file once its read ends.
  await expect(list.getByText("Rapport d'étude.docx", { exact: true })).toBeVisible();
  await expect(list.getByText("1 fichier")).toBeVisible();

  // Checked and kept: uploaded_at is set and the object sits under {W}/{S}/.
  const { data: row } = await adminClient()
    .from("deliverables")
    .select("uploaded_at, storage_path, size_bytes, parse_status")
    .eq("section_id", setup.sectionId)
    .single();
  expect(row?.uploaded_at).not.toBeNull();
  // Reading the file starts as soon as it is kept (KRB-14).
  expect(["processing", "parsed"]).toContain(row?.parse_status);
  expect(row?.size_bytes).toBe(DOCX.length);
  expect(row?.storage_path).toMatch(
    new RegExp(`^${setup.workspaceId}/${setup.sectionId}/[0-9a-f-]{36}-Rapport-d-etude\\.docx$`),
  );

  const downloading = page.waitForEvent("download");
  await list.getByRole("link", { name: "Télécharger Rapport d'étude.docx" }).click();
  const download = await downloading;
  expect(readFileSync(await download.path())).toEqual(DOCX);
});

test("files that are not what their extension says are refused and removed", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  const before = await storedFiles();

  await page.getByLabel("Choisir des fichiers").setInputFiles([
    { name: "photo.png", mimeType: "image/png", buffer: Buffer.from("ceci n'est pas une image") },
    {
      name: "schema.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>'),
    },
  ]);
  // exact: the upload log for screen readers repeats each reason after the file name.
  await expect(
    page.getByText("Le contenu de ce fichier ne correspond pas à son extension.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^Ce fichier SVG contient du code/)).toBeVisible();

  const list = page.getByRole("main").getByRole("region", { name: "Livrables", exact: true });
  await expect(list.getByText("photo.png", { exact: true })).toHaveCount(0);
  await expect(list.getByText("schema.svg", { exact: true })).toHaveCount(0);
  const { count } = await adminClient()
    .from("deliverables")
    .select("id", { count: "exact", head: true })
    .eq("section_id", setup.sectionId)
    .in("file_name", ["photo.png", "schema.svg"]);
  expect(count).toBe(0);
  expect(await storedFiles()).toEqual(before);
});

test("the form refuses other types and files over 50 MB before sending anything", async ({
  page,
}, testInfo) => {
  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/deliverables/")) requests.push(request.url());
  });

  // Playwright only takes in-memory files up to 50 MB, so the big one is on disk.
  const big = testInfo.outputPath("enorme.pdf");
  writeFileSync(big, Buffer.alloc(50 * 1024 * 1024 + 1));
  await page.getByLabel("Choisir des fichiers").setInputFiles([big]);
  await expect(page.getByText("Ce fichier dépasse 50 Mo.", { exact: true })).toBeVisible();

  await page.getByLabel("Choisir des fichiers").setInputFiles({
    name: "outil.exe",
    mimeType: "application/x-msdownload",
    buffer: Buffer.from("MZ"),
  });
  await expect(page.getByText("Ce type de fichier n'est pas accepté.", { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
});

test("the API only signs uploads for people who can edit the section", async ({ browser }) => {
  const body = { sectionId: setup.sectionId, fileName: "note.docx", size: 1000 };

  // An expert of the workspace who is not assigned to the section.
  const other = await browser.newPage();
  await signIn(other, setup.otherExpert);
  const forbidden = await other.request.post("/api/deliverables/upload-url", { data: body });
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toEqual({ error: "forbidden" });
  await other.goto(sectionUrl());
  await expect(other.getByText(/Cette section est attribuée à un autre expert/)).toBeVisible();
  await expect(other.getByRole("button", { name: "Choisir des fichiers" })).toHaveCount(0);

  // Someone outside the workspace does not even see the section.
  const outsider = await browser.newPage();
  await signIn(outsider, setup.stranger);
  const hidden = await outsider.request.post("/api/deliverables/upload-url", { data: body });
  expect(hidden.status()).toBe(404);

  // The assigned expert still goes through the type and size checks.
  const expert = await browser.newPage();
  await signIn(expert, setup.expert);
  const exe = await expert.request.post("/api/deliverables/upload-url", {
    data: { ...body, fileName: "x.exe" },
  });
  expect(exe.status()).toBe(415);
  const huge = await expert.request.post("/api/deliverables/upload-url", {
    data: { ...body, size: 50 * 1024 * 1024 + 1 },
  });
  expect(huge.status()).toBe(413);
  const signedOut = await browser.newPage();
  const anonymous = await signedOut.request.post("/api/deliverables/upload-url", { data: body });
  expect(anonymous.status()).toBe(401);
});

test("storage keeps the files of a workspace from everyone else", async () => {
  const { data: row } = await adminClient()
    .from("deliverables")
    .select("storage_path")
    .eq("section_id", setup.sectionId)
    .not("uploaded_at", "is", null)
    .single();
  if (!row) throw new Error("The first test should have uploaded a file");

  const stranger = await signedInClient(setup.stranger);
  const { data: listed } = await stranger.storage
    .from("deliverables")
    .list(`${setup.workspaceId}/${setup.sectionId}`);
  expect(listed ?? []).toEqual([]);
  const { data: downloaded } = await stranger.storage.from("deliverables").download(row.storage_path);
  expect(downloaded).toBeNull();
  const { error: uploadError } = await stranger.storage
    .from("deliverables")
    .upload(`${setup.workspaceId}/${setup.sectionId}/intrus.docx`, DOCX, { contentType: WORD });
  expect(uploadError).not.toBeNull();

  // Even the assigned expert cannot write to storage without going through the app.
  const expert = await signedInClient(setup.expert);
  const { error: directError } = await expert.storage
    .from("deliverables")
    .upload(`${setup.workspaceId}/${setup.sectionId}/direct.docx`, DOCX, { contentType: WORD });
  expect(directError).not.toBeNull();
  const { error: replaceError } = await expert.storage
    .from("deliverables")
    .upload(row.storage_path, DOCX, { contentType: WORD, upsert: true });
  expect(replaceError).not.toBeNull();
});
