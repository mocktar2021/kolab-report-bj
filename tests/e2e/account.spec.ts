import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { adminClient, createTestUser, createWorkspaceFor, signedInClient, type TestUser } from "./supabase";

// KRB-186: the account page. Download my data, transfer an organization,
// and delete my account, with the rules that block a deletion.
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);

async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);
}

async function addMember(workspaceId: string, user: TestUser, role: "owner" | "expert" | "viewer") {
  const { error } = await adminClient()
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: user.id, role });
  if (error) throw error;
}

function deleteSection(page: Page) {
  return page.getByRole("region", { name: "Supprimer mon compte" });
}

test("the account page downloads the user's data and nothing from another workspace", async ({
  page,
  browser,
}) => {
  const [awa, bio] = await Promise.all([createTestUser("Awa Export"), createTestUser("Bio Autre")]);
  const mine = await createWorkspaceFor(awa, `Export Awa ${RUN}`);
  const theirs = await createWorkspaceFor(bio, `Export Bio ${RUN}`);
  // A workspace they share, where Bio has a second report of his own. Written
  // with the service role: the trial allows one active report.
  const shared = await createWorkspaceFor(bio, `Export Commun ${RUN}`);
  await addMember(shared.workspace_id, awa, "expert");
  const { error } = await adminClient()
    .from("reports")
    .insert({ workspace_id: shared.workspace_id, title: `Rapport de Bio ${RUN}`, created_by: bio.id });
  expect(error).toBeNull();

  await signIn(page, awa);
  await page.getByRole("banner").getByRole("link", { name: "Mon compte" }).click();
  await expect(page).toHaveURL(/\/fr\/compte$/);
  await expect(page).toHaveTitle("Mon compte · KolabReport");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Mon compte");

  // Change my name.
  await main.getByLabel("Nom complet").fill("Awa Export Modifiée");
  await main.getByRole("button", { name: "Enregistrer" }).click();
  await expect(main.getByText("Nom enregistré.")).toBeVisible();

  // The file, as the browser downloads it.
  const download = page.waitForEvent("download");
  await main.getByRole("link", { name: "Télécharger mes données" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^kolabreport-mes-donnees-\d{4}-\d{2}-\d{2}\.json$/);
  const text = await readFile(await file.path(), "utf8");
  const data = JSON.parse(text);

  expect(data.account).toMatchObject({ id: awa.id, email: awa.email });
  expect(data.account.user_metadata.full_name).toBe("Awa Export Modifiée");
  expect(data.profile).toMatchObject({ id: awa.id, full_name: "Awa Export Modifiée" });
  expect(data.sessions.length).toBeGreaterThan(0);
  expect(data.organizations_owned.map((o: { id: string }) => o.id)).toEqual([mine.organization_id]);
  expect(
    data.memberships.map((m: { workspace_id: string; role: string }) => [m.workspace_id, m.role]).sort(),
  ).toEqual(
    [
      [mine.workspace_id, "owner"],
      [shared.workspace_id, "expert"],
    ].sort(),
  );
  expect(data.reports_created.map((r: { id: string }) => r.id)).toEqual([mine.report_id]);
  // Nothing about Bio: not his workspace, not his report, not his address.
  expect(text).not.toContain(theirs.workspace_id);
  expect(text).not.toContain(theirs.organization_id);
  expect(text).not.toContain(`Rapport de Bio ${RUN}`);
  expect(text).not.toContain(bio.email);
  expect(text).not.toContain(bio.id);

  // Never cached, always a download.
  const response = await page.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["content-disposition"]).toMatch(
    /^attachment; filename="kolabreport-mes-donnees-/,
  );
  expect(response.headers()["content-type"]).toContain("application/json");

  // Signed out, there is nothing to download.
  const visitor = await browser.newContext();
  const anonymous = await visitor.request.get("/api/account/export");
  expect(anonymous.status()).toBe(401);
  await visitor.close();
});

