import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor, type TestUser } from "./supabase";

// KRB-195: subsections. An owner adds two under a section, reorders them
// with the keyboard, renames one and writes its instructions, exports the
// report, then deletes the section with its subsections. An expert sees the
// numbers but none of these controls. The export test needs the Storage
// container (CI only).
test.describe.configure({ mode: "serial" });

type Setup = {
  owner: TestUser;
  expert: TestUser;
  workspaceId: string;
  reportId: string;
  contextId: string;
};

let setup: Setup;

test.beforeAll(async () => {
  const [owner, expert] = await Promise.all([createTestUser("Odile Plan"), createTestUser("Ezechiel Sous")]);
  const { workspace_id: workspaceId, report_id: reportId } = await createWorkspaceFor(owner, "Plan Abomey");
  const admin = adminClient();
  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;

  const base = { workspace_id: workspaceId, report_id: reportId };
  const { data: sections, error } = await admin
    .from("report_sections")
    .insert([
      { ...base, title: "Contexte", position: 0, content: "Le siège compte trois bâtiments." },
      { ...base, title: "Analyse", position: 1, content: null },
    ])
    .select("id, title");
  if (error || !sections) throw error ?? new Error("Could not create the sections");
  const context = sections.find((row) => row.title === "Contexte");
  if (!context) throw new Error("Missing section Contexte");

  setup = { owner, expert, workspaceId, reportId, contextId: context.id };
});

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

function regions(page: Page) {
  const main = page.getByRole("main");
  return {
    main,
    toc: main.getByRole("region", { name: "Sommaire" }),
    text: main.getByRole("region", { name: "Texte du rapport" }),
  };
}

/** The text of the report shows with "Aperçu" (KRB-201). */
async function showText(page: Page) {
  await page.getByRole("main").getByRole("button", { name: "Aperçu du texte du rapport" }).click();
}

async function subsections() {
  const { data, error } = await adminClient()
    .from("report_sections")
    .select("id, title, position, instructions")
    .eq("parent_id", setup.contextId)
    .order("position");
  if (error) throw error;
  return data;
}

test("an owner adds two subsections under a section", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(`/fr/rapports/${setup.reportId}`);
  const { main, toc, text } = regions(page);

  await main.getByLabel("Emplacement").selectOption({ label: "Sous-section de 1. Contexte" });
  for (const title of ["Objectifs", "Périmètre"]) {
    await main.getByLabel("Nouvelle section").fill(title);
    await main.getByRole("button", { name: "Ajouter" }).click();
    await expect(
      main.getByText(`Sous-section « ${title} » ajoutée à la fin de la section « Contexte ».`),
    ).toBeAttached();
  }

  const nested = toc.getByRole("list", { name: "Sous-sections de Contexte" });
  await expect(nested.getByRole("listitem")).toContainText(["1.1Objectifs", "1.2Périmètre"]);
  await showText(page);
  await expect(text.getByRole("heading", { level: 3 })).toHaveText(["1. Contexte", "2. Analyse"]);
  await expect(text.getByRole("heading", { level: 4, name: /^1\.\d / })).toHaveText([
    "1.1 Objectifs",
    "1.2 Périmètre",
  ]);
  await expect
    .poll(async () => (await subsections()).map((row) => row.title))
    .toEqual(["Objectifs", "Périmètre"]);
});

test("an owner moves a subsection up within its section", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(`/fr/rapports/${setup.reportId}`);
  const { main, toc, text } = regions(page);
  await showText(page);

  const handle = toc.getByRole("button", { name: "Déplacer la section Périmètre" });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("La section Périmètre passe en position 1 sur 2.")).toBeAttached();
  await page.keyboard.press("Space");

  await expect(main.getByText("Ordre des sections enregistré.")).toBeVisible();
  await expect(text.getByRole("heading", { level: 4, name: /^1\.\d / })).toHaveText([
    "1.1 Périmètre",
    "1.2 Objectifs",
  ]);
  await expect
    .poll(async () => (await subsections()).map((row) => row.title))
    .toEqual(["Périmètre", "Objectifs"]);
});

