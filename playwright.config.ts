import { defineConfig, devices } from "@playwright/test";

// The tests reach Supabase directly for setup (see tests/e2e/supabase.ts).
// CI writes .env.local from `supabase status`; locally it is the app's own.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the environment.
}

// Specs that run a job over the whole database: the billing cron (reminders,
// expiry, read-only) and the storage cleanup cron. A run can change or remove
// what another spec set up a moment before, so these run alone, one at a
// time, after every other spec (KRB-192). A new spec that calls a cron or
// changes a setting of the whole app goes in this list. They wait for the
// chromium project even when run by name: add --no-deps to run one alone.
const ALONE = /\/(billing-reminders|deletions|storage-cleanup)\.spec\.ts$/;

/**
 * End-to-end tests run against a production build and the local Supabase
 * stack (`npx supabase start`), whose Mailpit inbox receives the auth e-mails.
 *   npm run build && npm run test:e2e
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Two spec files run side by side. The tests of one file still run in
  // order on one worker: every spec makes its own users and workspaces, and
  // many files share them between their tests.
  fullyParallel: false,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "fr-FR",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: ALONE },
    {
      name: "alone",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ALONE,
      workers: 1,
      dependencies: ["chromium"],
    },
  ],
  webServer: [
    {
      command: "npm run start",
      url: "http://localhost:3000/fr",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // FedaPay mock (ADR 001, section 13). It reads the FEDAPAY_* values of
      // .env.local loaded above, so it shares the app's keys and secret.
      command: "node tests/fedapay-mock/server.mjs",
      url: `http://127.0.0.1:${process.env.FEDAPAY_MOCK_PORT || 4010}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
    },
  ],
});
