import { expect, test } from "@playwright/test";

// KRB-48: quick check that the public pages load in French.
test("landing page loads in French", async ({ page }) => {
  await page.goto("/fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Une section par expert.");
  await expect(page.getByRole("link", { name: "Se connecter" }).first()).toBeVisible();
});

test("sign-in page loads", async ({ page }) => {
  await page.goto("/fr/connexion");
  await expect(page).toHaveTitle(/Connexion/);
  await expect(page.getByLabel("Adresse e-mail")).toBeVisible();
});

test("PWA manifest and service worker are served", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).lang).toBe("fr");
  expect((await request.get("/sw.js")).ok()).toBe(true);
});

test("the root redirects to /fr", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/fr$/);
});

test("public pages send the security headers and break no CSP rule", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) {
      violations.push(message.text());
    }
  });

  const response = await page.goto("/fr");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  await page.goto("/fr/connexion");
  await page.goto("/fr/inscription");

  expect(violations).toEqual([]);
});
