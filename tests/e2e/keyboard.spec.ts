import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./a11y";
import {
  addParsedDeliverable,
  adminClient,
  createTestUser,
  createWorkspaceFor,
  type TestUser,
} from "./supabase";

// KRB-155: the sign-in, upload and draft flows with the keyboard only (Tab,
// Shift+Tab, Enter, Space, Escape), checking what a screen reader gets: roles,
// French names, live regions and where the focus goes. There is no screen
// reader here: the accessibility tree, ARIA attributes and the live regions'
// text stand in for one.

type Setup = {
  owner: TestUser;
  expert: TestUser;
  /** A viewer the owner removes from the workspace. */
  viewer: TestUser;
  workspaceId: string;
  reportId: string;
  sectionId: string;
};

let setup: Setup;

const NOTES = `## Mesures

La salle serveur consomme 12 MWh par an. La climatisation tourne toute la nuit.`;

test.beforeAll(async () => {
  const [owner, expert, viewer] = await Promise.all([
    createTestUser("Clara Clavier"),
    createTestUser("Eloi Expert"),
    createTestUser("Vito Lecteur"),
  ]);
  const {
    api,
    workspace_id: workspaceId,
    report_id: reportId,
  } = await createWorkspaceFor(owner, "Clavier Abomey");
  const { error: memberError } = await adminClient()
    .from("workspace_members")
    .insert([
      { workspace_id: workspaceId, user_id: expert.id, role: "expert" },
      { workspace_id: workspaceId, user_id: viewer.id, role: "viewer" },
    ]);
  if (memberError) throw memberError;
  const { data: section, error } = await api
    .from("report_sections")
    .insert({
      workspace_id: workspaceId,
      report_id: reportId,
      title: "Synthèse des relevés",
      assigned_to: expert.id,
    })
    .select("id")
    .single();
  if (error || !section) throw error ?? new Error("Could not create the section");
  await addParsedDeliverable(workspaceId, section.id, expert.id, "mesures-salle.md", NOTES);
  setup = { owner, expert, viewer, workspaceId, reportId, sectionId: section.id };
});

function sectionUrl() {
  return `/fr/espaces/${setup.workspaceId}/sections/${setup.sectionId}`;
}

/** What has the focus, for error messages. */
function focusedElement(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return "body";
    const name = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 50);
    return `${element.tagName.toLowerCase()} "${name ?? ""}"`;
  });
}

async function isFocused(target: Locator) {
  return target
    .evaluate((element) => element === document.activeElement, undefined, { timeout: 1_000 })
    .catch(() => false);
}

/** Presses Tab (or Shift+Tab) until `target` has the focus, so it is reachable from the keyboard. */
async function tabTo(page: Page, target: Locator, { backwards = false, max = 80 } = {}) {
  const visited: string[] = [];
  for (let step = 0; step < max; step++) {
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
    if (await isFocused(target)) return;
    visited.push(await focusedElement(page));
  }
  throw new Error(`Tab never reached the target. Visited: ${visited.join(" → ")}`);
}

/**
 * Whether the focused element shows a focus indicator: a visible outline or a
 * Tailwind ring (a box-shadow with no offset and a spread).
 */
async function focusIndicator(page: Page) {
  // Rings fade in with a transition: read the style once it has ended.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .every((animation) => animation.playState !== "running"),
  );
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return { visible: false, element: "body" };
    const opaque = (color: string) => color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color);
    const shows = (style: CSSStyleDeclaration) =>
      (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0 && opaque(style.outlineColor)) ||
      [...style.boxShadow.matchAll(/(rgba?\([^)]*\)) 0px 0px 0px (\d+(?:\.\d+)?)px/g)].some(
        (match) => parseFloat(match[2] ?? "0") >= 1 && opaque(match[1] ?? ""),
      );
    // Card links draw their ring on ::after, over the whole card.
    const visible = [null, "::before", "::after"].some((pseudo) => shows(getComputedStyle(element, pseudo)));
    const name = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 50) ?? "";
    return { visible, element: `${element.tagName.toLowerCase()} "${name}"` };
  });
}

/**
 * Records the text of every live region (role status, alert or log, or
 * aria-live) each time it changes: what a screen reader would announce.
 */
