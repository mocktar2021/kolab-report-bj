import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor, signedInClient, type TestUser } from "./supabase";

// KRB-18: the text of a section, edited by hand. A save sends back the
// version the editor loaded (content_updated_at), so two people saving the
// same section see a conflict instead of overwriting each other.
test.describe.configure({ mode: "serial" });

type Setup = {
  owner: TestUser;
  expert: TestUser;
  secondExpert: TestUser;
  otherExpert: TestUser;
  viewer: TestUser;
  workspaceId: string;
  sectionA: string;
  sectionB: string;
};

let setup: Setup;

const FIRST_TEXT = "## Constats\n\nLe bâtiment administratif consomme 412 MWh par an.";
const EDITOR_LABEL = "Texte de la section (Markdown)";
const CONFLICT_TITLE = "Quelqu'un a modifié cette section pendant que vous écriviez.";

test.beforeAll(async () => {
  const [owner, expert, secondExpert, otherExpert, viewer] = await Promise.all([
    createTestUser("Olivia Owner"),
    createTestUser("Emile Expert"),
    createTestUser("Sarah Seconde"),
    createTestUser("Omer Autre"),
    createTestUser("Valentin Lecteur"),
  ]);
  const { api, workspace_id: workspaceId, report_id: reportId } = await createWorkspaceFor(owner, "Edition");
  const { error: membersError } = await adminClient()
    .from("workspace_members")
    .insert([
      { workspace_id: workspaceId, user_id: expert.id, role: "expert" },
      { workspace_id: workspaceId, user_id: secondExpert.id, role: "expert" },
      { workspace_id: workspaceId, user_id: otherExpert.id, role: "expert" },
      { workspace_id: workspaceId, user_id: viewer.id, role: "viewer" },
    ]);
  if (membersError) throw membersError;
  const { data: sections, error } = await api
    .from("report_sections")
    .insert([
      { workspace_id: workspaceId, report_id: reportId, title: "Bilan énergétique", assigned_to: expert.id },
      {
        workspace_id: workspaceId,
        report_id: reportId,
        title: "Plan d'action",
        assigned_to: secondExpert.id,
      },
    ])
    .select("id, title");
  if (error || !sections) throw error ?? new Error("Could not create the sections");
  const sectionA = sections.find((section) => section.title === "Bilan énergétique")?.id;
  const sectionB = sections.find((section) => section.title === "Plan d'action")?.id;
  if (!sectionA || !sectionB) throw new Error("Missing a section");
  setup = { owner, expert, secondExpert, otherExpert, viewer, workspaceId, sectionA, sectionB };
});

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

function sectionUrl(sectionId: string) {
  return `/fr/espaces/${setup.workspaceId}/sections/${sectionId}`;
}

async function sectionRow(sectionId: string) {
  const { data, error } = await adminClient()
    .from("report_sections")
    .select("content, status, content_updated_at")
    .eq("id", sectionId)
    .single();
  if (error) throw error;
  return data;
}

/** Opens the editor of the section on the page and replaces its text. */
async function write(page: Page, text: string) {
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Modifier le texte" }).click();
  const editor = main.getByLabel(EDITOR_LABEL);
  await expect(editor).toBeFocused();
  await editor.fill(text);
}

test("the assigned expert writes the text, saves it, and the section moves to in progress", async ({
  page,
}) => {
  expect(await sectionRow(setup.sectionA)).toMatchObject({ content: null, status: "not_started" });

  await signIn(page, setup.expert);
  await page.goto(sectionUrl(setup.sectionA));
  const main = page.getByRole("main");
  await expect(main.getByText("Aucun contenu pour l'instant.")).toBeVisible();
  await write(page, FIRST_TEXT);
  await main.getByRole("button", { name: "Enregistrer" }).click();

  await expect(main.getByText("Texte enregistré.")).toBeVisible();
  await expect(main.getByLabel(EDITOR_LABEL)).toHaveCount(0);
  await expect(main.getByRole("heading", { level: 3, name: "Constats" })).toBeVisible();
  await expect(main.getByText("Le bâtiment administratif consomme 412 MWh par an.")).toBeVisible();
  await expect(main.getByLabel("Statut de la section")).toHaveValue("in_progress");
  expect(await sectionRow(setup.sectionA)).toMatchObject({ content: FIRST_TEXT, status: "in_progress" });

  await page.reload();
  await expect(main.getByText("Le bâtiment administratif consomme 412 MWh par an.")).toBeVisible();
});

