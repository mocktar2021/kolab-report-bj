import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor, signedInClient, type TestUser } from "./supabase";

// KRB-18: the text of a section, edited by hand. A save sends back the
// version the editor loaded (content_updated_at), so two people saving the
// same section see a conflict instead of overwriting each other.
// KRB-197: the editor opens in "Texte" mode, a Word-like editor, with a
// "Markdown" tab on the same text. The text is still saved as Markdown.
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
  sectionC: string;
  sectionD: string;
};

let setup: Setup;

const FIRST_TEXT = "## Constats\n\nLe bâtiment administratif consomme 412 MWh par an.";
const EDITOR_LABEL = "Texte de la section (Markdown)";
const VISUAL_LABEL = "Texte de la section";
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
      { workspace_id: workspaceId, report_id: reportId, title: "Synthèse", assigned_to: expert.id },
      { workspace_id: workspaceId, report_id: reportId, title: "Annexes", assigned_to: expert.id },
    ])
    .select("id, title");
  if (error || !sections) throw error ?? new Error("Could not create the sections");
  const idOf = (title: string) => sections.find((section) => section.title === title)?.id;
  const [sectionA, sectionB, sectionC, sectionD] = [
    idOf("Bilan énergétique"),
    idOf("Plan d'action"),
    idOf("Synthèse"),
    idOf("Annexes"),
  ];
  if (!sectionA || !sectionB || !sectionC || !sectionD) throw new Error("Missing a section");
  setup = {
    owner,
    expert,
    secondExpert,
    otherExpert,
    viewer,
    workspaceId,
    sectionA,
    sectionB,
    sectionC,
    sectionD,
  };
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

/** The editable text of the "Texte" mode. */
function visualEditor(page: Page) {
  return page.getByRole("main").getByRole("textbox", { name: VISUAL_LABEL, exact: true });
}

/** Opens the editor of the section on the page and replaces its text in the Markdown tab. */
async function write(page: Page, text: string) {
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Modifier le texte" }).click();
  // A new browser context: the editor opens in "Texte" mode, focus in the text.
  await expect(visualEditor(page)).toBeFocused();
  await main.getByRole("tab", { name: "Markdown" }).click();
  const editor = main.getByLabel(EDITOR_LABEL);
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
    await expect(visualEditor(page)).toHaveCount(0);

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

test("the expert writes in Texte mode with the toolbar, checks the Markdown and saves", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(sectionUrl(setup.sectionC));
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Modifier le texte" }).click();
  await expect(main.getByRole("tab", { name: "Texte" })).toHaveAttribute("aria-selected", "true");
  const field = visualEditor(page);
  await expect(field).toBeFocused();
  const toolbar = main.getByRole("toolbar", { name: "Mise en forme" });

  await toolbar.getByRole("button", { name: "Titre 2" }).click();
  await expect(toolbar.getByRole("button", { name: "Titre 2" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("Constats");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Le bâtiment consomme ");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("412 MWh");
  await expect(toolbar.getByRole("button", { name: "Gras" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(" par an.");
  await page.keyboard.press("Enter");
  await toolbar.getByRole("button", { name: "Liste à puces" }).click();
  await page.keyboard.type("Chaufferie");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Éclairage");

  // No Markdown symbols on screen, real formatting instead.
  await expect(field.getByRole("heading", { name: "Constats" })).toBeVisible();
  await expect(field.locator("strong")).toHaveText("412 MWh");
  await expect(field.getByRole("listitem")).toHaveText(["Chaufferie", "Éclairage"]);
  await expect(field).not.toContainText("**");

  const markdown = "## Constats\n\nLe bâtiment consomme **412 MWh** par an.\n\n- Chaufferie\n- Éclairage";
  await main.getByRole("tab", { name: "Markdown" }).click();
  await expect(main.getByLabel(EDITOR_LABEL)).toHaveValue(markdown);
  // Back to Texte: the content is the same.
  await main.getByRole("tab", { name: "Texte" }).click();
  await expect(field.getByRole("heading", { name: "Constats" })).toBeVisible();
  await main.getByRole("tab", { name: "Markdown" }).click();

  await main.getByRole("button", { name: "Enregistrer" }).click();
  await expect(main.getByText("Texte enregistré.")).toBeVisible();
  expect(await sectionRow(setup.sectionC)).toMatchObject({ content: markdown, status: "in_progress" });
  await expect(main.getByRole("heading", { level: 3, name: "Constats" })).toBeVisible();

  // The last mode used comes back on this device.
  await page.reload();
  await main.getByRole("button", { name: "Modifier le texte" }).click();
  await expect(main.getByRole("tab", { name: "Markdown" })).toHaveAttribute("aria-selected", "true");
  await expect(main.getByLabel(EDITOR_LABEL)).toHaveValue(markdown);
});

test("a paste from Word keeps headings, bold, lists and tables, and drops the rest", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("tracker.example")) external.push(request.url());
  });
  await signIn(page, setup.expert);
  await page.goto(sectionUrl(setup.sectionD));
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Modifier le texte" }).click();
  const field = visualEditor(page);
  await expect(field).toBeFocused();

  const html = `<html><head><style>p { color: red }</style><script>window.pasted = true</script></head><body>
    <h1>Annexe 1</h1>
    <p class=MsoNormal><b>Mesures</b> de <span style="color:#c00000;font-family:Comic Sans MS">février</span><img src="https://tracker.example/pixel.png"></p>
    <p class=MsoListParagraphCxSpFirst style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·&nbsp;</span>Chaufferie</p>
    <p class=MsoListParagraphCxSpLast style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·&nbsp;</span>Éclairage</p>
    <table><tr><td><p>Poste</p></td><td><p>Part</p></td></tr><tr><td><p>Climatisation</p></td><td><p>58 %</p></td></tr></table>
  </body></html>`;
  await field.evaluate((element, pasted) => {
    const data = new DataTransfer();
    data.setData("text/html", pasted);
    data.setData("text/plain", "Annexe 1");
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, html);

  await expect(field.getByRole("heading", { name: "Annexe 1" })).toBeVisible();
  await expect(field.getByRole("table")).toBeVisible();
  await expect(field.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { pasted?: boolean }).pasted)).toBeUndefined();

  await main.getByRole("tab", { name: "Markdown" }).click();
  await expect(main.getByLabel(EDITOR_LABEL)).toHaveValue(
    "# Annexe 1\n\n**Mesures** de février\n\n- Chaufferie\n- Éclairage\n\n| Poste | Part |\n| - | - |\n| Climatisation | 58 % |",
  );
  expect(external).toEqual([]);
});
