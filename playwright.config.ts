import { defineConfig, devices } from "@playwright/test";

// The tests reach Supabase directly for setup (see tests/e2e/supabase.ts).
// CI writes .env.local from `supabase status`; locally it is the app's own.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the environment.
}

/**
 * End-to-end tests run against a production build and the local Supabase
 * stack (`npx supabase start`), whose Mailpit inbox receives the auth e-mails.
 *   npm run build && npm run test:e2e
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "fr-FR",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000/fr",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
