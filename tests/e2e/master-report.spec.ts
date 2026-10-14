import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor, type TestUser } from "./supabase";

// KRB-18: the master report. Every section in order with its text, keyboard
// reordering for managers, edit links for experts, and the .docx and PDF
// exports. The export tests need the Storage container (CI only).
test.describe.configure({ mode: "serial" });

type Setup = {
  owner: TestUser;
  expert: TestUser;
  workspaceId: string;
  reportId: string;
  ids: Record<"context" | "diagnosis" | "recommendations", string>;
};

let setup: Setup;

test.beforeAll(async () => {
  const [owner, expert] = await Promise.all([
    createTestUser("Mariam Maitre"),
    createTestUser("Ezechiel Expert"),
  ]);
  const { workspace_id: workspaceId, report_id: reportId } = await createWorkspaceFor(
    owner,
    "Synthèse Cotonou",
  );
  const admin = adminClient();
  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;

  // Inserted out of order: the page follows position, not creation. Every row
  // lists the same columns, since a bulk insert sends null for missing ones.
  const base = { workspace_id: workspaceId, report_id: reportId };
  const { data: sections, error } = await admin
    .from("report_sections")
    .insert([
      {
        ...base,
        title: "Recommandations",
        position: 2,
        status: "not_started" as const,
        assigned_to: null,
        content: null,
      },
      {
        ...base,
        title: "Contexte",
        position: 0,
        status: "completed" as const,
        assigned_to: null,
        content: "## Périmètre\n\nLe siège compte **3 bâtiments**.\n\n- Bureaux\n- Atelier",
      },
      {
        ...base,
        title: "Diagnostic",
        position: 1,
        status: "in_progress" as const,
        assigned_to: expert.id,
        content:
          "La consommation a baissé de 12 % en 2025. Détails sur [le portail](https://example.com/conso).",
      },
    ])
    .select("id, title");
  if (error || !sections) throw error ?? new Error("Could not create the sections");
  const id = (title: string) => {
    const section = sections.find((row) => row.title === title);
    if (!section) throw new Error(`Missing section ${title}`);
    return section.id;
  };

  setup = {
    owner,
    expert,
    workspaceId,
    reportId,
    ids: { context: id("Contexte"), diagnosis: id("Diagnostic"), recommendations: id("Recommandations") },
  };
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

function regions(page: Page) {
  const main = page.getByRole("main");
  return {
    main,
    toc: main.getByRole("region", { name: "Sommaire" }),
    text: main.getByRole("region", { name: "Texte du rapport" }),
  };
}

async function positions() {
  const { data, error } = await adminClient()
    .from("report_sections")
    .select("title, position")
    .eq("report_id", setup.reportId)
    .order("position");
  if (error) throw error;
  return data;
}

test("an owner reads the sections in order, with their text, assignee and status", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(reportUrl());
  const { main, toc, text } = regions(page);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Rapport Synthèse Cotonou");

  await expect(toc.getByRole("listitem")).toHaveCount(3);
  await expect(toc.getByRole("listitem")).toContainText(["Contexte", "Diagnostic", "Recommandations"]);
  await expect(text.getByRole("heading", { level: 3 })).toHaveText([
    "1. Contexte",
    "2. Diagnostic",
    "3. Recommandations",
  ]);

  // Status and expert in the table of contents.
  const diagnosis = toc.getByRole("listitem").filter({ hasText: "Diagnostic" });
  await expect(diagnosis.getByText("En cours", { exact: true })).toBeVisible();
  await expect(toc.getByLabel("Expert de la section Diagnostic")).toHaveValue(setup.expert.id);
  await expect(toc.getByLabel("Expert de la section Recommandations")).toHaveValue("");

  // The Markdown is rendered under the section heading; model links stay text.
  const context = text.getByRole("article", { name: "1. Contexte" });
  await expect(context.getByRole("heading", { level: 4, name: "Périmètre" })).toBeVisible();
  await expect(context.locator("strong", { hasText: "3 bâtiments" })).toBeVisible();
  await expect(context.getByRole("listitem")).toHaveText(["Bureaux", "Atelier"]);
  await expect(context.getByText("Terminée", { exact: true })).toBeVisible();
  const diagnosisText = text.getByRole("article", { name: "2. Diagnostic" });
  await expect(diagnosisText.getByText(setup.expert.name)).toBeVisible();
  await expect(diagnosisText.getByText("En cours", { exact: true })).toBeVisible();
  await expect(diagnosisText.getByRole("link", { name: "le portail" })).toHaveCount(0);
  await expect(diagnosisText).toContainText("le portail (https://example.com/conso)");
  const recommendations = text.getByRole("article", { name: "3. Recommandations" });
  await expect(recommendations.getByText("Section non rédigée.")).toBeVisible();
  await expect(recommendations.getByText("Non attribuée")).toBeVisible();

  // The table of contents jumps to the section in the text.
  await toc.getByRole("link", { name: "Recommandations", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#section-${setup.ids.recommendations}$`));
  await expect(recommendations).toBeInViewport();
});

test("an owner moves the last section to the top with the keyboard", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(reportUrl());
  const { main, toc, text } = regions(page);

  const handle = toc.getByRole("button", { name: "Déplacer la section Recommandations" });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("La section Recommandations passe en position 2 sur 3.")).toBeAttached();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("La section Recommandations passe en position 1 sur 3.")).toBeAttached();
  await page.keyboard.press("Space");

  await expect(main.getByText("Ordre des sections enregistré.")).toBeVisible();
  await expect(handle).toBeFocused();
  await expect(toc.getByRole("listitem")).toContainText(["Recommandations", "Contexte", "Diagnostic"]);
  await expect(text.getByRole("heading", { level: 3 })).toHaveText([
    "1. Recommandations",
    "2. Contexte",
    "3. Diagnostic",
  ]);
  await expect.poll(positions).toEqual([
    { title: "Recommandations", position: 0 },
    { title: "Contexte", position: 1 },
    { title: "Diagnostic", position: 2 },
  ]);

  await page.reload();
  await expect(toc.getByRole("listitem")).toContainText(["Recommandations", "Contexte", "Diagnostic"]);
  await expect(text.getByRole("heading", { level: 3 })).toHaveText([
    "1. Recommandations",
    "2. Contexte",
    "3. Diagnostic",
  ]);
});