test("an owner renames a subsection and writes its instructions", async ({ page }) => {
  await signIn(page, setup.owner);
  const [scope] = await subsections();
  if (!scope) throw new Error("Missing subsection");
  await page.goto(`/fr/espaces/${setup.workspaceId}/sections/${scope.id}`);
  const main = page.getByRole("main");

  await expect(main.getByRole("heading", { level: 1 })).toHaveText("1.1 Périmètre");
  await expect(main.getByRole("link", { name: "Sous-section de 1. Contexte" })).toHaveAttribute(
    "href",
    `/fr/espaces/${setup.workspaceId}/sections/${setup.contextId}`,
  );

  await main.getByText("Modifier le titre et les consignes").click();
  await main.getByLabel("Titre", { exact: true }).fill("Périmètre du siège");
  await main.getByLabel("Consignes pour l'IA").fill("Lister les trois bâtiments et leur surface.");
  await main.getByRole("button", { name: "Enregistrer" }).click();

  await expect(main.getByText("Titre et consignes enregistrés.")).toBeVisible();
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("1.1 Périmètre du siège");
  await expect(main.getByText("Lister les trois bâtiments et leur surface.").first()).toBeVisible();
  await expect
    .poll(async () => (await subsections())[0])
    .toMatchObject({
      title: "Périmètre du siège",
      instructions: "Lister les trois bâtiments et leur surface.",
    });
});

test("an expert sees the numbers but cannot add, rename or delete", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(`/fr/rapports/${setup.reportId}`);
  const { main, text } = regions(page);
  await showText(page);
  await expect(text.getByRole("heading", { level: 4, name: /^1\.\d / })).toHaveText([
    "1.1 Périmètre du siège",
    "1.2 Objectifs",
  ]);
  await expect(main.getByLabel("Emplacement")).toHaveCount(0);

  await page.goto(`/fr/espaces/${setup.workspaceId}/sections/${setup.contextId}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText("1. Contexte");
  await expect(page.getByText("Modifier le titre et les consignes")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Supprimer la/ })).toHaveCount(0);
});

// Needs the Storage container, which the local stack here does not run: CI only.
test("the .docx export numbers the subsections under their section", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(`/fr/rapports/${setup.reportId}`);
  const downloading = page.waitForEvent("download");
  await page.getByRole("main").getByRole("button", { name: "Exporter en .docx" }).click();
  const zip = await JSZip.loadAsync(readFileSync(await (await downloading).path()));
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const titles = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join("\n");
  for (const title of ["1. Contexte", "1.1 Périmètre du siège", "1.2 Objectifs", "2. Analyse"]) {
    expect(titles).toContain(title);
  }
});

test("an owner deletes a section with its subsections", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(`/fr/espaces/${setup.workspaceId}/sections/${setup.contextId}`);
  const main = page.getByRole("main");

  await main.getByRole("button", { name: "Supprimer la section" }).click();
  const dialog = page.getByRole("dialog", { name: "Supprimer la section ?" });
  await expect(dialog).toContainText("« Contexte » sera supprimée du rapport");
  await expect(dialog.getByRole("listitem")).toHaveText(["2 sous-sections", "le texte rédigé de 1 section"]);
  await dialog.getByRole("button", { name: "Supprimer" }).click();

  await page.waitForURL(new RegExp(`/fr/rapports/${setup.reportId}$`));
  const { toc, text } = regions(page);
  await showText(page);
  await expect(text.getByRole("heading", { level: 3 })).toHaveText(["1. Analyse"]);
  await expect(toc.getByRole("listitem")).toHaveCount(1);

  const { data, error } = await adminClient()
    .from("report_sections")
    .select("title")
    .eq("report_id", setup.reportId);
  if (error) throw error;
  expect(data).toEqual([{ title: "Analyse" }]);
});
