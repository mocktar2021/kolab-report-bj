import { expect, test, type Page } from "@playwright/test";
import { THEMES, expectNoAxeViolations, signIn, useTheme } from "./a11y";
import { createTestUser } from "./supabase";

// KRB-159: the French legal pages open without an account, show their date
// and table of contents, and are linked from the landing page, the sign-in
// pages and the app.

const LEGAL_PAGES = [
  {
    url: "/fr/mentions-legales",
    title: "Mentions légales",
    link: "Mentions légales",
    firstSection: "Éditeur",
  },
  {
    url: "/fr/confidentialite",
    title: "Politique de confidentialité",
    link: "Confidentialité",
    firstSection: "Qui est responsable de vos données",
  },
  {
    url: "/fr/cgu",
    title: "Conditions générales d'utilisation",
    link: "Conditions d'utilisation",
    firstSection: "Objet",
  },
  {
    url: "/fr/cgv",
    title: "Conditions générales de vente",
    link: "Conditions de vente",
    firstSection: "Vendeur",
  },
  {
    url: "/fr/accord-traitement-donnees",
    title: "Accord de traitement des données",
    link: "Traitement des données",
    firstSection: "Rôles des parties",
  },
];

/** The four pages linked from the sign-in pages and the app. */
const MAIN_PAGES = LEGAL_PAGES.slice(0, 4);

function legalNav(page: Page) {
  return page.getByRole("navigation", { name: "Informations légales" });
}

for (const legal of LEGAL_PAGES) {
  test(`${legal.url} opens signed out with its title, date and table of contents`, async ({ page }) => {
    await page.goto(legal.url);
    await expect(page).toHaveURL(legal.url);
    await expect(page).toHaveTitle(`${legal.title} · KolabReport`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(legal.title);
    await expect(page.getByText(/^Dernière mise à jour : \d{1,2} \S+ \d{4}$/)).toBeVisible();

    const toc = page.getByRole("navigation", { name: "Sommaire" });
    await toc.getByRole("link", { name: legal.firstSection, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${legal.url}#[a-z-]+$`));
    await expect(page.getByRole("heading", { level: 2, name: `1. ${legal.firstSection}` })).toBeInViewport();
  });
}

test("the legal notice names the publisher, the director and the hosts", async ({ page }) => {
  await page.goto("/fr/mentions-legales");
  const publisher = page.locator("#editeur");
  const fact = (label: string) =>
    publisher
      .locator("dl > div")
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator("dd");

  await expect(fact("Dénomination")).toHaveText("Mocktar Technologies");
  await expect(fact("Forme")).toHaveText("Établissement");
  await expect(fact("Siège")).toHaveText("C 1357 Houeyiho, 07BP91 Cotonou, République du Bénin");
  await expect(fact("RCCM")).toHaveText("COTONOU N° RB/COT/26 A 119654");
  await expect(fact("IFU")).toHaveText("1200900488800");
  await expect(fact("Numéro employeur CNSS")).toHaveText("12009004888001");
  await expect(fact("E-mail").getByRole("link", { name: "support@mocktar.com" })).toHaveAttribute(
    "href",
    "mailto:support@mocktar.com",
  );
  await expect(page.locator("#directeur-publication")).toContainText("Mocktar Adjibade Tairou");
  await expect(page.locator("#hebergement")).toContainText("Vercel Inc.");
  await expect(page.locator("#hebergement")).toContainText("Supabase Inc.");
});

test("the landing page footer links to every legal page", async ({ page }) => {
  await page.goto("/fr");
  const legal = page.getByRole("contentinfo").getByRole("navigation", { name: "Informations légales" });
  for (const { url, link } of LEGAL_PAGES) {
    await expect(legal.getByRole("link", { name: link, exact: true })).toHaveAttribute("href", url);
  }

  await legal.getByRole("link", { name: "Conditions de vente", exact: true }).click();
  await expect(page).toHaveURL("/fr/cgv");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Conditions générales de vente");

  // From a legal page, the section links of the footer lead back to the landing page.
  await page.getByRole("contentinfo").getByRole("link", { name: "Questions fréquentes" }).click();
  await expect(page).toHaveURL("/fr#faq");
});

test("the sign-in, sign-up and password pages link to the legal pages", async ({ page }) => {
  for (const url of ["/fr/inscription", "/fr/mot-de-passe-oublie", "/fr/connexion"]) {
    await page.goto(url);
    for (const { url: href, link } of MAIN_PAGES) {
      await expect(legalNav(page).getByRole("link", { name: link, exact: true }), url).toHaveAttribute(
        "href",
        href,
      );
    }
  }

  await legalNav(page).getByRole("link", { name: "Confidentialité", exact: true }).click();
  await expect(page).toHaveURL("/fr/confidentialite");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Politique de confidentialité");
});

test("signed-in users open the legal pages from the app menu", async ({ page }) => {
  const user = await createTestUser("Lea Legal");
  await signIn(page, user);

  const legal = page.getByRole("banner").getByRole("navigation", { name: "Informations légales" });
  for (const { url, link } of MAIN_PAGES) {
    await expect(legal.getByRole("link", { name: link, exact: true })).toHaveAttribute("href", url);
  }
  await legal.getByRole("link", { name: "Conditions d'utilisation", exact: true }).click();
  // The middleware lets a signed-in user stay on the page.
  await expect(page).toHaveURL("/fr/cgu");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Conditions générales d'utilisation");
});

test("wide tables scroll in their own box on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ["/fr/confidentialite", "/fr/cgv"]) {
    await page.goto(url);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${url}`).toBe(0);
  }
});

for (const theme of THEMES) {
  test(`the privacy policy has no axe violations (${theme} theme)`, async ({ page }) => {
    await useTheme(page, theme);
    await page.goto("/fr/confidentialite");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Politique de confidentialité");
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    await expectNoAxeViolations(page, `/fr/confidentialite (${theme})`);
  });
}
