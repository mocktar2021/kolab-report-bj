import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  adminClient,
  createTestUser,
  createWorkspaceFor,
  setPlan,
  signedInClient,
  type TestUser,
} from "./supabase";

// KRB-180: deleting a report, a workspace or an organization. Each goes
// through a French confirmation dialog that names what goes; a final report,
// a workspace and an organization also need their exact title or name.
// Experts and viewers get no action and the database refuses them. The
// files of what goes are removed by the cleanup job: that test needs the
// Storage container and CRON_SECRET, like storage-cleanup.spec.ts.
test.describe.configure({ mode: "serial" });

const CRON_PATH = "/api/cron/storage-cleanup";

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);
}

async function pageFor(browser: Browser, user: TestUser) {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, user);
  return page;
}

async function addMember(workspaceId: string, user: TestUser, role: "admin" | "expert" | "viewer") {
  const { error } = await adminClient()
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: user.id, role });
  if (error) throw error;
}

async function addReport(workspaceId: string, title: string, createdBy: string) {
  const admin = adminClient();
  const { data: report, error } = await admin
    .from("reports")
    .insert({ workspace_id: workspaceId, title, created_by: createdBy })
    .select("id")
    .single();
  if (error || !report) throw error ?? new Error("Could not create the report");
  const { error: sectionError } = await admin
    .from("report_sections")
    .insert({ workspace_id: workspaceId, report_id: report.id, title: "Constats", position: 0 });
  if (sectionError) throw sectionError;
  return report.id;
}

/**
 * A payment recorded by hand and its receipt, as the operator script of KRB-176
 * leaves them, written with the service role. Returns the receipt id.
 */
async function addPaidReceipt(organizationId: string, buyerName: string) {
  const admin = adminClient();
  const purchaseId = randomUUID();
  const now = new Date().toISOString();
  const { error: purchaseError } = await admin.from("billing_purchases").insert({
    id: purchaseId,
    organization_id: organizationId,
    offer: "manual",
    offer_label: "Paiement de test",
    catalog_version: 1,
    terms: {},
    amount_ht_xof: 0,
    amount_xof: 0,
    method: "manual",
    environment: "manual",
    status: "paid",
    merchant_reference: `KR-${purchaseId}`,
    paid_at: now,
    granted_at: now,
  });
  if (purchaseError) throw purchaseError;
  const number = `KR-2099-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`;
  const { data: receipt, error: receiptError } = await admin
    .from("billing_receipts")
    .insert({
      number,
      purchase_id: purchaseId,
      organization_id: organizationId,
      environment: "manual",
      seller: { name: "Mocktar Technologies" },
      buyer: { name: buyerName },
      payment: { method: "manual" },
      total_ht_xof: 0,
      total_xof: 0,
    })
    .select("id")
    .single();
  if (receiptError || !receipt) throw receiptError ?? new Error("Could not create the receipt");
  return receipt.id;
}

async function count(table: "reports" | "workspaces" | "organizations", id: string) {
  const { count: rows, error } = await adminClient()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("id", id);
  if (error) throw error;
  return rows;
}

test("an admin deletes a report from its page and lands on the dashboard", async ({ browser }) => {
  const [owner, admin] = await Promise.all([createTestUser("Odile Owner"), createTestUser("Aimé Admin")]);
  const { workspace_id: workspaceId, organization_id: organizationId } = await createWorkspaceFor(
    owner,
    "Suppression Abomey",
  );
  await setPlan(organizationId, "cabinet");
  await addMember(workspaceId, admin, "admin");
  const reportId = await addReport(workspaceId, "Rapport à supprimer", owner.id);

  const page = await pageFor(browser, admin);
  await page.goto(`/fr/rapports/${reportId}`);
  const zone = page.getByRole("region", { name: "Supprimer le rapport" });
  await expect(zone).toBeVisible();
  await zone.getByRole("button", { name: "Supprimer le rapport" }).click();

  const dialog = page.getByRole("dialog", { name: "Supprimer le rapport ?" });
  await expect(dialog).toHaveAccessibleDescription(
    "« Rapport à supprimer » sera supprimé pour tous les membres de l'espace. Cette action est définitive.",
  );
  await expect(dialog.getByText("1 section et son texte")).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Supprimer le rapport" }).click();

  await expect(page).toHaveURL(/\/fr\/tableau-de-bord\?suppression=rapport$/);
  await expect(page.getByRole("status").filter({ hasText: "Le rapport a été supprimé." })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Rapports" }).getByRole("link", { name: "Rapport à supprimer" }),
  ).toHaveCount(0);
  expect(await count("reports", reportId)).toBe(0);
});

