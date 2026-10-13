import { expect, test, type Page } from "@playwright/test";
import { clearInbox, waitForAuthLink } from "./mailpit";

// KRB-10 / KRB-59: sign-up, confirmation, sign-in, sign-out and password reset in French.
test.describe.configure({ mode: "serial" });

const email = `e2e+${Date.now()}@kolabreport.test`;
const firstPassword = "Kolab-test-2026";
const newPassword = "Nouveau-mdp-2026";

async function signIn(page: Page, password: string) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/fr\/connexion$/);
}

test("protected pages send visitors to sign-in with a next parameter", async ({ page }) => {
  await page.goto("/fr/tableau-de-bord");
  await expect(page).toHaveURL("/fr/connexion?next=%2Ffr%2Ftableau-de-bord");
});

test("wrong credentials show one generic error", async ({ page }) => {
  await signIn(page, "pas-le-bon-mot-de-passe");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Adresse e-mail ou mot de passe incorrect.");
});

test("sign-up validates fields next to each input", async ({ page }) => {
  await page.goto("/fr/inscription");
  await page.getByLabel("Adresse e-mail").fill("pas-une-adresse");
  await page.getByLabel("Mot de passe", { exact: true }).fill("court");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Indiquez votre nom.")).toBeVisible();
  await expect(page.getByText("Saisissez une adresse e-mail valide.")).toBeVisible();
  await expect(page.getByText("Le mot de passe doit faire au moins 8 caractères.")).toBeVisible();
});

test("sign-up sends a French confirmation e-mail that signs the user in", async ({ page }) => {
  await clearInbox(email);
  await page.goto("/fr/inscription");
  await page.getByLabel("Nom complet").fill("Aïcha Kossou");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(firstPassword);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Vérifiez votre boîte mail")).toBeVisible();

  // Not confirmed yet: sign-in explains why.
  await signIn(page, firstPassword);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Confirmez d'abord votre adresse e-mail avec le lien reçu.");

  const link = await waitForAuthLink(email, "Confirmez votre adresse e-mail");
  await page.goto(link);
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);
});

test("signed-in users skip the sign-in and sign-up pages, then sign out", async ({ page }) => {
  await signIn(page, firstPassword);
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);

  await page.goto("/fr/connexion");
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);
  await page.goto("/fr/inscription");
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);

  await signOut(page);
  await page.goto("/fr/tableau-de-bord");
  await expect(page).toHaveURL(/\/fr\/connexion\?next=/);
});

test("password reset works once and the old password stops working", async ({ page }) => {
  await clearInbox(email);
  await page.goto("/fr/mot-de-passe-oublie");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(page.getByRole("status")).toContainText("un lien vient d'être envoyé");

  const link = await waitForAuthLink(email, "Choisissez un nouveau mot de passe");
  await page.goto(link);
  await expect(page).toHaveURL(/\/fr\/reinitialiser-mot-de-passe$/);

  await page.getByLabel("Nouveau mot de passe").fill(newPassword);
  await page.getByLabel("Confirmez le mot de passe").fill("autre-chose-2026");
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(page.getByText("Les deux mots de passe ne correspondent pas.")).toBeVisible();

  await page.getByLabel("Nouveau mot de passe").fill(newPassword);
  await page.getByLabel("Confirmez le mot de passe").fill(newPassword);
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);
  await signOut(page);

  // The same link cannot be used twice.
  await page.goto(link);
  await expect(page).toHaveURL(/\/fr\/connexion\?erreur=lien-invalide$/);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Ce lien n'est plus valide. Demandez-en un nouveau.");

  await signIn(page, firstPassword);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Adresse e-mail ou mot de passe incorrect.");
  await signIn(page, newPassword);
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);
});

test("the reset page without a recovery session asks for a new link", async ({ page }) => {
  await page.goto("/fr/reinitialiser-mot-de-passe");
  await expect(page.getByText("Lien expiré")).toBeVisible();
  await expect(page.getByRole("link", { name: "Demander un nouveau lien" })).toHaveAttribute(
    "href",
    "/fr/mot-de-passe-oublie",
  );
});

test("the callback rejects redirects to other sites", async ({ page }) => {
  await page.goto("/fr/auth/callback?next=//evil.example&token_hash=nope&type=email");
  await expect(page).toHaveURL(/\/fr\/connexion\?erreur=lien-invalide$/);
});