test("an expert reads every section and edits only their own", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(reportUrl());
  const { main, toc, text } = regions(page);

  await expect(text.getByRole("article")).toHaveCount(3);
  await expect(text.getByRole("article", { name: /Contexte$/ }).getByText("3 bâtiments")).toBeVisible();
  await expect(
    toc.getByRole("listitem").filter({ hasText: "Diagnostic" }).getByText("Votre section"),
  ).toBeVisible();

  // "Modifier" only on their section, in the table of contents and the text.
  const edits = main.getByRole("link", { name: /^Modifier/ });
  await expect(edits).toHaveCount(2);
  for (const link of await edits.all()) {
    await expect(link).toHaveAccessibleName("Modifier la section Diagnostic");
  }
  await expect(main.getByRole("button", { name: /^Déplacer la section/ })).toHaveCount(0);
  await expect(main.getByRole("button", { name: /^Exporter en/ })).toHaveCount(0);
  await expect(main.getByRole("heading", { name: "Exports récents" })).toHaveCount(0);
  await expect(main.getByRole("combobox")).toHaveCount(0);

  await text
    .getByRole("article", { name: /Diagnostic$/ })
    .getByRole("link", { name: /^Modifier/ })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/fr/espaces/${setup.workspaceId}/sections/${setup.ids.diagnosis}$`),
  );
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText("Diagnostic");
});

test("an expert's export request is refused", async ({ page }) => {
  await signIn(page, setup.expert);
  const response = await page.request.post(`/api/reports/${setup.reportId}/exports`, {
    data: { format: "docx" },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({ error: "forbidden" });
});

// Needs the Storage container, which the local stack here does not run: CI only.
test("an owner exports the report as .docx and PDF and finds them in Exports récents", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(reportUrl());
  const { main } = regions(page);

  const checks = [
    { button: "Exporter en .docx", extension: "docx", magic: "PK" },
    { button: "Exporter en PDF", extension: "pdf", magic: "%PDF" },
  ];
  for (const { button, extension, magic } of checks) {
    const downloading = page.waitForEvent("download");
    await main.getByRole("button", { name: button }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^[a-z0-9-]+-\\d{4}-\\d{2}-\\d{2}\\.${extension}$`),
    );
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, magic.length).toString("latin1")).toBe(magic);
    await expect(main.getByText(/le téléchargement commence/)).toBeVisible();
  }

  // Both files show in "Exports récents" with a download link.
  const recent = main.getByRole("region", { name: "Exports récents" });
  await expect(recent.getByRole("listitem")).toHaveCount(2);
  await expect(recent.getByRole("link", { name: /^Télécharger .+\.pdf$/ })).toHaveAttribute(
    "href",
    /^\/api\/exports\/[0-9a-f-]{36}$/,
  );
});
