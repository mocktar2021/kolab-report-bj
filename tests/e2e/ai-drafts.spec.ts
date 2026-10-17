import { expect, test, type Page } from "@playwright/test";
import {
  addParsedDeliverable as addDeliverable,
  adminClient,
  createTestUser,
  createWorkspaceFor,
  type TestUser,
} from "./supabase";

// KRB-16: AI drafts of a section. The app runs with AI_PROVIDER=mock and
// AI_RATE_LIMIT_PER_HOUR=5 (see .github/workflows/ci.yml): the mock answers
// fixed French text that fits the schema, so no model is called.
test.describe.configure({ mode: "serial" });

type Setup = {
  owner: TestUser;
  expert: TestUser;
  otherExpert: TestUser;
  viewer: TestUser;
  workspaceId: string;
  sectionId: string;
  templateId: string;
};

let setup: Setup;

const PARSED = `## Constats

La consommation électrique du bâtiment administratif a atteint 412 MWh en 2025, contre 365 MWh en 2023.

## Mesures

| Poste | Part |
| --- | --- |
| Climatisation | 58 % |
| Éclairage | 21 % |`;

async function addParsedDeliverable(
  workspaceId: string,
  sectionId: string,
  uploadedBy: string,
  name: string,
) {
  await addDeliverable(workspaceId, sectionId, uploadedBy, name, PARSED);
}

test.beforeAll(async () => {
  const [owner, expert, otherExpert, viewer] = await Promise.all([
    createTestUser("Odette Owner"),
    createTestUser("Etienne Expert"),
    createTestUser("Oscar Autre"),
    createTestUser("Victor Lecteur"),
  ]);
  const {
    api,
    workspace_id: workspaceId,
    report_id: reportId,
  } = await createWorkspaceFor(owner, "Brouillons");
  const admin = adminClient();
  const { error: membersError } = await admin.from("workspace_members").insert([
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
      title: "Bilan énergétique",
      assigned_to: expert.id,
    })
    .select("id")
    .single();
  if (error || !section) throw error ?? new Error("Could not create the section");
  await addParsedDeliverable(workspaceId, section.id, expert.id, "audit-energie.md");

  const { data: template, error: templateError } = await admin
    .from("prompt_library")
    .select("id")
    .is("workspace_id", null)
    .eq("template_key", "synthese-section")
    .eq("status", "published")
    .single();
  if (templateError || !template) throw templateError ?? new Error("No published synthese-section template");

  setup = { owner, expert, otherExpert, viewer, workspaceId, sectionId: section.id, templateId: template.id };
});

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

function draftRoute(sectionId = setup.sectionId) {
  return `/api/ai/sections/${sectionId}/draft`;
}

async function generationCount(userId: string) {
  const { count, error } = await adminClient()
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("requested_by", userId);
  if (error) throw error;
  return count ?? 0;
}

/** NDJSON events of a finished draft answer. */
function events(body: string): Array<{ type: string } & Record<string, unknown>> {
  return body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { type: string } & Record<string, unknown>);
}

test("signed-out visitors, other experts and viewers can't ask for a draft", async ({ page, request }) => {
  const anonymous = await request.post(draftRoute(), { data: { promptVersionId: setup.templateId } });
  expect(anonymous.status()).toBe(401);

  for (const user of [setup.otherExpert, setup.viewer]) {
    await page.context().clearCookies();
    await signIn(page, user);
    const response = await page.request.post(draftRoute(), { data: { promptVersionId: setup.templateId } });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(await generationCount(user.id)).toBe(0);
  }
});