test("a save over a newer version shows a conflict, and the expert keeps their version", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(sectionUrl(setup.sectionA));
  const main = page.getByRole("main");
  const mine = `${FIRST_TEXT}\n\nAjout de l'expert sur la climatisation.`;
  await write(page, mine);

  // Meanwhile someone else saves the section: the trigger moves its version.
  const before = await sectionRow(setup.sectionA);
  const theirs = `${FIRST_TEXT}\n\nRelu par la responsable du rapport.`;
  const { error } = await adminClient()
    .from("report_sections")
    .update({ content: theirs })
    .eq("id", setup.sectionA);
  if (error) throw error;
  expect((await sectionRow(setup.sectionA)).content_updated_at).not.toBe(before.content_updated_at);

  await main.getByRole("button", { name: "Enregistrer" }).click();
  const title = main.getByRole("heading", { name: CONFLICT_TITLE });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  await expect(
    main.getByText("Comparez les deux versions avant d'enregistrer.", { exact: false }),
  ).toBeVisible();
  const compare = main.getByRole("group", { name: "Votre version et la version enregistrée" });
  await expect(compare.getByRole("region", { name: "Votre version" })).toContainText(
    "Ajout de l'expert sur la climatisation.",
  );
  await expect(compare.getByRole("region", { name: "Version enregistrée" })).toContainText(
    "Relu par la responsable du rapport.",
  );
  await expect(main.getByLabel(EDITOR_LABEL)).toHaveValue(mine);
  // Nothing was written over the other save.
  expect((await sectionRow(setup.sectionA)).content).toBe(theirs);

  await main.getByRole("button", { name: "Garder ma version" }).click();
  await expect(main.getByText("Votre version est enregistrée.")).toBeVisible();
  await expect(main.getByRole("heading", { name: CONFLICT_TITLE })).toHaveCount(0);
  await expect(main.getByText("Ajout de l'expert sur la climatisation.")).toBeVisible();
  expect((await sectionRow(setup.sectionA)).content).toBe(mine);
});

test("two experts saving two sections at the same time don't touch each other's text", async ({
  page,
  browser,
}, testInfo) => {
  const second = await browser.newContext({ baseURL: testInfo.project.use.baseURL, locale: "fr-FR" });
  try {
    const otherPage = await second.newPage();
    await signIn(page, setup.expert);
    await signIn(otherPage, setup.secondExpert);
    await page.goto(sectionUrl(setup.sectionA));
    await otherPage.goto(sectionUrl(setup.sectionB));

    // Both editors are open before either saves.
    const textA = "## Constats\n\nConsommation stable en 2026.";
    const textB = "## Actions\n\nRemplacer les groupes froids en 2027.";
    await write(page, textA);
    await write(otherPage, textB);

    await page.getByRole("main").getByRole("button", { name: "Enregistrer" }).click();
    await otherPage.getByRole("main").getByRole("button", { name: "Enregistrer" }).click();
    for (const current of [page, otherPage]) {
      await expect(current.getByRole("main").getByText("Texte enregistré.")).toBeVisible();
      await expect(current.getByRole("heading", { name: CONFLICT_TITLE })).toHaveCount(0);
    }
    await expect(page.getByRole("main").getByText("Consommation stable en 2026.")).toBeVisible();
    await expect(
      otherPage.getByRole("main").getByText("Remplacer les groupes froids en 2027."),
    ).toBeVisible();

    expect((await sectionRow(setup.sectionA)).content).toBe(textA);
    expect(await sectionRow(setup.sectionB)).toMatchObject({ content: textB, status: "in_progress" });
  } finally {
    await second.close();
  }
});

test("viewers and experts of other sections read the text without an editor", async ({ page }) => {
  const before = await sectionRow(setup.sectionA);

  for (const user of [setup.viewer, setup.otherExpert]) {
    await page.context().clearCookies();
    await signIn(page, user);
    await page.goto(sectionUrl(setup.sectionA));
    const main = page.getByRole("main");
    await expect(main.getByText("Consommation stable en 2026.")).toBeVisible();
    await expect(main.getByRole("button", { name: "Modifier le texte" })).toHaveCount(0);
    await expect(main.getByLabel(EDITOR_LABEL)).toHaveCount(0);

    // The database refuses their save as well, even with the right version.
    const api = await signedInClient(user);
    const { error } = await api.rpc("save_section_content", {
      p_section_id: setup.sectionA,
      p_content: "Texte qui ne doit pas passer.",
      p_expected_version: before.content_updated_at,
    });
    expect(error?.code).toBe("42501");
  }
  expect(await sectionRow(setup.sectionA)).toEqual(before);

  // Owners and admins edit every section.
  await page.context().clearCookies();
  await signIn(page, setup.owner);
  await page.goto(sectionUrl(setup.sectionB));
  await expect(page.getByRole("main").getByRole("button", { name: "Modifier le texte" })).toBeVisible();
});
