import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations, signIn } from "./a11y";
import { createTestUser, createWorkspaceFor, type TestUser } from "./supabase";

// KRB-205: "Installer l'application" in the account menu. Chromium browsers get their
// own install dialog through the saved `beforeinstallprompt` event; iPhones
// get the steps of Safari's share menu.
test.describe.configure({ mode: "serial" });

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser("Ines Installe");
  await createWorkspaceFor(user, "Installation Bohicon");
});

/**
 * Only the events of the test reach the app: Chromium may fire its own
 * `beforeinstallprompt` at any time, and its prompt() would wait for a person.
 */
async function controlInstallEvents(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener(
      "beforeinstallprompt",
      (event) => {
        if (!(event as Event & { fromTest?: boolean }).fromTest) event.stopImmediatePropagation();
      },
      true,
    );
  });
}

async function fireInstallEvent(page: Page) {
  await page.evaluate(() => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      fromTest: true,
      prompt: () => {
        (window as Window & { prompted?: number }).prompted =
          ((window as Window & { prompted?: number }).prompted ?? 0) + 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });
    window.dispatchEvent(event);
  });
}

test("Chromium: the item opens the browser's install dialog and goes once installed", async ({ page }) => {
  await controlInstallEvents(page);
  await signIn(page, user);
  const accountMenu = page.getByRole("banner").getByRole("button", { name: "Menu du compte" });
  const menu = page.getByRole("menu", { name: "Menu du compte" });
  const install = menu.getByRole("menuitem", { name: "Installer l'application" });
  await accountMenu.click();
  await expect(menu.getByRole("menuitem", { name: "Guide d'utilisation" })).toBeVisible();
  await expect(install).toHaveCount(0);
  // The menu fades out before it leaves the page: a click on its button
  // before then counts as a click outside the closing menu.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await fireInstallEvent(page);
  await accountMenu.click();
  await install.click();
  expect(await page.evaluate(() => (window as Window & { prompted?: number }).prompted)).toBe(1);
  await expect(menu).toHaveCount(0);
  // The event prompts once: the item waits for the browser's next one.
  await accountMenu.click();
  await expect(menu).toBeVisible();
  await expect(install).toHaveCount(0);

  await fireInstallEvent(page);
  await expect(install).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(install).toHaveCount(0);
});

test.describe("iPhone", () => {
  test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the item shows the share menu steps and gives the focus back", async ({ page }) => {
    await signIn(page, user);
    // The avatar, at the right end of the phone's top bar.
    const accountMenu = page.getByRole("banner").getByRole("button", { name: "Menu du compte" });
    await accountMenu.click();
    await page
      .getByRole("menu", { name: "Menu du compte" })
      .getByRole("menuitem", { name: "Installer l'application" })
      .click();

    const steps = page.getByRole("dialog", { name: "Installer KolabReport" });
    await expect(steps).toBeVisible();
    await expect(steps.getByRole("listitem")).toHaveCount(3);
    await expect(steps.getByRole("listitem").nth(1)).toHaveText("2Choisissez Sur l'écran d'accueil.");
    await expectNoAxeViolations(page, "the iPhone install steps");

    await page.keyboard.press("Escape");
    await expect(steps).toHaveCount(0);
    // The item left with its menu: the focus goes back to the menu button.
    await expect(accountMenu).toBeFocused();
  });
});
