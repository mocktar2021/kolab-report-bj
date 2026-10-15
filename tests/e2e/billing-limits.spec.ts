import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  addParsedDeliverable,
  adminClient,
  createTestUser,
  createWorkspaceFor,
  setPlan,
  signedInClient,
  type TestUser,
} from "./supabase";

// KRB-175: the limits of the organization's plan (ADR 001, sections 3.4 and
// 7). Billing is enforced locally and in CI (supabase/seed.sql). Each test
// starts its own organization, on the trial unless it says otherwise. The
// app runs with AI_PROVIDER=mock and AI_RATE_LIMIT_PER_HOUR=5.
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

function tokenHash() {
  return createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex");
}

/** "8 octobre 2026", in Benin time, like the app. */
function frenchDate(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Africa/Porto-Novo" }).format(date);
}

async function trialOf(organizationId: string) {
  const { data, error } = await adminClient()
    .from("billing_entitlements")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("plan", "trial")
    .single();
  if (error || !data) throw error ?? new Error("No trial");
  return data.id;
}

test("billing is enforced on this stack", async () => {
  const owner = await createTestUser("Esther Essai");
  const { api, organization_id: organizationId } = await createWorkspaceFor(owner, "Essai Abomey");
  const { data, error } = await api.rpc("billing_overview", { p_organization_id: organizationId });
  if (error) throw error;
  expect(data, "supabase/seed.sql turns billing on for local and CI runs").toMatchObject({
    enforced: true,
    subscription: { state: "trialing", plan: "trial" },
  });
});

test("members: the plan's limit counts open invitations, viewers are free, two invitations at once", async ({
  page,
}) => {
  const [owner, admin, viewer] = await Promise.all([
    createTestUser("Odile Indep"),
    createTestUser("Aime Admin"),
    createTestUser("Valere Lecteur"),
  ]);
  const { workspace_id: workspaceId, organization_id: organizationId } = await createWorkspaceFor(
    owner,
    "Mission Dassa",
  );
  // Indépendant: 3 members. The owner and the admin take 2, the viewer none.
  await setPlan(organizationId, "independant");
  const { error: membersError } = await adminClient()
    .from("workspace_members")
    .insert([
      { workspace_id: workspaceId, user_id: admin.id, role: "admin" },
      { workspace_id: workspaceId, user_id: viewer.id, role: "viewer" },
    ]);
  if (membersError) throw membersError;

  // The owner and the admin each invite an expert at the same moment: the
  // database counts one after the other, so exactly one gets the last seat.
  const [ownerApi, adminApi] = await Promise.all([signedInClient(owner), signedInClient(admin)]);
  const results = await Promise.all([
    ownerApi.from("workspace_invitations").insert({
      workspace_id: workspaceId,
      email: `e2e-course-a-${Date.now()}@kolabreport.test`,
      role: "expert",
      token_hash: tokenHash(),
    }),
    adminApi.from("workspace_invitations").insert({
      workspace_id: workspaceId,
      email: `e2e-course-b-${Date.now()}@kolabreport.test`,
      role: "expert",
      token_hash: tokenHash(),
    }),
  ]);
  expect(results.filter((result) => !result.error)).toHaveLength(1);
  expect(results.find((result) => result.error)?.error?.code).toBe("KR040");

  await signIn(page, owner);
  await page.goto(`/fr/espaces/${workspaceId}/membres`);
  const main = page.getByRole("main");

  // A fourth person with a seat is refused, with the plan's numbers.
  await main.getByLabel("Adresse e-mail").fill(`e2e-quatrieme-${Date.now()}@kolabreport.test`);
  await main.getByLabel("Rôle", { exact: true }).selectOption("expert");
  await main.getByRole("button", { name: "Envoyer l'invitation", exact: true }).click();
  await expect(
    main.getByText(
      "Limite de membres atteinte : l'offre Indépendant compte 3 membres, invitations en attente comprises. Annulez une invitation, retirez un membre ou invitez cette personne comme lecteur, les lecteurs sont gratuits.",
    ),
  ).toBeVisible();

  // The same address as a viewer goes through.
  const reader = `e2e-lecteur-${Date.now()}@kolabreport.test`;
  await main.getByLabel("Adresse e-mail").fill(reader);
  await main.getByLabel("Rôle", { exact: true }).selectOption("viewer");
  await main.getByRole("button", { name: "Envoyer l'invitation", exact: true }).click();
  await expect(main.getByRole("region", { name: "Invitations en attente" }).getByText(reader)).toBeVisible();

  // A viewer cannot become an expert while the plan is full.
  await main.getByLabel(`Rôle de ${viewer.name}`, { exact: true }).selectOption("expert");
  await main.getByRole("button", { name: `Enregistrer le rôle de ${viewer.name}` }).click();
  await expect(
    main.getByText(
      "Limite de membres atteinte : l'offre Indépendant compte 3 membres. Cette personne peut rester lecteur, ou libérez une place.",
    ),
  ).toBeVisible();
  const { data: membership } = await adminClient()
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", viewer.id)
    .single();
  expect(membership?.role).toBe("viewer");
});

