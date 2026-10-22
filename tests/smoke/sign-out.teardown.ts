import { existsSync } from "node:fs";
import { expect, test as teardown } from "@playwright/test";
import { SESSION_FILE, hasAccount } from "./support";

// Runs after the signed-in checks, even when they fail. Signing out revokes
// the session (scope "local" in src/lib/auth/actions.ts), so the cookies a
// failure trace may hold stop working.

teardown.skip(!hasAccount, "No smoke account, no session to end");

teardown("sign out the smoke account", { tag: ["@signed-in", "@ai"] }, async ({ browser, baseURL }) => {
  teardown.skip(!existsSync(SESSION_FILE), "The sign-in did not save a session");
  const context = await browser.newContext({ baseURL, storageState: SESSION_FILE });
  try {
    const page = await context.newPage();
    await page.goto("/fr/tableau-de-bord");
    // Se déconnecter is in the account menu, top right (KRB-227).
    await page.getByRole("banner").getByRole("button", { name: "Menu du compte" }).click();
    await page
      .getByRole("menu", { name: "Menu du compte" })
      .getByRole("menuitem", { name: "Se déconnecter" })
      .click();
    await expect(page).toHaveURL(/\/fr\/connexion$/);
  } finally {
    await context.close();
  }
});
