import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestUser, createWorkspaceFor, type TestUser } from "./supabase";

// KRB-124: the in-app notification of a report status change. The owner
// submits the report through transition_report_status directly, so no e-mail
// goes out here: the server action of the report page sends those.
test.describe.configure({ mode: "serial" });

type Setup = { owner: TestUser; expert: TestUser; reportId: string; reportTitle: string };

let setup: Setup;

test.beforeAll(async () => {
  const [owner, expert] = await Promise.all([createTestUser("Awa Dossou"), createTestUser("Koffi Expert")]);
  const {
    api,
    workspace_id: workspaceId,
    report_id: reportId,
  } = await createWorkspaceFor(owner, "Revue Parakou");
  const admin = adminClient();
  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: expert.id, role: "expert" });
  if (memberError) throw memberError;
  // Experts hear about a report once they have a section in it.
  const { error: sectionError } = await admin
    .from("report_sections")
    .insert({ workspace_id: workspaceId, report_id: reportId, title: "Diagnostic", assigned_to: expert.id });
  if (sectionError) throw sectionError;

  const { data: change, error } = await api
    .rpc("transition_report_status", { p_report_id: reportId, p_from: "draft", p_to: "in_review" })
    .single();
  if (error || !change) throw error ?? new Error("transition_report_status returned nothing");
  // The owner made the change, so only the expert is told.
  expect(change.recipients).toEqual([expert.id]);

  setup = { owner, expert, reportId, reportTitle: "Rapport Revue Parakou" };
});

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

function bell(page: Page, label = "Notifications") {
  return page.getByRole("link", { name: label, exact: true });
}

test("the expert sees the submission in the bell, then on the notifications page", async ({ page }) => {
  const { owner, expert, reportId, reportTitle } = setup;
  await signIn(page, expert);

  await expect(bell(page, "Notifications, 1 non lue")).toHaveText("1");
  await bell(page, "Notifications, 1 non lue").click();
  await expect(page).toHaveURL("/fr/notifications");
  await expect(page).toHaveTitle(/^Notifications/);

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Notifications");
  const item = main.getByRole("link", { name: `${owner.name} a soumis « ${reportTitle} » pour revue` });
  await expect(item).toHaveAttribute("href", `/fr/rapports/${reportId}`);
  await expect(item).toContainText("Non lue");

  // Opening the page marks it as read: the bell clears, and the item stays
  // highlighted until the next visit.
  await expect(bell(page)).toBeVisible();
  await expect(bell(page)).toHaveText("");
  await expect(item).toContainText("Non lue");
  const { data: rows, error } = await adminClient()
    .from("notifications")
    .select("read_at")
    .eq("user_id", expert.id);
  if (error) throw error;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.read_at).not.toBeNull();

  await item.click();
  await expect(page).toHaveURL(`/fr/rapports/${reportId}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(reportTitle);
  await expect(bell(page)).toHaveText("");

  await page.goto("/fr/notifications");
  await expect(item).toBeVisible();
  await expect(item).not.toContainText("Non lue");
});

test("the person who made the change gets no notification", async ({ page }) => {
  await signIn(page, setup.owner);

  await expect(bell(page)).toHaveText("");
  await bell(page).click();
  await expect(page).toHaveURL("/fr/notifications");
  await expect(bell(page)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText("Aucune notification");
});
