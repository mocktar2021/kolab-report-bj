import { expect, test as setup, type Page } from "@playwright/test";
import { SESSION_FILE, escapeRegExp, fillSecret, hasAccount, smoke } from "./support";

// Signs in with the smoke account through the sign-in form, makes the smoke
// workspace the current one and saves the session for signed-in.spec.ts.
// The project runs without a trace (playwright.smoke.config.ts) and the
// fields are filled with fillSecret, so the password is in no report.

setup.skip(!hasAccount, "Set SMOKE_EMAIL and SMOKE_PASSWORD to run the signed-in checks");

/** Cookie the workspace switcher sets (src/lib/workspaces/server.ts). */
const CURRENT_WORKSPACE_COOKIE = "kr-espace";

async function signIn(page: Page) {
  await page.goto("/fr/connexion");
  await fillSecret(page.getByLabel("Adresse e-mail"), smoke.email ?? "");
  await fillSecret(page.getByLabel("Mot de passe", { exact: true }), smoke.password ?? "");
  await page.getByRole("button", { name: "Se connecter" }).click();

  // Either the dashboard opens or the form says why not.
  const alert = page.getByRole("main").getByRole("alert");
  await expect(page.getByRole("heading", { name: "Tableau de bord", level: 1 }).or(alert)).toBeVisible();
  if (page.url().includes("/fr/connexion")) {
    throw new Error(`The smoke account could not sign in: "${await alert.innerText()}"`);
  }
  await expect(page).toHaveURL(/\/fr\/tableau-de-bord$/);
}

async function selectSmokeWorkspace(page: Page, baseURL: string) {
  const main = page.getByRole("main");
  if (await main.getByRole("heading", { name: "Créez votre premier espace de travail" }).isVisible()) {
    throw new Error("The smoke account has no workspace yet. Create it once: docs/operations/smoke-tests.md");
  }

  if (smoke.workspaceId) {
    await page.context().addCookies([
      {
        name: CURRENT_WORKSPACE_COOKIE,
        value: smoke.workspaceId,
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax",
        secure: baseURL.startsWith("https://"),
      },
    ]);
    await page.reload();
    // Only an owner or admin of SMOKE_WORKSPACE_ID gets this link to it.
    await expect(
      main.getByRole("link", { name: "Gérer les membres" }),
      "SMOKE_WORKSPACE_ID is not a workspace the smoke account manages",
    ).toHaveAttribute("href", `/fr/espaces/${smoke.workspaceId}/membres`);
    return;
  }

  const name = smoke.workspaceName;
  const switcher = page.getByRole("button", { name: /^Espace de travail actuel : / });
  // The switcher's name is "Espace de travail actuel : <name>" (KRB-222).
  const current = page.getByRole("button", { name: `Espace de travail actuel : ${name}`, exact: true });
  if ((await current.count()) === 0) {
    await switcher.click();
    // The item's name is the workspace name followed by the role.
    const item = page.getByRole("menuitemradio", { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) });
    await expect(item, `the smoke account has no workspace named "${name}"`).toHaveCount(1);
    await item.click();
  }
  await expect(main.getByText(`Avancement des sections de l'espace ${name}.`)).toBeVisible();
  await expect(main.getByRole("link", { name: "Gérer les membres" })).toBeVisible();
}

setup("sign in with the smoke account", { tag: ["@signed-in", "@ai"] }, async ({ page, baseURL }) => {
  await signIn(page);
  await selectSmokeWorkspace(page, baseURL ?? "");
  await page.context().storageState({ path: SESSION_FILE });
});
