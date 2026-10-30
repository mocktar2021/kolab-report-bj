import { expect, test } from "@playwright/test";

// KRB-262: one public page per kind of report, linked from the landing page
// and the footer, each with its example plan, a guide screenshot and the trial
// button.

const PAGES = [
  { url: "/fr/solutions/rapport-d-audit", link: "Rapports d'audit", section: "Systèmes d'information" },
  { url: "/fr/solutions/rapport-d-evaluation", link: "Rapports d'évaluation", section: "Efficience" },
  { url: "/fr/solutions/rapport-d-etude", link: "Rapports d'études", section: "Étude technique" },
];

for (const { url, section } of PAGES) {
  test(`${url} opens signed out with its plan, screenshot and trial button`, async ({ page }) => {
    await page.goto(url);
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${url}$`));
    await expect(page.getByText(section, { exact: true })).toBeVisible();

    const screenshot = page.getByRole("figure").getByRole("img");
    await expect(screenshot).toBeVisible();
    await expect(screenshot).toHaveJSProperty("complete", true);
    expect(await screenshot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    await expect(
      page.getByRole("main").getByRole("link", { name: "Essayer gratuitement" }).first(),
    ).toHaveAttribute("href", "/fr/inscription");
  });
}

test("the landing page and the footer link to the three pages", async ({ page }) => {
  await page.goto("/fr");
  const cards = page.getByRole("region", { name: /Pour vos rapports d'audit/ });
  for (const { url, link } of PAGES) {
    await expect(cards.getByRole("link", { name: new RegExp(`^${link}`) })).toHaveAttribute("href", url);
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: link, exact: true }),
    ).toHaveAttribute("href", url);
  }

  await cards.getByRole("link", { name: /^Rapports d'évaluation/ }).click();
  await expect(page).toHaveURL("/fr/solutions/rapport-d-evaluation");
});

test("an unknown use case is a 404", async ({ request }) => {
  const response = await request.get("/fr/solutions/inconnu");
  expect(response.status()).toBe(404);
});
