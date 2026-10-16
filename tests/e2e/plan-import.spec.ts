import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor, type TestUser } from "./supabase";

// KRB-196: "Importer le plan". An owner reads the plan of a Word file,
// reviews it in the preview (rename, remove, merge, switch a level, edit the
// instructions), and creates the sections after the report's own. A PDF is
// read by the AI (AI_PROVIDER=mock locally and in CI) and counts as one AI
// draft of the trial; once the trial's drafts are used up, the next PDF is
// refused. An expert has no access. Nothing here needs the Storage
// container: the file is never stored.
test.describe.configure({ mode: "serial" });

const FIXTURES = path.join(__dirname, "..", "fixtures", "plans");

type Setup = {
  owner: TestUser;
  expert: TestUser;
  organizationId: string;
  workspaceId: string;
  reportId: string;
};

let setup: Setup;

test.beforeAll(async () => {
  const [owner, expert] = await Promise.all([createTestUser("Prisca Plan"), createTestUser("Elie Lecteur")]);
  const {
    organization_id: organizationId,
    workspace_id: workspaceId,
    report_id: reportId,
  } = await createWorkspaceFor(owner, "Plan Ouidah");
  const admin = adminClient();
  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;
  const { error } = await admin
    .from("report_sections")
    .insert({ workspace_id: workspaceId, report_id: reportId, title: "Introduction", position: 0 });
  if (error) throw error;
  setup = { owner, expert, organizationId, workspaceId, reportId };
});

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

async function sections() {
  const { data, error } = await adminClient()
    .from("report_sections")
    .select("id, title, position, parent_id, instructions")
    .eq("report_id", setup.reportId)
    .order("position");
  if (error) throw error;
  return data;
}

async function planCalls() {
  const { data, error } = await adminClient()
    .from("plan_import_calls")
    .select("id, status, items, user_id")
    .eq("workspace_id", setup.workspaceId)
    .order("created_at");
  if (error) throw error;
  return data;
}

function titleField(page: Page, label: string) {
  return page.getByRole("textbox", { name: `Titre de l'élément ${label}`, exact: true });
}

test("an owner imports the plan of a Word file through the preview", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(`/fr/rapports/${setup.reportId}`);
  await page.getByRole("link", { name: "Importer le plan" }).click();
  await expect(page).toHaveURL(`/fr/rapports/${setup.reportId}/importer-le-plan`);
  await expect(page.getByRole("heading", { level: 1, name: "Importer le plan" })).toBeVisible();
  await expect(
    page.getByText("Les sections importées s'ajouteront après la section du rapport."),
  ).toBeVisible();

  await page.getByLabel("Fichier du plan").setInputFiles(path.join(FIXTURES, "tdr-titres.docx"));
  await page.getByRole("button", { name: "Lire le fichier" }).click();

  const preview = page.getByRole("region", { name: "Vérifiez le plan" });
  await expect(preview.getByRole("heading", { name: "Vérifiez le plan" })).toBeFocused();
  await expect(preview.getByText("6 éléments : 4 sections et 2 sous-sections.")).toBeVisible();
  await expect(preview.getByText("Plan lu à partir des styles de titre du document.")).toBeVisible();
  await expect(titleField(page, "2.1")).toHaveValue("Objectif général");

  // Rename, then make "Méthodologie" a subsection of "Objectifs de l'étude".
  await titleField(page, "1.").fill("Contexte");
  await page.getByRole("combobox", { name: "Type de l'élément 3." }).selectOption({ label: "Sous-section" });
  await expect(titleField(page, "2.3")).toHaveValue("Méthodologie");

  // Its instructions, written by hand.
  const methodRow = page.getByRole("listitem").filter({ has: titleField(page, "2.3") });
  await methodRow.getByRole("button", { name: /^Consignes/ }).click();
  await page
    .getByRole("textbox", { name: "Consignes de l'élément 2.3 pour l'IA" })
    .fill("Décrire la collecte.");

  // "Objectif général" goes into the instructions of "Objectifs de l'étude".
  await page.getByRole("button", { name: "Fusionner « Objectif général » avec l'élément précédent" }).click();
  await expect(page.getByRole("textbox", { name: "Consignes de l'élément 2. pour l'IA" })).toBeFocused();

  // "Livrables attendus" moves up, with the keyboard.
  const up = page.getByRole("button", { name: "Monter « Livrables attendus »" });
  await up.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("« Livrables attendus » passe en position 4 sur 5.")).toBeAttached();
  await expect(up).toBeFocused();

  await page.getByRole("button", { name: "Retirer « Livrables attendus »" }).click();
  await expect(preview.getByText("4 éléments : 2 sections et 2 sous-sections.")).toBeVisible();

  await page.getByRole("button", { name: "Créer les 4 sections" }).click();
  await expect(page).toHaveURL(`/fr/rapports/${setup.reportId}`);

  const toc = page.getByRole("main").getByRole("region", { name: "Sommaire" });
  await expect(toc.getByText("5 sections")).toBeVisible();
  const nested = toc.getByRole("list", { name: "Sous-sections de Objectifs de l'étude" });
  await expect(nested.getByRole("listitem")).toContainText(["3.1Objectifs spécifiques", "3.2Méthodologie"]);

  const rows = await sections();
  const byTitle = new Map(rows.map((row) => [row.title, row]));
  const objectives = byTitle.get("Objectifs de l'étude");
  expect(rows.filter((row) => row.parent_id === null).map((row) => row.title)).toEqual([
    "Introduction",
    "Contexte",
    "Objectifs de l'étude",
  ]);
  expect(byTitle.get("Contexte")?.instructions).toBe("La commune produit 300 tonnes de déchets par jour.");
  expect(objectives?.instructions).toBe(
    "Cette partie présente les objectifs.\n\nObjectif général\n\nRappeler l'objectif général en une phrase.",
  );
  expect(byTitle.get("Méthodologie")).toMatchObject({
    parent_id: objectives?.id,
    position: 1,
    instructions: "Décrire la collecte.",
  });
  expect(byTitle.has("Livrables attendus")).toBe(false);
});