test("reports: a second active report is refused on the trial", async ({ page }) => {
  const owner = await createTestUser("Rita Rapport");
  const { workspace_id: workspaceId } = await createWorkspaceFor(owner, "Etude Kandi");

  await signIn(page, owner);
  const reports = page.getByRole("main").getByRole("region", { name: "Rapports", exact: true });
  await reports.getByRole("button", { name: "Nouveau rapport" }).click();
  const dialog = page.getByRole("dialog", { name: "Nouveau rapport" });
  await dialog.getByLabel("Titre du rapport").fill("Rapport de trop");
  await dialog.getByRole("button", { name: "Créer le rapport" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Limite de rapports actifs atteinte : l'offre Essai gratuit en compte 1. Passez un rapport en final ou supprimez-le, ou changez d'offre.",
  );

  const { count } = await adminClient()
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  expect(count).toBe(1);
});

test("AI drafts: the trial's 20 drafts, counted when they succeed", async ({ page }) => {
  const owner = await createTestUser("Damien Drafts");
  const {
    api,
    workspace_id: workspaceId,
    report_id: reportId,
    organization_id: organizationId,
  } = await createWorkspaceFor(owner, "Brouillons Parakou");
  const { data: section, error } = await api
    .from("report_sections")
    .insert({ workspace_id: workspaceId, report_id: reportId, title: "Constats", assigned_to: owner.id })
    .select("id")
    .single();
  if (error || !section) throw error ?? new Error("Could not create the section");
  await addParsedDeliverable(
    workspaceId,
    section.id,
    owner.id,
    "constats.md",
    "## Constats\n\nLe taux d'accès à l'eau potable est passé de 41 % à 57 % entre 2023 et 2026.",
  );
  const { data: template, error: templateError } = await adminClient()
    .from("prompt_library")
    .select("id")
    .is("workspace_id", null)
    .eq("template_key", "synthese-section")
    .eq("status", "published")
    .single();
  if (templateError || !template) throw templateError ?? new Error("No published synthese-section template");

  // 19 of the trial's 20 drafts are already used.
  const trial = await trialOf(organizationId);
  const month = new Date().toISOString().slice(0, 8) + "01";
  const { error: usageError } = await adminClient()
    .from("billing_draft_usage")
    .insert(
      Array.from({ length: 19 }, () => ({
        generation_id: crypto.randomUUID(),
        organization_id: organizationId,
        workspace_id: workspaceId,
        pool: "trial",
        entitlement_id: trial,
        usage_month: month,
        status: "counted",
        settled_at: new Date().toISOString(),
      })),
    );
  if (usageError) throw usageError;

  await signIn(page, owner);
  const route = `/api/ai/sections/${section.id}/draft`;
  const last = await page.request.post(route, { data: { promptVersionId: template.id } });
  expect(last.status()).toBe(200);
  const done = (await last.text())
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { type: string; generationId?: string })
    .find((event) => event.type === "done");
  expect(done?.generationId).toBeTruthy();
  const { data: counted } = await adminClient()
    .from("billing_draft_usage")
    .select("pool, status")
    .eq("generation_id", done!.generationId!)
    .single();
  expect(counted).toEqual({ pool: "trial", status: "counted" });

  const refused = await page.request.post(route, { data: { promptVersionId: template.id } });
  expect(refused.status()).toBe(402);
  expect(refused.headers()["retry-after"]).toBeUndefined();
  expect(await refused.json()).toEqual({ error: "quotaExceededTrial", values: { max: 20 } });

  await page.goto(`/fr/espaces/${workspaceId}/sections/${section.id}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Générer un brouillon" }).click();
  await expect(main.getByRole("alert")).toContainText(
    "Les 20 brouillons IA de l'essai sont utilisés. Choisissez une offre pour continuer.",
  );
});

test("read-only: invitations, reports and drafts are refused, and the owner sees since when", async ({
  page,
}) => {
  const owner = await createTestUser("Ruth Renouvelle");
  const {
    api,
    workspace_id: workspaceId,
    report_id: reportId,
    organization_id: organizationId,
  } = await createWorkspaceFor(owner, "Etude Lokossa");
  const { data: section, error: sectionError } = await api
    .from("report_sections")
    .insert({ workspace_id: workspaceId, report_id: reportId, title: "Annexes", assigned_to: owner.id })
    .select("id")
    .single();
  if (sectionError || !section) throw sectionError ?? new Error("Could not create the section");
  await addParsedDeliverable(
    workspaceId,
    section.id,
    owner.id,
    "annexes.md",
    "## Annexes\n\nListe des villages.",
  );
  const { data: template } = await adminClient()
    .from("prompt_library")
    .select("id")
    .is("workspace_id", null)
    .eq("template_key", "synthese-section")
    .eq("status", "published")
    .single();

  // The trial ended 10 days ago: its 7 days of grace are over.
  const day = 86_400_000;
  const endsAt = new Date(Date.now() - 10 * day);
  const { error } = await adminClient()
    .from("billing_entitlements")
    .update({ starts_at: new Date(Date.now() - 24 * day).toISOString(), ends_at: endsAt.toISOString() })
    .eq("id", await trialOf(organizationId));
  if (error) throw error;

  await signIn(page, owner);
  await page.goto(`/fr/espaces/${workspaceId}/membres`);
  const main = page.getByRole("main");
  await main.getByLabel("Adresse e-mail").fill(`e2e-lecture-${Date.now()}@kolabreport.test`);
  await main.getByLabel("Rôle", { exact: true }).selectOption("viewer");
  await main.getByRole("button", { name: "Envoyer l'invitation", exact: true }).click();
  await expect(
    main.getByText(
      `Cet espace de travail est en lecture seule depuis le ${frenchDate(new Date(endsAt.getTime() + 7 * day))}. Vous pouvez consulter et exporter les rapports. Renouvelez l'offre pour les modifier.`,
    ),
  ).toBeVisible();

  const report = await api
    .from("reports")
    .insert({ workspace_id: workspaceId, title: "Rapport en lecture seule" });
  expect(report.error?.code).toBe("KR043");

  const draft = await page.request.post(`/api/ai/sections/${section.id}/draft`, {
    data: { promptVersionId: template?.id },
  });
  expect(draft.status()).toBe(403);
  expect(await draft.json()).toEqual({ error: "readOnly" });
});