test("a blocked deletion shows its reasons and the ways out", async ({ page }) => {
  const [cyr, dede] = await Promise.all([createTestUser("Cyr Bloque"), createTestUser("Dede Lecteur")]);
  const { organization_id: organizationId, workspace_id: workspaceId } = await createWorkspaceFor(
    cyr,
    `Bloque ${RUN}`,
  );

  await signIn(page, cyr);
  await page.goto("/fr/compte");
  const section = deleteSection(page);
  await expect(
    section.getByRole("heading", { name: "Votre compte ne peut pas encore être supprimé" }),
  ).toBeVisible();
  const reasons = section.getByRole("list", { name: "Votre compte ne peut pas encore être supprimé" });
  await expect(reasons.getByRole("listitem")).toHaveCount(2);
  await expect(reasons.getByRole("listitem").nth(0)).toContainText(
    `Vous êtes propriétaire de l'organisation Cabinet Bloque ${RUN} et personne ne peut la reprendre.`,
  );
  await expect(reasons.getByRole("link", { name: "Supprimer l'organisation" })).toHaveAttribute(
    "href",
    `/fr/organisations/${organizationId}`,
  );
  await expect(reasons.getByRole("listitem").nth(1)).toContainText(
    `Vous êtes le seul membre de l'espace de travail Bloque ${RUN}. Supprimez-le d'abord.`,
  );
  await expect(reasons.getByRole("link", { name: "Supprimer l'espace de travail" })).toHaveAttribute(
    "href",
    `/fr/espaces/${workspaceId}/parametres`,
  );
  await expect(section.getByRole("button", { name: "Supprimer mon compte" })).toHaveCount(0);
  // Nobody can take the organization over yet.
  await expect(
    page
      .getByRole("region", { name: "Transférer une organisation" })
      .getByText(/Personne ne peut encore reprendre/),
  ).toBeVisible();
  await expectNoAxeViolations(page, "/fr/compte, deletion blocked");

  // With another member, the workspace needs another owner instead.
  await addMember(workspaceId, dede, "viewer");
  await page.reload();
  await expect(reasons.getByRole("listitem").nth(1)).toContainText(
    `Vous êtes le seul propriétaire de l'espace de travail Bloque ${RUN}, qui compte 1 autre membre.`,
  );
  await expect(reasons.getByRole("link", { name: "Nommer un autre propriétaire" })).toHaveAttribute(
    "href",
    `/fr/espaces/${workspaceId}/membres`,
  );
});

