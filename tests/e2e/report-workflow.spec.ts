import { expect, test, type Page } from "@playwright/test";
import { clearInbox, waitForLink } from "./mailpit";
import { adminClient, createTestUser, createWorkspaceFor, signedInClient, type TestUser } from "./supabase";

// KRB-20: an owner takes a report through review to final, the expert is
// told by e-mail, a final report is read-only for everyone (in the pages and
// in the database), and reopening it lets the expert write again. Storing
// the final PDF needs the Storage container (CI only).
test.describe.configure({ mode: "serial" });

type Setup = {
  owner: TestUser;
  expert: TestUser;
  workspaceId: string;
  reportId: string;
  reportTitle: string;
  sectionId: string;
};

let setup: Setup;

test.beforeAll(async () => {
  const [owner, expert] = await Promise.all([createTestUser("Olivia Owner"), createTestUser("Edgar Expert")]);
  const { workspace_id: workspaceId, report_id: reportId } = await createWorkspaceFor(
    owner,
    "Revue Porto-Novo",
  );

  const admin = adminClient();
  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;

  const { data: section, error } = await admin
    .from("report_sections")
    .insert({
      workspace_id: workspaceId,
      report_id: reportId,
      title: "Analyse des marchés",
      position: 0,
      status: "in_progress",
      assigned_to: expert.id,
      content: "Les marchés de Porto-Novo ont repris après la saison des pluies.",
    })
    .select("id")
    .single();
  if (error || !section) throw error ?? new Error("Could not create the section");

  setup = {
    owner,
    expert,
    workspaceId,
    reportId,
    reportTitle: "Rapport Revue Porto-Novo",
    sectionId: section.id,
  };
});

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

/** Changes the status of the section as the expert, straight through the API. */
async function expertSetsStatus(status: "in_progress" | "completed") {
  const api = await signedInClient(setup.expert);
  return api.from("report_sections").update({ status }).eq("id", setup.sectionId).select("id");
}

async function sectionStatus() {
  const { data } = await adminClient()
    .from("report_sections")
    .select("status")
    .eq("id", setup.sectionId)
    .single();
  return data?.status;
}

test("the owner submits the report for review and finalizes it, and the expert is told", async ({ page }) => {
  // Two status changes, the e-mail and the PDF of the final version.
  test.setTimeout(90_000);
  await clearInbox(setup.expert.email);

  await signIn(page, setup.owner);
  await page.goto(`/fr/rapports/${setup.reportId}`);
  const controls = page.getByRole("region", { name: "Revue et finalisation" });
  await expect(controls).toBeVisible();

  await controls.getByRole("button", { name: "Soumettre pour revue" }).click();
  await expect(page.getByText("Le rapport est en revue.")).toBeVisible();

  const link = await waitForLink(
    setup.expert.email,
    `« ${setup.reportTitle} » est en revue`,
    /href="([^"]*\/fr\/rapports\/[^"]*)"/,
  );
  expect(link).toContain(`/fr/rapports/${setup.reportId}`);

  await controls.getByRole("button", { name: "Finaliser" }).click();
  const dialog = page.getByRole("dialog", { name: "Finaliser le rapport ?" });
  await dialog.getByRole("button", { name: "Finaliser le rapport" }).click();
  await expect(page.getByText("Le rapport est final.")).toBeVisible({ timeout: 30_000 });

  // The PDF of the final version is stored and listed for the owner, with
  // the list of files in annex like an export by default (KRB-215).
  await expect(page.getByRole("link", { name: "Version finale (PDF)" })).toBeVisible();
  const { data: snapshots } = await adminClient()
    .from("report_exports")
    .select("format, status, with_annexes")
    .eq("report_id", setup.reportId)
    .eq("kind", "final");
  expect(snapshots).toEqual([{ format: "pdf", status: "ready", with_annexes: true }]);

  const { data: report } = await adminClient()
    .from("reports")
    .select("status")
    .eq("id", setup.reportId)
    .single();
  expect(report?.status).toBe("final");
});

test("a final report is read-only for the expert, in the page and in the database", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(`/fr/espaces/${setup.workspaceId}/sections/${setup.sectionId}`);
  await expect(page.getByText(/Ce rapport est final/)).toBeVisible();
  await expect(page.getByLabel("Statut de la section")).toHaveCount(0);

  // RLS hides the row from the write: nothing changes.
  const { data: updated, error } = await expertSetsStatus("completed");
  expect(error).toBeNull();
  expect(updated).toEqual([]);
  expect(await sectionStatus()).toBe("in_progress");

  // The text goes through save_section_content, which the database refuses.
  const api = await signedInClient(setup.expert);
  const { data: section } = await api
    .from("report_sections")
    .select("content_updated_at")
    .eq("id", setup.sectionId)
    .single();
  const { error: saveError } = await api.rpc("save_section_content", {
    p_section_id: setup.sectionId,
    p_content: "Texte écrit après la finalisation",
    p_expected_version: section?.content_updated_at ?? "",
  });
  expect(saveError?.code).toBe("KR020");
});

test("the owner reopens the report and the expert writes again", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(`/fr/rapports/${setup.reportId}`);
  await page.getByRole("button", { name: "Rouvrir en brouillon" }).click();
  const dialog = page.getByRole("dialog", { name: "Rouvrir le rapport en brouillon ?" });
  await dialog.getByRole("button", { name: "Rouvrir en brouillon" }).click();
  await expect(page.getByText("Le rapport est rouvert en brouillon.")).toBeVisible();

  const { data: updated, error } = await expertSetsStatus("completed");
  expect(error).toBeNull();
  expect(updated).toHaveLength(1);
  expect(await sectionStatus()).toBe("completed");
});
