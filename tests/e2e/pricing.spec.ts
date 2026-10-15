import { expect, test, type Page } from "@playwright/test";
import { INSTITUTION, OFFERS, TRIAL } from "../../src/lib/billing/catalog";
import { signIn } from "./a11y";
import { createTestUser } from "./supabase";

// KRB-179: the public pricing page shows the offers of the catalogue, the
// yearly discount and that readers are free, and leads to the trial.

/** "15 000" the way the page writes it, with the French group separator. */
const fcfa = (amount: number) => new Intl.NumberFormat("fr-FR").format(amount);

function offer(page: Page, name: string) {
  return page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });
}

test("/fr/tarifs opens signed out with the offers and prices of the catalogue", async ({ page }) => {
  await page.goto("/fr/tarifs");
  await expect(page).toHaveURL("/fr/tarifs");
  await expect(page).toHaveTitle("Tarifs · KolabReport");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /lecteurs sont gratuits/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Des offres claires, en FCFA");
  await expect(page.getByText("Prix hors taxes", { exact: true })).toBeVisible();
  await expect(page.getByText("L'année au prix de 10 mois", { exact: true })).toBeVisible();

  const trial = offer(page, "Essai gratuit");
  await expect(trial).toContainText(`pendant ${TRIAL.days} jours, sans carte bancaire`);
  await expect(trial).toContainText("20 brouillons IA");

  const independant = offer(page, "Indépendant");
  await expect(independant).toContainText(`${fcfa(OFFERS.independant_1m.priceHtXof)} FCFA HT par mois`);
  await expect(independant).toContainText(`3 mois : ${fcfa(OFFERS.independant_3m.priceHtXof)} FCFA HT`);
  await expect(independant).toContainText(
    `12 mois : ${fcfa(OFFERS.independant_12m.priceHtXof)} FCFA HT, 2 mois offerts`,
  );
  await expect(independant).toContainText("3 rapports actifs");
  await expect(independant).not.toContainText("Modèles de prompt personnalisés");

  const cabinet = offer(page, "Cabinet");
  await expect(cabinet).toContainText(`${fcfa(OFFERS.cabinet_1m.priceHtXof)} FCFA HT par mois`);
  await expect(cabinet).toContainText(
    `12 mois : ${fcfa(OFFERS.cabinet_12m.priceHtXof)} FCFA HT, 2 mois offerts`,
  );
  await expect(cabinet).toContainText("250 brouillons IA par mois");

  const institution = offer(page, "Institution");
  await expect(institution).toContainText(
    `à partir de ${fcfa(INSTITUTION.fromMonthlyPriceHtXof)} FCFA HT par mois`,
  );
  await expect(institution.getByRole("link", { name: /Demander un devis Institution/ })).toHaveAttribute(
    "href",
    "mailto:support@mocktar.com?subject=Devis%20Institution%20KolabReport",
  );

  // Readers are free on every plan.
  for (const name of ["Essai gratuit", "Indépendant", "Cabinet", "Institution"]) {
    await expect(offer(page, name).getByText("Lecteurs gratuits et illimités"), name).toBeVisible();
  }

  await expect(offer(page, "Pass Mission")).toContainText(
    `${fcfa(OFFERS.mission_pass.priceHtXof)} FCFA HT par rapport`,
  );
  await expect(offer(page, "Pack IA")).toContainText(
    `${fcfa(OFFERS.ai_pack_100.priceHtXof)} FCFA HT le pack`,
  );
});

test("the trial button leads to sign-up and the refund answer to the terms of sale", async ({ page }) => {
  await page.goto("/fr/tarifs");
  await page.getByRole("button", { name: "Puis-je être remboursé ?" }).click();
  await expect(page.getByRole("link", { name: "conditions générales de vente" })).toHaveAttribute(
    "href",
    "/fr/cgv#remboursement",
  );

  await offer(page, "Essai gratuit").getByRole("link", { name: "Commencer l'essai gratuit" }).click();
  await expect(page).toHaveURL("/fr/inscription");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Créer un compte");
});

test("the landing page header and footer link to the pricing page", async ({ page }) => {
  await page.goto("/fr");
  await expect(
    page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Tarifs" }),
  ).toHaveAttribute("href", "/fr/tarifs");
  await page.getByRole("contentinfo").getByRole("link", { name: "Tarifs", exact: true }).click();
  await expect(page).toHaveURL("/fr/tarifs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Des offres claires, en FCFA");
});

test("signed-in users can read the pricing page", async ({ page }) => {
  const user = await createTestUser("Prisca Tarifs");
  await signIn(page, user);
  await page.goto("/fr/tarifs");
  // The middleware does not send them to the dashboard.
  await expect(page).toHaveURL("/fr/tarifs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Des offres claires, en FCFA");
});