test("an owner transfers the organization, then deletes the account and is signed out", async ({ page }) => {
  const [edem, fifa, gildas] = await Promise.all([
    createTestUser("Edem Cedant"),
    createTestUser("Fifa Repreneuse"),
    createTestUser("Gildas Invitant"),
  ]);
  const {
    organization_id: organizationId,
    workspace_id: workspaceId,
    report_id: reportId,
  } = await createWorkspaceFor(edem, `Cession ${RUN}`);
  await addMember(workspaceId, fifa, "owner");
  // An invitation sent to Edem's address from another firm.
  const elsewhere = await createWorkspaceFor(gildas, `Ailleurs ${RUN}`);
  const admin = adminClient();
  const { error: inviteError } = await admin.from("workspace_invitations").insert({
    workspace_id: elsewhere.workspace_id,
    email: edem.email,
    role: "viewer",
    token_hash: randomBytes(32).toString("hex"),
    invited_by: gildas.id,
  });
  expect(inviteError).toBeNull();
  // An invitation Edem sends, still open when the account goes. Same hash as
  // src/lib/invitations/token.ts, which only loads on the server.
  const token = randomBytes(32).toString("base64url");
  const guestEmail = `e2e-invite-${RUN}@kolabreport.test`;
  const { error: sentError } = await admin.from("workspace_invitations").insert({
    workspace_id: workspaceId,
    email: guestEmail,
    role: "viewer",
    token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
    invited_by: edem.id,
  });
  expect(sentError).toBeNull();

  await signIn(page, edem);
  await page.goto("/fr/compte");
  const main = page.getByRole("main");
  const reasons = deleteSection(page).getByRole("list", {
    name: "Votre compte ne peut pas encore être supprimé",
  });
  await expect(reasons.getByRole("listitem")).toHaveCount(1);
  await expect(reasons).toContainText(
    `Vous êtes propriétaire de l'organisation Cabinet Cession ${RUN}. Transférez-la à une autre personne ou supprimez-la.`,
  );
  await expect(reasons.getByRole("link", { name: "Transférer l'organisation" })).toHaveAttribute(
    "href",
    "/fr/compte#transfert",
  );

  // Transfer, after a confirmation.
  await main
    .getByLabel(`Nouveau propriétaire de Cabinet Cession ${RUN}`)
    .selectOption({ label: "Fifa Repreneuse" });
  await main.getByRole("button", { name: "Transférer", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: `Transférer Cabinet Cession ${RUN} ?` });
  await expect(confirm).toContainText("Fifa Repreneuse devient propriétaire de l'organisation.");
  await confirm.getByRole("button", { name: "Transférer l'organisation" }).click();
  await expect(page).toHaveURL(/\/fr\/compte\?transfert=effectue$/);
  await expect(
    main.getByRole("status").filter({ hasText: "L'organisation a été transférée." }),
  ).toBeVisible();
  const { data: organization } = await admin
    .from("organizations")
    .select("owner_id")
    .eq("id", organizationId)
    .single();
  expect(organization?.owner_id).toBe(fifa.id);
  await expect(page.getByRole("region", { name: "Transférer une organisation" })).toHaveCount(0);

  // Nothing blocks any more. A wrong password deletes nothing.
  await deleteSection(page).getByRole("button", { name: "Supprimer mon compte" }).click();
  const dialog = page.getByRole("dialog", { name: "Supprimer votre compte ?" });
  await dialog.getByLabel("Adresse e-mail du compte").fill(edem.email);
  await dialog.getByLabel("Mot de passe actuel", { exact: true }).fill("Pas-le-bon-2026");
  await dialog.getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Mot de passe incorrect.");
  expect((await admin.auth.admin.getUserById(edem.id)).data.user?.id).toBe(edem.id);

  await expect(dialog.getByLabel("Adresse e-mail du compte")).toHaveValue(edem.email);
  await dialog.getByLabel("Mot de passe actuel", { exact: true }).fill(edem.password);
  await dialog.getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(page).toHaveURL(/\/fr\/compte-supprime$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Compte supprimé");
  await expect(page.getByText("Vous êtes déconnecté.", { exact: false })).toBeVisible();

  // Signed out, and the old password no longer works.
  await page.goto("/fr/tableau-de-bord");
  await expect(page).toHaveURL(/\/fr\/connexion\?next=/);
  await page.getByLabel("Adresse e-mail").fill(edem.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(edem.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Adresse e-mail ou mot de passe incorrect.",
  );

  // The account is gone; the workspace, its report and its other owner stay.
  expect((await admin.auth.admin.getUserById(edem.id)).data.user).toBeNull();
  const { count: profiles } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("id", edem.id);
  expect(profiles).toBe(0);
  const { data: workspace } = await admin
    .from("workspaces")
    .select("created_by")
    .eq("id", workspaceId)
    .single();
  expect(workspace).toEqual({ created_by: null });
  const { data: report } = await admin.from("reports").select("created_by").eq("id", reportId).single();
  expect(report).toEqual({ created_by: null });
  const { data: owners } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner");
  expect(owners).toEqual([{ user_id: fifa.id }]);
  const { count: invitations } = await admin
    .from("workspace_invitations")
    .select("id", { count: "exact", head: true })
    .eq("email", edem.email);
  expect(invitations).toBe(0);

  // The invitation Edem sent belongs to the workspace and keeps working.
  const { data: sent } = await admin
    .from("workspace_invitations")
    .select("invited_by, revoked_at")
    .eq("email", guestEmail)
    .single();
  expect(sent).toEqual({ invited_by: null, revoked_at: null });
  await page.goto(`/fr/invitations/${token}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Rejoindre Cession ${RUN}`);
  await expect(page.getByText("Vous êtes invité en tant que lecteur.")).toBeVisible();
  await expect(page.getByText(`Cette invitation est destinée à ${guestEmail}.`)).toBeVisible();

  // Signing up again with the same address gives no new trial.
  const password = "Retour-compte-2026";
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: edem.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Edem Revenu" },
  });
  expect(createError).toBeNull();
  const back: TestUser = { id: created.user!.id, name: "Edem Revenu", email: edem.email, password };
  const again = await createWorkspaceFor(back, `Retour ${RUN}`);
  const { count: trials } = await admin
    .from("billing_entitlements")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", again.organization_id);
  expect(trials).toBe(0);
  // Its own client sees the same.
  const api = await signedInClient(back);
  const { data: state } = await api
    .rpc("workspace_billing_state", { p_workspace_id: again.workspace_id })
    .single();
  expect(state?.plan ?? null).toBeNull();
});