async function recordAnnouncements(page: Page) {
  await page.addInitScript(() => {
    const live = '[role="status"], [role="alert"], [role="log"], [aria-live]:not([aria-live="off"])';
    const last = new WeakMap<Element, string>();
    const record: string[] = [];
    (window as unknown as { announcements: string[] }).announcements = record;
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const node = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        const region = node?.closest(live);
        if (!region) continue;
        const text = region.textContent?.trim() ?? "";
        if (text && last.get(region) !== text) record.push(text);
        last.set(region, text);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { announcements: string[] }).announcements);
}

// Words a French page should never expose to assistive tech. Library
// defaults, like cmdk's "Suggestions", are the usual source.
const ENGLISH =
  /\b(Close|Open|Search|Loading|Suggestions|Submit|Toggle|Previous|Next|Dismiss|Delete|Remove|Settings|Skip to|Command Menu|Show|Hide|Upload|Download|Cancel|Save|Edit|Back|Sidebar|Dialog|Untitled|Clear|Copy|Choose|Required|Warning|Success)\b/;

/** The accessibility tree and the naming attributes of the page, minus link targets. */
async function exposedText(page: Page) {
  const tree = (await page.locator("body").ariaSnapshot())
    .split("\n")
    .filter((line) => !line.trim().startsWith("- /url:"));
  const attributes = await page.evaluate(() => {
    const names = ["aria-label", "title", "alt", "placeholder", "aria-roledescription", "aria-valuetext"];
    return Array.from(document.querySelectorAll(names.map((name) => `[${name}]`).join(","))).flatMap(
      (element) => names.map((name) => element.getAttribute(name) ?? "").filter(Boolean),
    );
  });
  return [...tree, ...attributes];
}

async function expectNoEnglish(page: Page, label: string) {
  const english = (await exposedText(page)).filter((text) => ENGLISH.test(text));
  expect.soft(english, `English text exposed on ${label}`).toEqual([]);
}

test("sign-in works from the keyboard and announces errors next to the fields", async ({ page }) => {
  await page.goto("/fr/connexion");

  // Every control, in the order they show on screen.
  const order = [
    page.getByRole("link", { name: "KolabReport, accueil" }),
    page.getByRole("textbox", { name: "Adresse e-mail" }),
    page.getByRole("link", { name: "Mot de passe oublié ?" }),
    page.getByLabel("Mot de passe", { exact: true }),
    page.getByRole("button", { name: "Afficher le mot de passe" }),
    page.getByRole("button", { name: "Se connecter" }),
    page.getByRole("link", { name: "Créer un compte" }),
    page.getByRole("link", { name: "Retour à l'accueil" }),
  ];
  for (const control of order) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    expect.soft((await focusIndicator(page)).visible, await focusedElement(page)).toBe(true);
  }
  for (const control of order.slice(0, -1).reverse()) {
    await page.keyboard.press("Shift+Tab");
    await expect(control).toBeFocused();
  }

  const email = page.getByRole("textbox", { name: "Adresse e-mail" });
  const password = page.getByLabel("Mot de passe", { exact: true });
  const main = page.getByRole("main");

  // Enter on an empty form: the address is the field to fix.
  await page.keyboard.press("Tab");
  await expect(email).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("alert")).toHaveText(
    "Veuillez saisir une adresse e-mail valide et un mot de passe.",
  );
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAccessibleDescription(
    "Veuillez saisir une adresse e-mail valide et un mot de passe.",
  );

  // The show password toggle keeps its name and says whether it is pressed.
  await page.keyboard.type(setup.owner.email);
  await tabTo(page, password);
  await page.keyboard.type("pas-le-bon-mot-de-passe");
  const toggle = page.getByRole("button", { name: "Afficher le mot de passe" });
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(password).toHaveAttribute("type", "text");
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // Wrong password: one generic message, tied to both fields, and the
  // focus back on the password, the field to type again.
  await page.keyboard.press("Shift+Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("alert")).toHaveText("Adresse e-mail ou mot de passe incorrect.");
  await expect(password).toBeFocused();
  await expect(password).toHaveValue("");
  await expect(email).toHaveValue(setup.owner.email);
  for (const field of [email, password]) {
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription("Adresse e-mail ou mot de passe incorrect.");
  }

  await page.keyboard.type(setup.owner.password);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/fr/tableau-de-bord");
  await expect(page).toHaveTitle("Tableau de bord · KolabReport");
  // Next.js reads the new page name to screen readers after a client navigation:
  // the title, or the h1 when the title is not set yet. Next.js 16 often sets
  // the title after it checks, so the h1 is read (KRB-207).
  await expect(page.locator("#__next-route-announcer__")).toHaveText(/^Tableau de bord( · KolabReport)?$/);
});

