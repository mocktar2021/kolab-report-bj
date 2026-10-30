import { expect, test } from "@playwright/test";

// KRB-258: the public pages carry their canonical address and a preview image,
// the sitemap lists them, and a build that is not production shuts crawlers out.

test("the landing page has its canonical address and preview image", async ({ page }) => {
  await page.goto("/fr");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/fr$/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/og\/kolabreport\.png$/,
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
});

test("the preview image is served without an account", async ({ request }) => {
  const response = await request.get("/og/kolabreport.png");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test("the sitemap lists the public pages", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  expect(xml).toContain("/fr/tarifs</loc>");
  expect(xml).not.toContain("tableau-de-bord");
});

test("robots.txt shuts crawlers out of a build that is not production", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  expect(await response.text()).toMatch(/Disallow: \/\s*$/m);
});

test("signed-in pages ask search engines to stay away", async ({ page }) => {
  await page.goto("/fr/mot-de-passe-oublie");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
