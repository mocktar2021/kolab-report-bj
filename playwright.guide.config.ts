import { defineConfig, devices } from "@playwright/test";
import { FIGURE_SIZE } from "./src/content/guide/figures";

// Same local values as the end-to-end tests (tests/e2e/supabase.ts).
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the environment.
}

/**
 * Screenshots of the user guide (KRB-199), kept out of the end-to-end run.
 * The spec seeds demo data in the local Supabase stack, signs in and writes
 * public/guide/*.webp. Run it on a production build:
 *   npm run build && npm run guide:screenshots
 * Then make the PDF with npm run guide:pdf (README, "User guide").
 */
export default defineConfig({
  testDir: "./tests/guide",
  testMatch: /screenshots\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 5 * 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/guide",
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "fr-FR",
    timezoneId: "Africa/Porto-Novo",
    colorScheme: "light",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { ...FIGURE_SIZE }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000/fr",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
