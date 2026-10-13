import { expect, test, type Page } from "@playwright/test";
import { rolloutBucket } from "../../src/lib/ai/rollout-bucket";
import { adminClient, createTestUser, createWorkspaceFor, type TestUser } from "./supabase";

// KRB-17: progressive rollout of a prompt version, rollback, and the AI
// dashboard. Drafts run on the mock provider (AI_PROVIDER=mock).
test.describe.configure({ mode: "serial" });

type Setup = {
  owner: TestUser;
  expert: TestUser;
  workspaceId: string;
  sectionIds: string[];
  v1: string;
  v2: string;
};

let setup: Setup;

const TEMPLATE = "Rédige la section {{section_title}} à partir de ces livrables :\n{{deliverables}}";

async function addVersion(workspaceId: string, version: number, status: "published" | "draft") {
  const { data, error } = await adminClient()
    .from("prompt_library")
    .insert({
      workspace_id: workspaceId,
      template_key: "brouillon-e2e",
      version,
      title: "Brouillon e2e",
      template: `${TEMPLATE}\nVersion ${version}.`,
      status,
      changelog: version > 1 ? `Essai ${version}` : null,
      output_schema: "section_draft",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Could not add a prompt version");
  return data.id;
}

test.beforeAll(async () => {
  const [owner, expert] = await Promise.all([createTestUser("Paule Pilote"), createTestUser("Eric Expert")]);
  const { api, workspace_id: workspaceId, report_id: reportId } = await createWorkspaceFor(owner, "Pilotage");
  const admin = adminClient();
  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;

  const sectionIds: string[] = [];
  for (const title of ["Constats", "Analyse"]) {
    const { data: section, error } = await api
      .from("report_sections")
      .insert({ workspace_id: workspaceId, report_id: reportId, title, assigned_to: owner.id })
      .select("id")
      .single();
    if (error || !section) throw error ?? new Error("Could not create a section");
    const id = crypto.randomUUID();
    const { error: fileError } = await admin.from("deliverables").insert({
      id,
      workspace_id: workspaceId,
      section_id: section.id,
      uploaded_by: owner.id,
      storage_path: `${workspaceId}/${section.id}/${id}-notes.md`,
      file_name: "notes.md",
      mime_type: "text/markdown",
      size_bytes: 40,
      uploaded_at: new Date().toISOString(),
      parse_status: "parsed",
      parsed_content: "## Notes\n\nLa consommation a baissé de 12 % en 2025.",
      parsed_at: new Date().toISOString(),
    });
    if (fileError) throw fileError;
    sectionIds.push(section.id);
  }

  const v1 = await addVersion(workspaceId, 1, "published");
  const v2 = await addVersion(workspaceId, 2, "draft");
  setup = { owner, expert, workspaceId, sectionIds, v1, v2 };
});

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

function versionUrl(id: string) {
  return `/fr/espaces/${setup.workspaceId}/modeles/${id}`;
}

async function statuses() {
  const { data, error } = await adminClient()
    .from("prompt_library")
    .select("version, status")
    .eq("workspace_id", setup.workspaceId)
    .eq("template_key", "brouillon-e2e")
    .order("version");
  if (error) throw error;
  return data;
}

test("a manager rolls a draft version out, publishes it for everyone, then rolls back", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(versionUrl(setup.v2));
  const main = page.getByRole("main");
  await main.getByLabel("Part des nouveaux brouillons").fill("10");
  await main.getByRole("button", { name: "Déployer progressivement" }).click();
  await expect(main.getByText("Déploiement progressif en cours")).toBeVisible();

  // The section with the lowest bucket gets the candidate once the share covers it.
  const { data: rollout } = await adminClient()
    .from("prompt_rollouts")
    .select("id")
    .eq("candidate_id", setup.v2)
    .eq("status", "active")
    .single();
  if (!rollout) throw new Error("No active rollout");
  const [sectionId, bucket] = setup.sectionIds
    .map((id) => [id, rolloutBucket(rollout.id, id)] as const)
    .sort((a, b) => a[1] - b[1])[0]!;
  const percent = Math.max(1, Math.min(99, bucket + 1));
  await main.getByLabel("Part des nouveaux brouillons").fill(String(percent));
  await main.getByRole("button", { name: "Modifier la part" }).click();
  await expect
    .poll(
      async () =>
        (await adminClient().from("prompt_rollouts").select("percent").eq("id", rollout.id).single()).data
          ?.percent,
    )
    .toBe(percent);

  // The expert picks the published version; the rollout serves the draft one.
  const response = await page.request.post(`/api/ai/sections/${sectionId}/draft`, {
    data: { promptVersionId: setup.v1 },
  });
  expect(response.status()).toBe(200);
  const done = (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; generationId?: string })
    .at(-1);
  expect(done?.type).toBe("done");
  const { data: generation } = await adminClient()
    .from("ai_generations")
    .select("prompt_version_id, rollout_id")
    .eq("id", String(done?.generationId))
    .single();
  expect(generation).toEqual({ prompt_version_id: setup.v2, rollout_id: rollout.id });

  await page.goto(`/fr/espaces/${setup.workspaceId}/modeles`);
  await expect(
    page.getByRole("main").getByText(`Déploiement en cours : v2 à ${percent}`, { exact: false }),
  ).toBeVisible();

  await page.goto(versionUrl(setup.v2));
  await main.getByRole("button", { name: "Publier pour tous" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publier pour tous" }).click();
  await expect.poll(statuses).toEqual([
    { version: 1, status: "archived" },
    { version: 2, status: "published" },
  ]);

  await page.reload();
  await main.getByRole("button", { name: "Revenir à la version précédente" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revenir à la version 1" }).click();
  await page.waitForURL((url) => url.pathname.endsWith(`/modeles/${setup.v1}`));
  await expect.poll(statuses).toEqual([
    { version: 1, status: "published" },
    { version: 2, status: "archived" },
  ]);
});

test("owners see the AI dashboard per prompt version, experts don't", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(`/fr/espaces/${setup.workspaceId}/ia`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Pilotage de l'IA" })).toBeVisible();
  const table = main.getByRole("table").first();
  await expect(table).toContainText("Brouillon e2e");
  await expect(table).toContainText("v2");
  await expect(main.getByText("Dernières générations", { exact: false }).first()).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, setup.expert);
  await page.goto(`/fr/espaces/${setup.workspaceId}/ia`);
  await expect(page.getByRole("main").getByText("Page réservée")).toBeVisible();
});
