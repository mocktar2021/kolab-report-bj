import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { clearInbox, waitForAuthLink, waitForLink } from "./mailpit";
import { adminClient, createTestUser, createWorkspaceFor, signedInClient, type TestUser } from "./supabase";

// KRB-12: invitations by e-mail.
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, user: TestUser, next?: string) {
  await page.goto(next ? `/fr/connexion?next=${encodeURIComponent(next)}` : "/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token).digest("hex") };
}

test("an invitee without an account signs up from the e-mail and joins on first login", async ({
  browser,
}) => {
  const owner = await createTestUser("Koffi Owner");
  const { workspace_id } = await createWorkspaceFor(owner, "Audit Porto-Novo");
  const invitee = `e2e-invitee-${Date.now()}@kolabreport.test`;
  await clearInbox(invitee);

  // The owner invites from the members page.
  const ownerPage = await newPage(browser);
  await signIn(ownerPage, owner);
  await ownerPage.goto(`/fr/espaces/${workspace_id}/membres`);
  await ownerPage.getByLabel("Adresse e-mail").fill(invitee);
  await ownerPage.getByLabel("Rôle", { exact: true }).selectOption("expert");
  await ownerPage.getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(ownerPage.getByText(`Invitation envoyée à ${invitee}.`)).toBeVisible();
  await expect(
    ownerPage.getByRole("region", { name: "Invitations en attente" }).getByText(invitee),
  ).toBeVisible();

  // The French e-mail carries the link to the invitation page.
  const link = await waitForLink(
    invitee,
    "Koffi Owner vous invite sur KolabReport",
    /href="([^"]*\/fr\/invitations\/[^"]+)"/,
  );

  // Signed out, the page shows who invites them and leads to the sign-up.
  const page = await newPage(browser);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Rejoindre Audit Porto-Novo" })).toBeVisible();
  await expect(page.getByText(`Cette invitation est destinée à ${invitee}.`)).toBeVisible();
  await page.getByRole("link", { name: "Créer mon compte" }).click();
  await expect(page.getByLabel("Adresse e-mail")).toHaveValue(invitee);
  await page.getByLabel("Nom complet").fill("Ines Invitee");
  await page.getByLabel("Mot de passe", { exact: true }).fill("Kolab-test-2026");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Vérifiez votre boîte mail")).toBeVisible();

  // Confirming the address signs them in and adds them to the workspace.
  await page.goto(await waitForAuthLink(invitee, "Confirmez votre adresse e-mail"));
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);
  await expect(
    page.getByRole("button", { name: /Espace de travail actuel : Audit Porto-Novo/ }),
  ).toBeVisible();

  const { data: membership } = await adminClient()
    .from("workspace_members")
    .select("role, profile:profiles!workspace_members_user_id_fkey(email)")
    .eq("workspace_id", workspace_id);
  expect(membership?.find((row) => row.profile?.email === invitee)?.role).toBe("expert");

  // The invitation leaves the pending list.
  await ownerPage.reload();
  await expect(ownerPage.getByText("Aucune invitation en attente.")).toBeVisible();
});

test("existing users join from the link or at sign-in; used, expired and unknown links show an error", async ({
  browser,
}) => {
  const [owner, member, walker, latecomer] = await Promise.all([
    createTestUser("Olu Owner"),
    createTestUser("Mia Member"),
    createTestUser("Wale Walker"),
    createTestUser("Leo Latecomer"),
  ]);
  const { api: ownerApi, workspace_id } = await createWorkspaceFor(owner, "Mission Ouidah");

  // Mia is already signed in when the invitation arrives.
  const memberPage = await newPage(browser);
  await signIn(memberPage, member);

  const valid = newToken();
  const expired = newToken();
  const { error } = await ownerApi.from("workspace_invitations").insert([
    { workspace_id, email: member.email, role: "viewer", token_hash: valid.tokenHash },
    { workspace_id, email: walker.email, role: "expert", token_hash: newToken().tokenHash },
    { workspace_id, email: latecomer.email, role: "expert", token_hash: expired.tokenHash },
  ]);
  if (error) throw error;
  await adminClient()
    .from("workspace_invitations")
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("token_hash", expired.tokenHash);

  // Signed in with the invited address, one click joins.
  await memberPage.goto(`/fr/invitations/${valid.token}`);
  await expect(memberPage.getByRole("heading", { name: "Rejoindre Mission Ouidah" })).toBeVisible();
  await memberPage.getByRole("button", { name: "Rejoindre l'espace" }).click();
  await expect(memberPage).toHaveURL(/\/fr\/tableau-de-bord$/);
  await expect(
    memberPage.getByRole("button", { name: /Espace de travail actuel : Mission Ouidah/ }),
  ).toBeVisible();

  // Opening the link again just leads back to the workspace.
  await memberPage.goto(`/fr/invitations/${valid.token}`);
  await expect(memberPage.getByRole("heading", { name: "Vous avez rejoint Mission Ouidah" })).toBeVisible();

  // For anyone else the link is used.
  const other = await newPage(browser);
  await other.goto(`/fr/invitations/${valid.token}`);
  await expect(other.getByRole("heading", { name: "Invitation déjà utilisée" })).toBeVisible();

  // Wale never opens the link: signing in is enough.
  const walkerPage = await newPage(browser);
  await signIn(walkerPage, walker);
  await expect(
    walkerPage.getByRole("button", { name: /Espace de travail actuel : Mission Ouidah/ }),
  ).toBeVisible();

  // Expired: error page, and the API refuses it too, so no membership.
  await other.goto(`/fr/invitations/${expired.token}`);
  await expect(other.getByRole("heading", { name: "Invitation expirée" })).toBeVisible();
  const latecomerApi = await signedInClient(latecomer);
  const { error: expiredError } = await latecomerApi.rpc("accept_workspace_invitation", {
    token: expired.token,
  });
  expect(expiredError?.code).toBe("KR005");
  const { count } = await adminClient()
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspace_id)
    .eq("user_id", latecomer.id);
  expect(count).toBe(0);

  // Unknown token.
  await other.goto(`/fr/invitations/${newToken().token}`);
  await expect(other.getByRole("heading", { name: "Invitation introuvable" })).toBeVisible();
});

test("admins cannot invite owners", async ({ browser }) => {
  const [owner, admin] = await Promise.all([createTestUser("Ola Owner"), createTestUser("Ada Admin")]);
  const { workspace_id } = await createWorkspaceFor(owner, "Etude Abomey");
  const { error } = await adminClient()
    .from("workspace_members")
    .insert({ workspace_id, user_id: admin.id, role: "admin" });
  if (error) throw error;

  const page = await newPage(browser);
  await signIn(page, admin);
  await page.goto(`/fr/espaces/${workspace_id}/membres`);
  await expect(
    page.getByLabel("Rôle", { exact: true }).locator("option", { hasText: "Propriétaire" }),
  ).toHaveCount(0);

  const adminApi = await signedInClient(admin);
  const { error: ownerInvite } = await adminApi.from("workspace_invitations").insert({
    workspace_id,
    email: "boss@kolabreport.test",
    role: "owner",
    token_hash: newToken().tokenHash,
  });
  expect(ownerInvite?.code).toBe("42501");
});
