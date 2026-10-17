// Lighthouse CI puppeteerScript (KRB-153), see lighthouserc.cjs.
//
// LHCI calls it once per URL, before the runs of that URL, with the browser
// Lighthouse then uses. Lighthouse clears caches and service workers between
// runs but keeps cookies, so the session set here lasts for every run.
// The sign-in page is measured signed out (the proxy sends signed-in
// visitors to the dashboard), every other page as the seeded demo user from
// supabase/seed.sql.

const EMAIL = process.env.LHCI_EMAIL || "awa.dossou@kolabreport.test";
const PASSWORD = process.env.LHCI_PASSWORD || "Kolab-demo-2026";

/**
 * @param {import("puppeteer-core").Browser} browser
 * @param {{ url: string }} context
 */
module.exports = async function signInForLighthouse(browser, { url }) {
  const target = new URL(url);
  const page = await browser.newPage();
  try {
    if (target.pathname.endsWith("/connexion")) {
      const session = await page.createCDPSession();
      await session.send("Network.clearBrowserCookies");
      return;
    }

    await page.goto(`${target.origin}/fr/connexion`, { waitUntil: "networkidle0" });
    // Already signed in: the proxy has sent us to the dashboard.
    if (!new URL(page.url()).pathname.endsWith("/connexion")) return;

    await page.type("#email", EMAIL);
    await page.type("#password", PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }),
      page.click('button[type="submit"]'),
    ]);
    if (new URL(page.url()).pathname.endsWith("/connexion")) {
      throw new Error(`Lighthouse CI: could not sign in as ${EMAIL}. Is the local stack seeded?`);
    }
  } finally {
    await page.close();
  }
};
