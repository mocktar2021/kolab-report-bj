import { defineConfig, devices } from "@playwright/test";
import { BYPASS_FILE, SESSION_FILE, smoke } from "./tests/smoke/support";

/**
 * Smoke tests of a deployed environment (KRB-161), run by deploy.yml after
 * each deploy and by hand:
 *   SMOKE_BASE_URL=https://kolabreport.mocktar.com npx playwright test -c playwright.smoke.config.ts
 * No local server, no .env.local, no service-role key: only what a real user
 * has. Runbook: docs/operations/smoke-tests.md.
 */

const baseURL = process.env.SMOKE_BASE_URL?.trim().replace(/\/+$/, "");
if (!baseURL) {
  throw new Error("Set SMOKE_BASE_URL to the site to check, for example https://kolabreport.mocktar.com");
}

const chrome = devices["Desktop Chrome"];
// Every context starts with the Vercel bypass cookie when there is one.
const bypassState = smoke.vercelBypassSecret ? BYPASS_FILE : undefined;
const htmlReport = ["html", { outputFolder: "playwright-report/smoke", open: "never" }] as const;

export default defineConfig({
  testDir: "./tests/smoke",
  globalSetup: "./tests/smoke/global-setup.ts",
  // One test at a time, in file order: the signed-in checks share one
  // section, and a deployed site should not see a burst of sessions.
  fullyParallel: false,
  workers: 1,
  // A cold Vercel function can make the first request of a run slow. One
  // retry absorbs it; a second failure is a real one.
  retries: 1,
  timeout: 60_000,
  globalTimeout: 12 * 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/smoke",
  // In CI, "github" turns failures into annotations on the run.
  reporter: process.env.CI ? [["github"], ["list"], htmlReport] : [["list"], htmlReport],
  use: {
    baseURL,
    locale: "fr-FR",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: { mode: "only-on-failure", fullPage: true },
  },
  projects: [
    {
      // No account needed: public pages, health, headers, sign-up form.
      name: "public",
      testMatch: /(public|sign-up)\.spec\.ts$/,
      use: { ...chrome, storageState: bypassState },
    },
    {
      // Signs in once and saves the session. No trace: it would record the
      // password typed into the form.
      name: "sign-in",
      testMatch: /sign-in\.setup\.ts$/,
      teardown: "sign-out",
      use: { ...chrome, storageState: bypassState, trace: "off" },
    },
    {
      name: "signed-in",
      testMatch: /signed-in\.spec\.ts$/,
      dependencies: ["sign-in"],
      use: { ...chrome, storageState: SESSION_FILE },
    },
    {
      // Ends the session, so the cookies a failure trace may hold stop working.
      name: "sign-out",
      testMatch: /sign-out\.teardown\.ts$/,
      use: { ...chrome, trace: "off" },
    },
  ],
});