test("sign-up and password reset put the focus on the field to fix", async ({ page }) => {
  await page.goto("/fr/inscription");
  const name = page.getByRole("textbox", { name: "Nom complet" });
  await tabTo(page, name);
  await page.keyboard.press("Enter");
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Indiquez votre nom.");
  const password = page.getByLabel("Mot de passe", { exact: true });
  await expect(password).toHaveAccessibleDescription("Le mot de passe doit faire au moins 10 caractères.");

  await page.goto("/fr/mot-de-passe-oublie");
  const email = page.getByRole("textbox", { name: "Adresse e-mail" });
  await tabTo(page, email);
  await page.keyboard.type("pas-une-adresse");
  await page.keyboard.press("Enter");
  await expect(email).toBeFocused();
  await expect(email).toHaveAccessibleDescription("Saisissez une adresse e-mail valide.");
});

test("signed-in pages have a skip link, landmarks, French titles and visible focus", async ({ page }) => {
  // About a hundred tab stops are checked one by one.
  test.slow();
  await signIn(page, setup.owner);
  await page.goto("/fr/tableau-de-bord");

  await test.step("skip link", async () => {
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Aller au contenu principal" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    // The next Tab goes into the page content, past the navigation.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("main").getByRole("link", { name: "Gérer les membres" })).toBeFocused();
  });

  await test.step("landmarks", async () => {
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Navigation de l'application" })).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("banner")).toMatchAriaSnapshot(`
      - banner:
        - link "KolabReport, tableau de bord"
        - link /^Notifications/
        - button /^Espace de travail actuel/
        - button /^Rechercher/
        - navigation "Navigation de l'application":
          - list:
            - listitem:
              - link "Tableau de bord"
            - listitem:
              - link "Modèles de prompts"
            - listitem:
              - link "Pilotage de l'IA"
          - paragraph: Sections
          - list:
            - listitem:
              - link "Non commencées"
            - listitem:
              - link "En cours"
            - listitem:
              - link "Terminées"
        - link "Mon compte"
        - link "Guide d'utilisation"
        - button /^Thème/
        - button "Se déconnecter"
        - button "Réduire le menu" [expanded]
    `);
  });

  await test.step("unique French titles", async () => {
    const { workspaceId, reportId } = setup;
    const pages: Array<[string, string]> = [
      ["/fr/tableau-de-bord", "Tableau de bord · KolabReport"],
      [`/fr/espaces/${workspaceId}/membres`, "Membres · KolabReport"],
      [`/fr/rapports/${reportId}`, "Rapport Clavier Abomey · KolabReport"],
      [sectionUrl(), "Synthèse des relevés · KolabReport"],
      [`/fr/espaces/${workspaceId}/modeles`, "Modèles de prompts · KolabReport"],
      [`/fr/espaces/${workspaceId}/ia`, "Pilotage de l'IA · KolabReport"],
      ["/fr/notifications", "Notifications · KolabReport"],
      ["/fr/compte", "Mon compte · KolabReport"],
      ["/fr/espaces/nouveau", "Nouvel espace de travail · KolabReport"],
    ];
    const titles: string[] = [];
    for (const [url, title] of pages) {
      await page.goto(url);
      await expect.soft(page, url).toHaveTitle(title);
      titles.push(await page.title());
    }
    expect(new Set(titles).size).toBe(titles.length);
  });

  await test.step("every tab stop shows its focus", async () => {
    for (const url of ["/fr/tableau-de-bord", `/fr/rapports/${setup.reportId}`, sectionUrl()]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const missing: string[] = [];
      for (let step = 0; step < 40; step++) {
        await page.keyboard.press("Tab");
        const indicator = await focusIndicator(page);
        if (indicator.element === "body") break;
        if (!indicator.visible) missing.push(indicator.element);
      }
      expect.soft(missing, `tab stops without a focus indicator on ${url}`).toEqual([]);
    }
  });

  await test.step("phone layout", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr/tableau-de-bord");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Aller au contenu principal" })).toBeFocused();
    const menuButton = page.getByRole("button", { name: "Ouvrir le menu" });
    await page.keyboard.press("Tab");
    await expect(menuButton).toBeFocused();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("navigation", { name: "Navigation de l'application" })).toBeVisible();
    await expect(page.locator(":focus")).toBeAttached();
    expect(await menu.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(menuButton).toBeFocused();
  });
});

test("menus, dialogs and the command palette are labelled and give the focus back", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto("/fr/tableau-de-bord");
  const banner = page.getByRole("banner");

  await test.step("theme menu", async () => {
    const trigger = banner.getByRole("button", { name: /^Thème/ });
    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: /^Thème/ });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio")).toHaveText(["Clair", "Sombre", "Système"]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  await test.step("workspace menu", async () => {
    const trigger = banner.getByRole("button", { name: "Espace de travail actuel : Clavier Abomey", exact: true });
    await tabTo(page, trigger, { backwards: true });
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: /^Espace de travail actuel/ });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: /Clavier Abomey/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  await test.step("command palette", async () => {
    const trigger = banner.getByRole("button", { name: "Rechercher", exact: true });
    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const palette = page.getByRole("dialog", { name: "Palette de commandes" });
    await expect(palette).toBeVisible();
    await expect(palette).toHaveAccessibleDescription(
      "Recherchez une page, un espace de travail, un filtre ou une action, puis validez avec Entrée.",
    );
    await expect(palette.getByRole("combobox", { name: "Rechercher une action ou un espace" })).toBeFocused();
    await expect(palette.getByRole("listbox", { name: "Actions proposées" })).toBeVisible();
    await expectNoEnglish(page, "the command palette");
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Ctrl+K from anywhere, and a command run with Enter.
    await page.keyboard.press("Control+K");
    await expect(palette).toBeVisible();
    await page.keyboard.type("sombre");
    await expect(palette.getByRole("option", { name: "Passer au thème sombre" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Enter");
    await expect(palette).toHaveCount(0);
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(trigger).toBeFocused();
  });

  await test.step("remove member dialog", async () => {
    const { viewer } = setup;
    await page.goto(`/fr/espaces/${setup.workspaceId}/membres`);
    const trigger = page.getByRole("button", { name: `Retirer ${viewer.name} de l'espace de travail` });
    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `Retirer ${viewer.name} ?` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(/n'aura plus accès à cet espace de travail/);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Confirmed: the row goes away, the focus moves to the list and the change is announced.
    await page.keyboard.press("Enter");
    await tabTo(page, dialog.getByRole("button", { name: "Retirer", exact: true }));
    await page.keyboard.press("Enter");
    const members = page.getByRole("region", { name: "Membres", exact: true });
    await expect(members.getByText(viewer.email)).toHaveCount(0);
    await expect(members.getByRole("heading", { name: "Membres", exact: true })).toBeFocused();
    await expect(members.getByRole("status").first()).toHaveText(
      `${viewer.name} ne fait plus partie de l'espace de travail.`,
    );
  });
});

test("a manager adds and assigns a section from the keyboard", async ({ page }) => {
  await signIn(page, setup.owner);
  await page.goto(`/fr/rapports/${setup.reportId}`);
  const field = page.getByRole("textbox", { name: "Nouvelle section" });
  await tabTo(page, field);
  await page.keyboard.type("Annexes techniques");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Section « Annexes techniques »" })).toHaveText(
    "Section « Annexes techniques » ajoutée à la fin du rapport.",
  );
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");

  // The new row's expert select, then its save button.
  const expert = page.getByRole("combobox", { name: "Expert de la section Annexes techniques" });
  await tabTo(page, expert);
  // Type-ahead on the closed select, as on any native select.
  await page.keyboard.type("Eloi");
  await expect(expert).toHaveValue(setup.expert.id);
  const form = page.locator("form").filter({ has: expert });
  const save = form.getByRole("button", { name: "Enregistrer" });
  await tabTo(page, save);
  await page.keyboard.press("Enter");
  await expect(form.getByRole("status")).toHaveText("Enregistré.");
  // Saved: nothing left to save, but the button keeps the focus.
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await expect(save).toBeFocused();
});

