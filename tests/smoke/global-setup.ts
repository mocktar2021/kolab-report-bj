import { rmSync } from "node:fs";
import { request, type FullConfig } from "@playwright/test";
import { BYPASS_FILE, SESSION_FILE, smoke } from "./support";

/**
 * Runs once before the smoke tests. With VERCEL_AUTOMATION_BYPASS_SECRET set,
 * it asks Vercel for the bypass cookie and saves it for every browser and API
 * context (playwright.smoke.config.ts). The secret itself never goes through a
 * traced context, so it stays out of the report. The returned function runs
 * at the end and deletes the cookie files.
 */
export default async function globalSetup(config: FullConfig) {
  const removeFiles = () => {
    rmSync(SESSION_FILE, { force: true });
    rmSync(BYPASS_FILE, { force: true });
  };
  // A session left by an earlier local run must not stand in for this run's sign-in.
  removeFiles();

  if (smoke.vercelBypassSecret) {
    const api = await request.newContext({ baseURL: config.projects[0]?.use.baseURL });
    try {
      const response = await api.get("/fr", {
        headers: {
          "x-vercel-protection-bypass": smoke.vercelBypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        },
      });
      if (!response.ok()) {
        throw new Error(
          `Vercel refused VERCEL_AUTOMATION_BYPASS_SECRET (HTTP ${response.status()}). ` +
            "Check the secret under Settings > Deployment Protection of the Vercel project.",
        );
      }
      await api.storageState({ path: BYPASS_FILE });
    } finally {
      await api.dispose();
    }
  }

  return removeFiles;
}
