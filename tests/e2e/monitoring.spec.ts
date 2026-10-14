import { expect, test } from "@playwright/test";

// KRB-136: Sentry stays off without NEXT_PUBLIC_SENTRY_DSN. CI builds have
// none, so a page that throws must not try to send anything.
test("sends nothing to Sentry without a DSN", async ({ page }) => {
  test.skip(Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN), "this build has a Sentry DSN");

  const sent: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/monitoring") || url.includes("sentry.io")) sent.push(url);
  });

  await page.goto("/fr/connexion");
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("monitoring check");
    });
  });
  await page.goto("/fr");
  await page.waitForLoadState("networkidle");

  expect(sent).toEqual([]);
});
