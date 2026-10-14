import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fillSecret, runTag, signupAddress, smoke } from "./support";

// Sign-up without polluting the site: the form check sends nothing to
// Supabase. A real account is only created when SMOKE_SIGNUP_EMAIL is set,
// one unconfirmed account and one e-mail per run, to clean up by hand
// (docs/operations/smoke-tests.md).

test.describe("sign-up", { tag: "@sign-up" }, () => {
  test("the form checks each field and creates nothing", async ({ page }) => {
    await page.goto("/fr/inscription");
    await page.getByLabel("Adresse e-mail").fill("pas-une-adresse");
    await page.getByLabel("Mot de passe", { exact: true }).fill("court");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page.getByText("Indiquez votre nom.")).toBeVisible();
    await expect(page.getByText("Saisissez une adresse e-mail valide.")).toBeVisible();
    await expect(page.getByText("Le mot de passe doit faire au moins 8 caractères.")).toBeVisible();
    await expect(page).toHaveURL(/\/fr\/inscription$/);
  });

  test("a new account is asked to confirm its address", async ({ page }) => {
    test.skip(!smoke.signupEmail, "Set SMOKE_SIGNUP_EMAIL to create a real account on each run");
    const email = signupAddress(smoke.signupEmail ?? "", runTag());

    await page.goto("/fr/inscription");
    await page.getByLabel("Nom complet").fill("Test de fumée KolabReport");
    await fillSecret(page.getByLabel("Adresse e-mail"), email);
    // Never used again: the account stays unconfirmed until it is deleted.
    await fillSecret(page.getByLabel("Mot de passe", { exact: true }), randomBytes(18).toString("base64url"));
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page.getByText("Vérifiez votre boîte mail")).toBeVisible();
  });
});
