import { expect, test } from "@playwright/test";
import { GUIDE_FIGURES } from "../../src/content/guide/figures";
import { PLANS } from "../../src/lib/billing/catalog";
import { THEMES, expectNoAxeViolations, signIn, useTheme } from "./a11y";
import { createTestUser } from "./supabase";

// KRB-199: the user guide opens without an account, has a part per role and
// the questions, links to its PDF, and is linked from the public footer and
// the app menu.

const PARTS = ["1. Propriétaire et administrateur", "2. Expert", "3. Questions fréquentes"];

const QUESTIONS = [
  "3.1 J'ai oublié mon mot de passe",
  "3.2 Comment installer KolabReport sur mon téléphone ?",
  "3.3 Quels sont les rôles ?",
  "3.4 Où sont mes données et qui peut les voir ?",
  "3.5 Que fait l'IA, et que ne fait-elle pas ?",
  "3.6 Quelles sont les limites de chaque offre ?",
];

test("/fr/guide opens signed out with its parts, its questions and a table of contents", async ({ page }) => {
  await page.goto("/fr/guide");
  await expect(page).toHaveURL("/fr/guide");
  await expect(page).toHaveTitle("Guide d'utilisation · KolabReport");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Guide d'utilisation");
  await expect(page.getByText(/^Dernière mise à jour : \d{1,2} \S+ \d{4}$/)).toBeVisible();

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2 }).filter({ hasText: /^\d\. / })).toHaveText(PARTS);
  for (const question of QUESTIONS) {
    await expect(main.getByRole("heading", { level: 3, name: question })).toBeVisible();
  }

  const toc = page.getByRole("navigation", { name: "Sommaire" });
  await toc.getByRole("link", { name: "Importer le plan", exact: true }).click();
  await expect(page).toHaveURL("/fr/guide#importer-le-plan");
  await expect(main.getByRole("heading", { level: 3, name: "1.4 Importer le plan" })).toBeInViewport();
  await toc.getByRole("link", { name: "Questions fréquentes", exact: true }).click();
  await expect(page).toHaveURL("/fr/guide#questions-frequentes");
});

test("the limits table shows the figures of the pricing page", async ({ page }) => {
  await page.goto("/fr/guide#limites-des-offres");
  const table = page.getByRole("region", { name: "Limites de chaque offre" }).getByRole("table");
  const cabinet = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Cabinet" }) });
  const { limits } = PLANS.cabinet;
  await expect(cabinet.getByRole("cell")).toHaveText([
    String(limits.maxMembers),
    "Illimités",
    `${limits.draftsPerMonth} par mois`,
    "Oui",
  ]);
  await expect(table.getByRole("rowheader")).toHaveText([
    /^Essai gratuit/,
    "Indépendant",
    "Cabinet",
    /^Institution/,
    /^Pass Mission/,
  ]);
});

test("every screenshot loads and has a French alt text", async ({ page }) => {
  await page.goto("/fr/guide");
  const images = page.getByRole("main").locator("figure img");
  await expect(images).toHaveCount(Object.keys(GUIDE_FIGURES).length);
  const alts = new Set(Object.values(GUIDE_FIGURES).map((figure) => figure.alt));
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    const alt = (await image.getAttribute("alt")) ?? "";
    expect(alts.has(alt)).toBe(true);
    // Each screenshot loads lazily through /_next/image, which resizes it on
    // the first request. On a slow CI runner that once took more than the
    // default 5 s (KRB-203), so it gets 20 s, and a failure names the image.
    await expect
      .poll(
        () => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
        {
          message: `screenshot did not load: ${alt}`,
          timeout: 20_000,
        },
      )
      .toBe(true);
  }
});

test("the guide links to its PDF", async ({ page, request }) => {
  await page.goto("/fr/guide");
  const link = page.getByRole("link", { name: "Télécharger le guide en PDF" });
  await expect(link).toHaveAttribute("href", "/guide/guide-kolabreport.pdf");
  await expect(link).toHaveAttribute("download", "");
  const response = await request.get("/guide/guide-kolabreport.pdf");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect((await response.body()).subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("the public footer links to the guide", async ({ page }) => {
  await page.goto("/fr");
  const footer = page.getByRole("contentinfo");
  const link = footer.getByRole("link", { name: "Guide d'utilisation", exact: true });
  await expect(link).toHaveAttribute("href", "/fr/guide");
  await link.click();
  await expect(page).toHaveURL("/fr/guide");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Guide d'utilisation");

  // The legal pages and the pricing page share the footer.
  for (const url of ["/fr/tarifs", "/fr/cgu"]) {
    await page.goto(url);
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: "Guide d'utilisation", exact: true }),
    ).toHaveAttribute("href", "/fr/guide");
  }
});

test("signed-in users open the guide from the app menu, on a computer and a phone", async ({ page }) => {
  const user = await createTestUser("Gisele Guide");
  await signIn(page, user);

  const banner = page.getByRole("banner");
  await banner.getByRole("link", { name: "Guide d'utilisation" }).click();
  // The middleware lets a signed-in user stay on the page.
  await expect(page).toHaveURL("/fr/guide");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Guide d'utilisation");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fr/tableau-de-bord");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await menu.getByRole("link", { name: "Guide d'utilisation" }).click();
  await expect(page).toHaveURL("/fr/guide");
});

test("the guide fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fr/guide");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

for (const theme of THEMES) {
  test(`the guide has no axe violations (${theme} theme)`, async ({ page }) => {
    await useTheme(page, theme);
    await page.goto("/fr/guide");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Guide d'utilisation");
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    await expectNoAxeViolations(page, `/fr/guide (${theme})`);
  });
}