test("a final report: admins cannot delete it, owners type its title", async ({ browser }) => {
  const [owner, admin] = await Promise.all([createTestUser("Fanny Final"), createTestUser("Adam Final")]);
  const { workspace_id: workspaceId, organization_id: organizationId } = await createWorkspaceFor(
    owner,
    "Suppression Ouidah",
  );
  await setPlan(organizationId, "cabinet");
  await addMember(workspaceId, admin, "admin");
  const reportId = await addReport(workspaceId, "Rapport final Ouidah", owner.id);
  const { error } = await adminClient().from("reports").update({ status: "final" }).eq("id", reportId);
  if (error) throw error;

  const adminPage = await pageFor(browser, admin);
  await adminPage.goto(`/fr/rapports/${reportId}`);
  const adminZone = adminPage.getByRole("region", { name: "Supprimer le rapport" });
  await expect(
    adminZone.getByText("Ce rapport est final : seul un propriétaire de l'espace peut le supprimer."),
  ).toBeVisible();
  await expect(adminZone.getByRole("button")).toHaveCount(0);
  const adminApi = await signedInClient(admin);
  const { error: refused } = await adminApi.rpc("delete_report", {
    p_report_id: reportId,
    p_confirmation: "Rapport final Ouidah",
  });
  expect(refused?.code).toBe("42501");

  const ownerPage = await pageFor(browser, owner);
  await ownerPage.goto(`/fr/rapports/${reportId}`);
  const zone = ownerPage.getByRole("region", { name: "Supprimer le rapport" });
  await expect(
    zone.getByText("Ce rapport est final : pour le supprimer, vous saisirez son titre."),
  ).toBeVisible();
  await zone.getByRole("button", { name: "Supprimer le rapport" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Supprimer le rapport ?" });
  await expect(
    dialog.getByText("Ce rapport est final : sa version finale enregistrée est supprimée aussi."),
  ).toBeVisible();

  const field = dialog.getByLabel("Saisissez « Rapport final Ouidah » pour confirmer");
  await field.fill("rapport final ouidah");
  await dialog.getByRole("button", { name: "Supprimer le rapport" }).click();
  await expect(field).toHaveAccessibleDescription(
    "Le texte ne correspond pas. Recopiez-le exactement, majuscules et accents compris.",
  );
  expect(await count("reports", reportId)).toBe(1);

  await field.fill("Rapport final Ouidah");
  await dialog.getByRole("button", { name: "Supprimer le rapport" }).click();
  await expect(ownerPage).toHaveURL(/\/fr\/tableau-de-bord\?suppression=rapport$/);
  expect(await count("reports", reportId)).toBe(0);
});

test("experts and viewers get no delete action, and the database refuses them", async ({ browser }) => {
  const [owner, expert, viewer] = await Promise.all([
    createTestUser("Omer Owner"),
    createTestUser("Elise Expert"),
    createTestUser("Victor Viewer"),
  ]);
  const {
    workspace_id: workspaceId,
    report_id: reportId,
    organization_id: organizationId,
  } = await createWorkspaceFor(owner, "Suppression Bohicon");
  await addMember(workspaceId, expert, "expert");
  await addMember(workspaceId, viewer, "viewer");

  for (const user of [expert, viewer]) {
    const page = await pageFor(browser, user);
    await page.getByRole("button", { name: /^Espace de travail actuel/ }).click();
    await expect(page.getByRole("menuitem", { name: "Modèles de prompts" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Paramètres de l'espace" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Gérer l'organisation" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto(`/fr/rapports/${reportId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rapport Suppression Bohicon");
    await expect(page.getByRole("region", { name: "Supprimer le rapport" })).toHaveCount(0);

    await page.goto(`/fr/espaces/${workspaceId}/parametres`);
    await expect(page.getByRole("heading", { name: "Page réservée" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Supprimer l'espace de travail" })).toHaveCount(0);

    const notFound = await page.goto(`/fr/organisations/${organizationId}`);
    expect(notFound?.status()).toBe(404);

    const api = await signedInClient(user);
    const { error: reportError } = await api.rpc("delete_report", { p_report_id: reportId });
    expect(reportError?.code).toBe("42501");
    const { error: workspaceError } = await api.rpc("delete_workspace", {
      p_workspace_id: workspaceId,
      p_confirmation: "Suppression Bohicon",
    });
    expect(workspaceError?.code).toBe("42501");
    const { error: organizationError } = await api.rpc("delete_organization", {
      p_organization_id: organizationId,
      p_confirmation: "Cabinet Suppression Bohicon",
    });
    expect(organizationError?.code).toBe("42501");
    // Direct deletes are not granted at all any more.
    const { error: directError } = await api.from("reports").delete().eq("id", reportId);
    expect(directError?.code).toBe("42501");
  }

  // Someone outside the workspace learns nothing.
  const stranger = await createTestUser("Sam Stranger");
  const strangerApi = await signedInClient(stranger);
  const { error: hidden } = await strangerApi.rpc("delete_report", { p_report_id: reportId });
  expect(hidden?.code).toBe("P0002");
  expect(await count("reports", reportId)).toBe(1);
});

test("an owner deletes a workspace from its settings, then the last one", async ({ browser }) => {
  const [owner, admin] = await Promise.all([createTestUser("Wanda Owner"), createTestUser("Wes Admin")]);
  const { workspace_id: firstId, organization_id: organizationId } = await createWorkspaceFor(
    owner,
    "Espace Parakou",
  );
  await setPlan(organizationId, "cabinet");
  const ownerApi = await signedInClient(owner);
  const { data: second, error } = await ownerApi
    .rpc("create_workspace_in_organization", {
      p_organization_id: organizationId,
      p_workspace_name: "Espace Natitingou",
      p_report_title: "Rapport Natitingou",
    })
    .single();
  if (error || !second) throw error ?? new Error("Could not create the second workspace");
  await addMember(firstId, admin, "admin");

  // An admin sees neither the link nor the page.
  const adminPage = await pageFor(browser, admin);
  await adminPage.getByRole("button", { name: /^Espace de travail actuel/ }).click();
  await expect(adminPage.getByRole("menuitem", { name: "Gérer les membres" })).toBeVisible();
  await expect(adminPage.getByRole("menuitem", { name: "Paramètres de l'espace" })).toHaveCount(0);
  await adminPage.keyboard.press("Escape");
  await adminPage.goto(`/fr/espaces/${firstId}/parametres`);
  await expect(adminPage.getByRole("heading", { name: "Page réservée" })).toBeVisible();

  // The owner opens the settings from the switcher.
  const page = await pageFor(browser, owner);
  await page
    .getByRole("button", { name: "Espace de travail actuel : Espace Parakou. Changer d'espace" })
    .click();
  await page.getByRole("menuitem", { name: "Paramètres de l'espace" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/espaces/${firstId}/parametres$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paramètres de Espace Parakou");
  await expect(page.getByRole("link", { name: "Gérer l'organisation" })).toBeVisible();

  await page.getByRole("button", { name: "Supprimer l'espace de travail" }).click();
  const dialog = page.getByRole("dialog", { name: "Supprimer l'espace de travail ?" });
  await expect(dialog).toHaveAccessibleDescription(
    "L'espace « Espace Parakou » sera supprimé pour ses 2 membres. Cette action est définitive.",
  );
  await expect(dialog.getByText("1 rapport", { exact: true })).toBeVisible();
  await expect(dialog.getByText("l'accès de 2 membres à cet espace")).toBeVisible();
  const field = dialog.getByLabel("Saisissez « Espace Parakou » pour confirmer");
  await field.fill("Espace Parakou");
  await dialog.getByRole("button", { name: "Supprimer l'espace de travail" }).click();

  // Back on the dashboard of the other workspace of the organization.
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord\?suppression=espace$/);
  await expect(
    page.getByRole("status").filter({ hasText: "L'espace de travail a été supprimé." }),
  ).toBeVisible();
  await expect(page.getByText("Avancement des sections de l'espace Espace Natitingou.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Espace de travail actuel : Espace Natitingou. Changer d'espace" }),
  ).toBeVisible();
  expect(await count("workspaces", firstId)).toBe(0);

  // The admin's next page no longer shows the deleted workspace.
  await adminPage.goto("/fr/tableau-de-bord");
  await expect(
    adminPage.getByRole("heading", { name: "Créez votre premier espace de travail" }),
  ).toBeVisible();

  // The last workspace: the owner lands on the wizard, the organization stays.
  await page.goto(`/fr/espaces/${second.workspace_id}/parametres`);
  await page.getByRole("button", { name: "Supprimer l'espace de travail" }).click();
  const last = page.getByRole("dialog", { name: "Supprimer l'espace de travail ?" });
  await last.getByLabel("Saisissez « Espace Natitingou » pour confirmer").fill("Espace Natitingou");
  await last.getByRole("button", { name: "Supprimer l'espace de travail" }).click();
  await expect(page).toHaveURL(/\/fr\/espaces\/nouveau$/);
  expect(await count("organizations", organizationId)).toBe(1);

  // The dashboard links to the organization the owner still has.
  await page.goto("/fr/tableau-de-bord");
  await expect(page.getByRole("link", { name: "Cabinet Espace Parakou" })).toBeVisible();
});

test("the organization owner deletes it with every workspace, warned about the plan", async ({ browser }) => {
  const [owner, partner] = await Promise.all([
    createTestUser("Orphée Owner"),
    createTestUser("Paul Partner"),
  ]);
  const { workspace_id: workspaceId, organization_id: organizationId } = await createWorkspaceFor(
    owner,
    "Mission Kandi",
  );
  const entitlementId = await setPlan(organizationId, "cabinet");
  await addMember(workspaceId, partner, "admin");
  // The partner adds a workspace the owner is not a member of.
  const partnerApi = await signedInClient(partner);
  const { data: partnerWorkspace, error } = await partnerApi
    .rpc("create_workspace_in_organization", {
      p_organization_id: organizationId,
      p_workspace_name: "Mission Malanville",
      p_report_title: "Rapport Malanville",
    })
    .single();
  if (error || !partnerWorkspace) throw error ?? new Error("Could not create the partner workspace");
  // And one more, which the organization owner deletes alone from the organization page.
  const { data: singleWorkspace, error: singleError } = await partnerApi
    .rpc("create_workspace_in_organization", {
      p_organization_id: organizationId,
      p_workspace_name: "Mission Djougou",
      p_report_title: "Rapport Djougou",
    })
    .single();
  if (singleError || !singleWorkspace)
    throw singleError ?? new Error("Could not create the second partner workspace");
  const { error: packError } = await adminClient()
    .from("billing_ai_packs")
    .insert({
      organization_id: organizationId,
      drafts: 100,
      expires_at: new Date(Date.now() + 300 * 86_400_000).toISOString(),
    });
  if (packError) throw packError;
  const receiptId = await addPaidReceipt(organizationId, "Cabinet Mission Kandi");

  // The partner owns a workspace of the organization, not the organization.
  const partnerPage = await pageFor(browser, partner);
  const notFound = await partnerPage.goto(`/fr/organisations/${organizationId}`);
  expect(notFound?.status()).toBe(404);
  const { error: refused } = await partnerApi.rpc("delete_organization", {
    p_organization_id: organizationId,
    p_confirmation: "Cabinet Mission Kandi",
  });
  expect(refused?.code).toBe("42501");

  const page = await pageFor(browser, owner);
  await page.getByRole("button", { name: /^Espace de travail actuel/ }).click();
  await page.getByRole("menuitem", { name: "Gérer l'organisation" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/organisations/${organizationId}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cabinet Mission Kandi");
  const workspaces = page.getByRole("region", { name: "Espaces de travail" });
  await expect(workspaces.getByText("Mission Kandi", { exact: true })).toBeVisible();
  await expect(workspaces.getByText("Mission Malanville", { exact: true })).toBeVisible();

  // One workspace the owner is not a member of, deleted alone with its typed name.
  await workspaces.getByRole("button", { name: "Supprimer l'espace de travail « Mission Djougou »" }).click();
  const single = page.getByRole("dialog", { name: "Supprimer l'espace de travail ?" });
  await expect(single).toHaveAccessibleDescription(
    "L'espace « Mission Djougou » sera supprimé pour son seul membre. Cette action est définitive.",
  );
  await single.getByLabel("Saisissez « Mission Djougou » pour confirmer").fill("Mission Djougou");
  await single.getByRole("button", { name: "Supprimer l'espace de travail" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/organisations/${organizationId}\\?suppression=espace$`));
  await expect(
    page.getByRole("status").filter({ hasText: "L'espace de travail a été supprimé." }),
  ).toBeVisible();
  await expect(workspaces.getByText("Mission Djougou", { exact: true })).toHaveCount(0);
  expect(await count("workspaces", singleWorkspace.workspace_id)).toBe(0);
  expect(await count("organizations", organizationId)).toBe(1);

  await page.getByRole("button", { name: "Supprimer l'organisation" }).click();
  const dialog = page.getByRole("dialog", { name: "Supprimer l'organisation ?" });
  await expect(dialog.getByText("Ses 2 espaces de travail seront supprimés avec elle :")).toBeVisible();
  await expect(dialog.getByText(/^« Mission Malanville » : 1 rapport, 1 membre$/)).toBeVisible();
  await expect(dialog.getByText(/^l'offre Cabinet, qui court jusqu'au \d{1,2} \S+ \d{4}$/)).toBeVisible();
  await expect(dialog.getByText("100 brouillons IA de Pack IA non utilisés")).toBeVisible();
  await expect(
    dialog.getByText("Le temps restant et les crédits non utilisés sont perdus, sans remboursement."),
  ).toBeVisible();
  // Receipts stay for the accounts, but nobody reads them in the app afterwards.
  await expect(
    dialog.getByText(
      /^Son reçu de paiement est conservé pour la comptabilité, mais vous ne pourrez plus le consulter/,
    ),
  ).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Abonnement" })).toHaveAttribute(
    "href",
    `/fr/organisations/${organizationId}/abonnement`,
  );

  const field = dialog.getByLabel("Saisissez « Cabinet Mission Kandi » pour confirmer");
  await field.fill("Cabinet Mission");
  await dialog.getByRole("button", { name: "Supprimer l'organisation" }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.fill("Cabinet Mission Kandi");
  await dialog.getByRole("button", { name: "Supprimer l'organisation" }).click();

  // The owner had no other workspace: the wizard.
  await expect(page).toHaveURL(/\/fr\/espaces\/nouveau$/);
  expect(await count("organizations", organizationId)).toBe(0);
  expect(await count("workspaces", workspaceId)).toBe(0);
  expect(await count("workspaces", partnerWorkspace.workspace_id)).toBe(0);
  const { count: entitlements } = await adminClient()
    .from("billing_entitlements")
    .select("id", { count: "exact", head: true })
    .eq("id", entitlementId);
  expect(entitlements).toBe(0);

  // The receipt and its payment stay, detached from the organization.
  const { data: receipt, error: receiptError } = await adminClient()
    .from("billing_receipts")
    .select("organization_id, buyer, purchase:billing_purchases(organization_id, status)")
    .eq("id", receiptId)
    .single();
  if (receiptError) throw receiptError;
  expect(receipt).toMatchObject({
    organization_id: null,
    buyer: { name: "Cabinet Mission Kandi" },
    purchase: { organization_id: null, status: "paid" },
  });
});

async function storageIsUp() {
  const { error } = await adminClient().storage.getBucket("exports");
  return !error;
}

/** Names of the objects stored directly under `folder`. */
async function storedNames(bucket: "deliverables" | "exports", folder: string) {
  const { data, error } = await adminClient().storage.from(bucket).list(folder);
  if (error) throw error;
  return data.map((file) => file.name);
}

test("the files of a deleted workspace are removed by the cleanup job", async ({ request }) => {
  const cronSecret = process.env.CRON_SECRET;
  test.skip(
    !process.env.CI && (!cronSecret || !(await storageIsUp())),
    "Needs the Storage container and CRON_SECRET in .env.local (CI has both)",
  );

  const owner = await createTestUser("Rita Rangement");
  const {
    api,
    workspace_id: workspaceId,
    report_id: reportId,
  } = await createWorkspaceFor(owner, "Rangement Lokossa");
  const admin = adminClient();
  const { data: section, error: sectionError } = await admin
    .from("report_sections")
    .insert({ workspace_id: workspaceId, report_id: reportId, title: "Annexes" })
    .select("id")
    .single();
  if (sectionError || !section) throw sectionError ?? new Error("Could not create the section");

  // A deliverable registered three hours ago, past its upload window.
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const deliverableFolder = `${workspaceId}/${section.id}`;
  const deliverableName = `${randomUUID()}-releves.txt`;
  const notes = Buffer.from("Relevés du site.");
  const { error: uploadError } = await admin.storage
    .from("deliverables")
    .upload(`${deliverableFolder}/${deliverableName}`, notes, { contentType: "text/plain" });
  if (uploadError) throw uploadError;
  const { error: deliverableError } = await admin.from("deliverables").insert({
    workspace_id: workspaceId,
    section_id: section.id,
    uploaded_by: owner.id,
    storage_path: `${deliverableFolder}/${deliverableName}`,
    file_name: "releves.txt",
    mime_type: "text/plain",
    size_bytes: notes.length,
    uploaded_at: threeHoursAgo,
    created_at: threeHoursAgo,
  });
  if (deliverableError) throw deliverableError;

  // An export file no row records, as a request that died would leave it.
  const exportFolder = `${workspaceId}/${reportId}`;
  const { error: exportError } = await admin.storage
    .from("exports")
    .upload(`${exportFolder}/${randomUUID()}.pdf`, Buffer.from("%PDF-1.4\n%%EOF\n"), {
      contentType: "application/pdf",
    });
  if (exportError) throw exportError;

  const { error: deleteError } = await api.rpc("delete_workspace", {
    p_workspace_id: workspaceId,
    p_confirmation: "Rangement Lokossa",
  });
  expect(deleteError).toBeNull();

  const response = await request.get(CRON_PATH, { headers: { Authorization: `Bearer ${cronSecret}` } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, failed: 0 });
  expect(await storedNames("deliverables", deliverableFolder)).toEqual([]);
  expect(await storedNames("exports", exportFolder)).toEqual([]);
});