test("the assigned expert gets a streamed draft, recorded as a proposal", async ({ page }) => {
  await signIn(page, setup.expert);
  const response = await page.request.post(draftRoute(), { data: { promptVersionId: setup.templateId } });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/x-ndjson");
  const stream = events(await response.text());
  expect(stream[0]).toMatchObject({ type: "start", truncated: false });
  expect(stream.some((event) => event.type === "partial")).toBe(true);
  const done = stream.at(-1);
  expect(done).toMatchObject({ type: "done", output: { schema: "section_draft" } });
  expect(String(done?.markdown)).toContain("### Sources");
  expect(String(done?.markdown)).toContain("audit-energie.md");

  const { data: generation } = await adminClient()
    .from("ai_generations")
    .select(
      "status, accepted, prompt_version_id, model, input_hash, input_tokens, output_tokens, latency_ms, raw_output, params",
    )
    .eq("id", String(done?.generationId))
    .single();
  expect(generation).toMatchObject({
    status: "succeeded",
    accepted: null,
    prompt_version_id: setup.templateId,
    model: "mock",
    params: { temperature: 0.3, maxOutputTokens: 4096, modelTier: "standard" },
  });
  expect(generation?.input_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(generation?.output_tokens).toBeGreaterThan(0);
  expect(generation?.raw_output).toContain("body_markdown");

  // A proposal leaves the section untouched.
  const { data: section } = await adminClient()
    .from("report_sections")
    .select("content, status")
    .eq("id", setup.sectionId)
    .single();
  expect(section).toEqual({ content: null, status: "not_started" });
});

function sectionUrl() {
  return `/fr/espaces/${setup.workspaceId}/sections/${setup.sectionId}`;
}

async function latestGeneration() {
  const { data, error } = await adminClient()
    .from("ai_generations")
    .select("id, accepted, edit_distance, user_rating, feedback_comment")
    .eq("section_id", setup.sectionId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

test("the expert generates a draft, rates it, edits it and accepts it", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Contenu de la section" })).toBeVisible();
  // The draft streamed by the previous test still waits for a decision.
  await expect(main.getByRole("heading", { name: "Brouillon proposé" })).toBeVisible();

  await main.getByRole("button", { name: "Générer un brouillon" }).click();
  await expect(main.getByText("Brouillon prêt. Relisez-le avant de l'accepter.")).toBeVisible();
  await expect(main.getByText("audit-energie.md").first()).toBeVisible();

  await main.getByRole("button", { name: "Utile", exact: true }).click();
  await main.getByLabel("Commentaire").fill("Bon point de départ.");
  await main.getByRole("button", { name: "Envoyer mon avis" }).click();
  await expect(main.getByText("Avis enregistré.")).toBeVisible();

  await main.getByRole("button", { name: "Modifier avant d'accepter" }).click();
  const editor = main.getByLabel("Texte à accepter (Markdown)");
  await editor.fill(`${await editor.inputValue()}\n\nParagraphe ajouté par l'expert.`);
  await main.getByRole("button", { name: "Accepter ce texte" }).click();
  await expect(main.getByText("Brouillon accepté.", { exact: false })).toBeVisible();
  await expect(main.getByText("Paragraphe ajouté par l'expert.")).toBeVisible();

  const generation = await latestGeneration();
  expect(generation).toMatchObject({
    accepted: true,
    user_rating: 1,
    feedback_comment: "Bon point de départ.",
  });
  expect(generation.edit_distance).toBeGreaterThan(0);
  const { data: section } = await adminClient()
    .from("report_sections")
    .select("content, status")
    .eq("id", setup.sectionId)
    .single();
  expect(section?.status).toBe("in_progress");
  expect(section?.content).toContain("Paragraphe ajouté par l'expert.");
});

test("the expert discards a draft and the section keeps its text", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Générer un brouillon" }).click();
  await expect(main.getByText("Brouillon prêt. Relisez-le avant de l'accepter.")).toBeVisible();
  await main.getByRole("button", { name: "Rejeter" }).click();
  await main.getByRole("button", { name: "Confirmer le rejet" }).click();
  await expect(main.getByText("Brouillon rejeté.", { exact: false })).toBeVisible();

  expect(await latestGeneration()).toMatchObject({ accepted: false, edit_distance: null });
  // The text shows with "Aperçu" (KRB-201).
  await main.getByRole("button", { name: "Aperçu du contenu de la section" }).click();
  await expect(main.getByText("Paragraphe ajouté par l'expert.")).toBeVisible();
});

test("a viewer reads the section text without the draft tools", async ({ page }) => {
  await signIn(page, setup.viewer);
  await page.goto(sectionUrl());
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Aperçu du contenu de la section" }).click();
  await expect(main.getByText("Paragraphe ajouté par l'expert.")).toBeVisible();
  await expect(main.getByRole("button", { name: "Générer un brouillon" })).toHaveCount(0);
  await expect(main.getByRole("heading", { name: "Brouillon proposé" })).toHaveCount(0);
});

test("past the hourly limit the route answers 429 without calling the model", async ({ page }) => {
  // AI_RATE_LIMIT_PER_HOUR is 5 for the tests: the expert already asked once.
  const rows = Array.from({ length: 4 }, () => ({
    workspace_id: setup.workspaceId,
    section_id: setup.sectionId,
    requested_by: setup.expert.id,
    output_schema: "section_draft",
    schema_version: 1,
    provider: "mock",
    model: "mock",
    status: "failed" as const,
    estimated_tokens: 0,
  }));
  const { error } = await adminClient().from("ai_generations").insert(rows);
  if (error) throw error;
  const before = await generationCount(setup.expert.id);

  await signIn(page, setup.expert);
  const response = await page.request.post(draftRoute(), { data: { promptVersionId: setup.templateId } });
  expect(response.status()).toBe(429);
  expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);
  expect(await response.json()).toMatchObject({ error: "rateLimited" });
  expect(await generationCount(setup.expert.id)).toBe(before);
});

test("past the workspace's monthly budget the route answers 429", async ({ page }) => {
  const owner = await createTestUser("Bruno Budget");
  const { api, workspace_id: workspaceId, report_id: reportId } = await createWorkspaceFor(owner, "Budget");
  const { data: section, error } = await api
    .from("report_sections")
    .insert({ workspace_id: workspaceId, report_id: reportId, title: "Synthèse", assigned_to: owner.id })
    .select("id")
    .single();
  if (error || !section) throw error ?? new Error("Could not create the section");
  await addParsedDeliverable(workspaceId, section.id, owner.id, "notes.md");
  const { error: usageError } = await adminClient().from("ai_generations").insert({
    workspace_id: workspaceId,
    section_id: section.id,
    requested_by: null,
    output_schema: "section_draft",
    schema_version: 1,
    provider: "mock",
    model: "mock",
    status: "failed",
    estimated_tokens: 0,
    input_tokens: 2_000_000,
  });
  if (usageError) throw usageError;

  await signIn(page, owner);
  const response = await page.request.post(draftRoute(section.id), {
    data: { promptVersionId: setup.templateId },
  });
  expect(response.status()).toBe(429);
  expect(await response.json()).toMatchObject({ error: "budgetExceeded" });
});