test("nothing in English reaches assistive tech", async ({ page }) => {
  await page.goto("/fr/connexion");
  await expectNoEnglish(page, "/fr/connexion");
  await signIn(page, setup.owner);
  for (const url of [
    "/fr/tableau-de-bord",
    `/fr/rapports/${setup.reportId}`,
    sectionUrl(),
    `/fr/espaces/${setup.workspaceId}/membres`,
    `/fr/espaces/${setup.workspaceId}/modeles`,
    "/fr/notifications",
  ]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoEnglish(page, url);
  }
  // Menus and dialogs render in portals, outside the page content.
  await page.goto("/fr/tableau-de-bord");
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Thème/ })
    .click();
  await expectNoEnglish(page, "the theme menu");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expectNoEnglish(page, "the phone menu");
});

test("the upload zone works from the keyboard and announces each result", async ({ page }) => {
  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  const zone = page.getByRole("region", { name: "Déposer des livrables" });
  const choose = zone.getByRole("button", { name: "Choisir des fichiers" });
  const log = zone.getByRole("log");

  // One control for screen readers: the file input itself is hidden.
  await expect(zone.getByRole("button", { name: "Choisir des fichiers" })).toHaveCount(1);
  // Only the log speaks: the progress list would read every percent.
  await expect(zone.locator("[aria-live]")).toHaveCount(0);

  await tabTo(page, choose);
  expect((await focusIndicator(page)).visible).toBe(true);
  let chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (
    await chooser
  ).setFiles({ name: "outil.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") });
  await expect(log).toHaveText("outil.exe n'a pas été ajouté : Ce type de fichier n'est pas accepté.");
  await expect(choose).toBeFocused();

  chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Space");
  await (await chooser).setFiles({ name: "vide.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) });
  await expect(log).toContainText("vide.txt n'a pas été ajouté : Ce fichier est vide.");
  // The visible list says it too, next to each file.
  await expect(zone.getByText("Ce type de fichier n'est pas accepté.", { exact: true })).toBeVisible();
  await expect(zone.getByText("Ce fichier est vide.", { exact: true })).toBeVisible();
});

test("an accepted upload is announced and the new file is reachable", async ({ page }) => {
  // Needs the Storage container. CI runs it; it is never skipped there.
  const storageUp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/status`)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!process.env.CI && !storageUp, "Storage does not run in the local stack");

  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  const zone = page.getByRole("region", { name: "Déposer des livrables" });
  const log = zone.getByRole("log");
  await tabTo(page, zone.getByRole("button", { name: "Choisir des fichiers" }));
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (
    await chooser
  ).setFiles({ name: "notes-terrain.md", mimeType: "text/markdown", buffer: Buffer.from(NOTES) });
  await expect(log).toContainText("Envoi de notes-terrain.md en cours.");
  await expect(log).toContainText("notes-terrain.md ajouté à la section.");

  const files = page.getByRole("main").getByRole("region", { name: "Livrables", exact: true });
  const download = files.getByRole("link", { name: "Télécharger notes-terrain.md" });
  await expect(download).toBeVisible();
  await tabTo(page, download);
});

test("deleting a file asks in a dialog and puts the focus on the list", async ({ page }) => {
  const name = "brouillon-a-supprimer.md";
  await addParsedDeliverable(setup.workspaceId, setup.sectionId, setup.expert.id, name, NOTES);
  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  const files = page.getByRole("main").getByRole("region", { name: "Livrables", exact: true });
  const trigger = files.getByRole("button", { name: `Supprimer ${name}` });

  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Supprimer ${name} ?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(/retiré de la section/);
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  // Escape keeps the file and gives the focus back.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(files.getByText(name, { exact: true })).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Supprimer", exact: true });
  await tabTo(page, confirm);
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(files.getByText(name, { exact: true })).toHaveCount(0);
  await expect(files.getByRole("heading", { name: "Livrables" })).toBeFocused();
  await expect(files.getByRole("status")).toHaveText(`${name} a été supprimé.`);
});

test("the end of a file's read is announced", async ({ page }) => {
  // A file being read, as the parse job leaves it; then the job "finishes".
  const name = "lecture-en-cours.md";
  const id = await addParsedDeliverable(setup.workspaceId, setup.sectionId, setup.expert.id, name, NOTES);
  const admin = adminClient();
  const { error } = await admin
    .from("deliverables")
    .update({ parse_status: "processing", parsed_content: null, parsed_at: null })
    .eq("id", id);
  if (error) throw error;

  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  const files = page.getByRole("main").getByRole("region", { name: "Livrables", exact: true });
  await expect(files.getByText("En cours", { exact: true })).toBeVisible();

  const { error: doneError } = await admin
    .from("deliverables")
    .update({ parse_status: "parsed", parsed_content: NOTES, parsed_at: new Date().toISOString() })
    .eq("id", id);
  if (doneError) throw doneError;
  // The page refreshes every 3 s while a file is being read.
  await expect(files.getByRole("status")).toHaveText(`${name} : fichier analysé, prêt pour le brouillon.`, {
    timeout: 15_000,
  });
});

test("a draft is generated, rated, accepted and discarded from the keyboard", async ({ page }) => {
  const announcements = await recordAnnouncements(page);
  await signIn(page, setup.expert);
  await page.goto(sectionUrl());
  const main = page.getByRole("main");
  const panel = main.getByRole("region", { name: "Brouillon de l'IA" });
  const generate = panel.getByRole("button", { name: "Générer un brouillon" });
  const status = panel.getByRole("status").first();

  await test.step("generate", async () => {
    await expect(panel.getByRole("combobox", { name: "Modèle de prompt" })).toBeVisible();
    await tabTo(page, generate);
    expect((await focusIndicator(page)).visible).toBe(true);
    await page.keyboard.press("Enter");
    await expect(status).toHaveText("Brouillon prêt. Relisez-le avant de l'accepter.");
    // The focus goes to the proposal once it is in.
    await expect(panel.getByRole("heading", { name: "Brouillon proposé" })).toBeFocused();

    const heard = await announcements();
    // "En cours", then done: polite status lines, never the streamed text.
    expect(heard.some((text) => /Préparation du brouillon|Rédaction du brouillon/.test(text))).toBe(true);
    expect(heard).toContain("Brouillon prêt. Relisez-le avant de l'accepter.");
    expect(heard.filter((text) => /Les livrables fournis|état des lieux/.test(text))).toEqual([]);
    expect(heard.length).toBeLessThan(10);
    await expect(panel.getByRole("alert")).toHaveCount(0);
  });

  await test.step("switch views with the arrow keys", async () => {
    const preview = panel.getByRole("tab", { name: "Aperçu" });
    await tabTo(page, preview);
    await expect(preview).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    const diff = panel.getByRole("tab", { name: "Différences" });
    await expect(diff).toBeFocused();
    await expect(diff).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("tabpanel", { name: "Différences" })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(preview).toBeFocused();
  });

  await test.step("rate", async () => {
    const useful = panel.getByRole("button", { name: "Utile", exact: true });
    await tabTo(page, useful);
    await page.keyboard.press("Space");
    await expect(useful).toHaveAttribute("aria-pressed", "true");
    await tabTo(page, panel.getByRole("textbox", { name: "Commentaire (facultatif)" }));
    await page.keyboard.type("Bonne base, à compléter.");
    const send = panel.getByRole("button", { name: "Envoyer mon avis" });
    await tabTo(page, send);
    await page.keyboard.press("Enter");
    await expect(panel.getByRole("status").filter({ hasText: "Avis enregistré." })).toBeVisible();
    // Saved: the button says it is disabled but keeps the focus.
    await expect(send).toHaveAttribute("aria-disabled", "true");
    await expect(send).toBeFocused();
  });

  await test.step("accept", async () => {
    await tabTo(page, panel.getByRole("button", { name: "Accepter", exact: true }), { backwards: true });
    await page.keyboard.press("Enter");
    await expect(status).toHaveText("Brouillon accepté. Il remplace maintenant le contenu de la section.");
    await expect(main.getByRole("heading", { name: "Contenu de la section" })).toBeFocused();
    await expect(main.getByText("Les livrables fournis décrivent la situation étudiée.")).toBeVisible();
  });

  await test.step("discard", async () => {
    await tabTo(page, generate);
    await page.keyboard.press("Enter");
    await expect(panel.getByRole("heading", { name: "Brouillon proposé" })).toBeFocused();
    await tabTo(page, panel.getByRole("button", { name: "Rejeter" }));
    await page.keyboard.press("Enter");
    await expect(
      panel.getByText("Rejeter ce brouillon ? Le contenu de la section ne change pas."),
    ).toBeVisible();
    // The focus lands on the safe choice.
    await expect(panel.getByRole("button", { name: "Annuler" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(panel.getByRole("button", { name: "Confirmer le rejet" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(status).toHaveText("Brouillon rejeté. Le contenu de la section n'a pas changé.");
    await expect(generate).toBeFocused();
  });

  await test.step("an error is announced and the focus stays on the button", async () => {
    await page.route("**/api/ai/sections/*/draft", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "600" },
        body: JSON.stringify({ error: "rateLimited" }),
      }),
    );
    await page.keyboard.press("Enter");
    await expect(panel.getByRole("alert")).toContainText(
      "Vous avez demandé trop de brouillons en une heure. Réessayez dans 10 minutes.",
    );
    await expect(panel.getByRole("alert")).toContainText("Le contenu de la section n'a pas changé.");
    await expect(generate).toBeFocused();
  });
});
