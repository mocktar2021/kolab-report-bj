// Signs the seeded demo user in, in a Chrome profile that the dashboard's
// Lighthouse runs then start from (KRB-153, KRB-172).
//
//   node scripts/lighthouse-profile.mjs <profile folder>
//
// Each Lighthouse run starts its own Chrome, as Lighthouse does by default.
// The session cookies of supabase/seed.sql's demo user wait in this profile.
// Sharing one Chrome between runs instead, as an lhci puppeteerScript does,
// put every run in the renderer process of the run before, and the garbage
// collection of that page's heap often landed in the next run's first paint.
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const EMAIL = process.env.LHCI_EMAIL || "awa.dossou@kolabreport.test";
const PASSWORD = process.env.LHCI_PASSWORD || "Kolab-demo-2026";
const baseUrl = process.env.LHCI_BASE_URL || "http://localhost:3000";

const [profile] = process.argv.slice(2);
if (!profile) {
  console.error("Usage: node scripts/lighthouse-profile.mjs <profile folder>");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  userDataDir: profile,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/fr/connexion`, { waitUntil: "networkidle0" });
  await page.type("#email", EMAIL);
  await page.type("#password", PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('button[type="submit"]'),
  ]);
  if (new URL(page.url()).pathname.endsWith("/connexion")) {
    throw new Error(`Lighthouse: could not sign in as ${EMAIL}. Is the local stack seeded?`);
  }
} finally {
  // Closing Chrome writes the session cookies to the profile.
  await browser.close();
}