test("pasted text without titles says so", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(`/fr/rapports/${setup.reportId}/importer-le-plan`);
  const textarea = page.getByLabel("Texte du plan");
  await textarea.fill("Bonjour,\nvoici la mission, sans titre ni numéro.");
  await page.getByRole("button", { name: "Lire le texte" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Aucun titre trouvé. Utilisez les styles Titre 1 et Titre 2 dans Word, des lignes numérotées (1., 1.1) ou des titres Markdown (# et ##).",
  );
  await expect(textarea).toBeFocused();
});

test("a PDF is read by the AI and counts as one AI draft", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(`/fr/rapports/${setup.reportId}/importer-le-plan`);
  await expect(
    page.getByText("Un PDF est lu par l'IA : la lecture compte comme un brouillon IA du mois."),
  ).toBeVisible();
  await page.getByLabel("Fichier du plan").setInputFiles(path.join(FIXTURES, "tdr.pdf"));
  await page.getByRole("button", { name: "Lire le fichier" }).click();

  const preview = page.getByRole("region", { name: "Vérifiez le plan" });
  await expect(
    preview.getByText("Plan proposé par l'IA à partir du texte du PDF. Relisez chaque titre."),
  ).toBeVisible();
  await expect(preview.getByText("6 éléments : 4 sections et 2 sous-sections.")).toBeVisible();
  await expect(titleField(page, "2.2")).toHaveValue("Objectifs spécifiques");

  const calls = await planCalls();
  expect(calls).toEqual([
    expect.objectContaining({ status: "succeeded", items: 6, user_id: setup.owner.id }),
  ]);
  const { data: usage, error } = await adminClient()
    .from("billing_draft_usage")
    .select("pool, status")
    .eq("generation_id", calls[0]!.id)
    .single();
  if (error) throw error;
  expect(usage).toEqual({ pool: "trial", status: "counted" });

  // Leaving the preview creates nothing.
  await page.getByRole("button", { name: "Choisir un autre fichier" }).click();
  expect((await sections()).length).toBe(5);
});

test("a PDF is refused once the trial's AI drafts are used up", async ({ page }) => {
  const admin = adminClient();
  const { data: trial, error: trialError } = await admin
    .from("billing_entitlements")
    .select("id")
    .eq("organization_id", setup.organizationId)
    .eq("plan", "trial")
    .single();
  if (trialError || !trial) throw trialError ?? new Error("No trial");
  // One draft used by the PDF above: 19 more fill the trial's 20.
  const { error } = await admin.from("billing_draft_usage").insert(
    Array.from({ length: 19 }, () => ({
      generation_id: crypto.randomUUID(),
      organization_id: setup.organizationId,
      workspace_id: setup.workspaceId,
      pool: "trial",
      entitlement_id: trial.id,
      usage_month: new Date().toISOString().slice(0, 8) + "01",
      status: "counted",
      settled_at: new Date().toISOString(),
    })),
  );
  if (error) throw error;

  await signIn(page, setup.owner);
  await page.goto(`/fr/rapports/${setup.reportId}/importer-le-plan`);
  await page.getByLabel("Fichier du plan").setInputFiles(path.join(FIXTURES, "tdr.pdf"));
  await page.getByRole("button", { name: "Lire le fichier" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Les 20 brouillons IA de l'essai sont utilisés, et la lecture d'un PDF en compte un. Importez un fichier Word ou texte.",
  );
  expect(await planCalls()).toHaveLength(1);

  // A Word file needs no AI and still works.
  await page.getByLabel("Fichier du plan").setInputFiles(path.join(FIXTURES, "tdr-numerote.docx"));
  await page.getByRole("button", { name: "Lire le fichier" }).click();
  await expect(page.getByText("Plan lu à partir de la numérotation des lignes.")).toBeVisible();
});

test("a file whose content does not match its name is refused", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(`/fr/rapports/${setup.reportId}/importer-le-plan`);
  await page.getByLabel("Fichier du plan").setInputFiles({
    name: "plan.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("1. Contexte\n2. Objectifs\n"),
  });
  await page.getByRole("button", { name: "Lire le fichier" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Le contenu du fichier ne correspond pas à son extension. Enregistrez-le à nouveau dans le bon format.",
  );
});

test("an expert has no import", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(`/fr/rapports/${setup.reportId}`);
  await expect(page.getByRole("main").getByRole("region", { name: "Sommaire" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Importer le plan" })).toHaveCount(0);

  const response = await page.goto(`/fr/rapports/${setup.reportId}/importer-le-plan`);
  expect(response?.status()).toBe(404);
  const api = await page.request.post(`/api/reports/${setup.reportId}/plan`, {
    data: { text: "1. Contexte" },
  });
  expect(api.status()).toBe(403);
  expect(await api.json()).toEqual({ error: "forbidden" });
});
