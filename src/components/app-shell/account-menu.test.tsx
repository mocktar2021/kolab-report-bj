import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import type { AccountMenuProps } from "./account-menu";

// The account menu, top right (KRB-227), and its install item (KRB-205).

const signOut = vi.fn();
vi.mock("@/lib/auth/actions", () => ({ signOut: () => signOut() }));
const clearOfflineCaches = vi.fn();
vi.mock("@/lib/pwa/clear-offline-caches", () => ({ clearOfflineCaches: () => clearOfflineCaches() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/compte",
}));

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const AWA = { name: "Awa Dossou", email: "awa@example.com" };

beforeAll(() => {
  // Radix menus and dialogs measure themselves with ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => {
  window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList);
  signOut.mockReset();
  clearOfflineCaches.mockReset();
});
afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
  delete document.documentElement.dataset.sidebar;
  vi.restoreAllMocks();
});

// lib/pwa/install keeps the browser's event in module state: each test loads
// fresh copies of it and of the menu.
async function renderMenu(props: Partial<AccountMenuProps> = {}) {
  vi.resetModules();
  const { AccountMenu } = await import("./account-menu");
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <AccountMenu user={AWA} variant="pill" {...props} />
    </NextIntlClientProvider>,
  );
  return user;
}

const button = () => screen.getByRole("button", { name: "Menu du compte" });

// user-event clicks the element it is given, even once the menu's own button
// has replaced it: wait for that one, which Radix marks with data-state.
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.hover(button());
  await waitFor(() => expect(button()).toHaveAttribute("data-state", "closed"), { timeout: 5000 });
  await user.click(button());
  return screen.findByRole("menu", { name: "Menu du compte" });
}

function fireInstallEvent() {
  const prompt = vi.fn(() => Promise.resolve());
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: "accepted" as const, platform: "web" }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return prompt;
}

describe("AccountMenu", () => {
  // Only the Radix trigger sets data-state: the placeholder button has none.
  it("loads when its button is pointed at or used, not with the page", async () => {
    const user = await renderMenu();
    expect(button()).toHaveAttribute("aria-haspopup", "menu");
    expect(button()).not.toHaveAttribute("data-state");
    await user.hover(button());
    await waitFor(() => expect(button()).toHaveAttribute("data-state", "closed"), { timeout: 5000 });
  });

  it("opens on a click and lists the account items, then the legal pages", async () => {
    const user = await renderMenu({ sidebarToggle: true });
    const menu = await openMenu(user);
    expect(menu).toHaveTextContent("Awa Dossou");
    expect(menu).toHaveTextContent("awa@example.com");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Mon compte",
      "Guide d'utilisation",
      "ThèmeSystème",
      "Réduire le menu",
      "Se déconnecter",
      "Mentions légales",
      "Confidentialité",
      "Conditions d'utilisation",
      "Conditions de vente",
    ]);
    expect(within(menu).getByRole("menuitem", { name: "Mon compte" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(menu).getByRole("menuitem", { name: "Guide d'utilisation" })).toHaveAttribute(
      "href",
      "/guide",
    );
    expect(within(menu).getByRole("group", { name: "Informations légales" })).toBeInTheDocument();
  });

  it("has no sidebar item below lg, where there is no sidebar", async () => {
    const user = await renderMenu({ variant: "avatar" });
    const menu = await openMenu(user);
    expect(within(menu).queryByRole("menuitem", { name: /menu$/ })).toBeNull();
  });

  it("opens from the keyboard on its first item and gives the focus back on Escape", async () => {
    const user = await renderMenu();
    act(() => button().focus());
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu", { name: "Menu du compte" });
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "Mon compte" })).toHaveFocus());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(button()).toHaveFocus();
  });

  it("sets the theme from its submenu", async () => {
    const user = await renderMenu();
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: /^Thème/ }));
    const themes = await screen.findByRole("menu", { name: /^Thème/ });
    expect(
      within(themes)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["Clair", "Sombre", "Système"]);
  });

  it("collapses and expands the sidebar", async () => {
    const user = await renderMenu({ sidebarToggle: true });
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Réduire le menu" }));
    expect(document.documentElement.dataset.sidebar).toBe("collapsed");
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Déployer le menu" }));
    expect(document.documentElement.dataset.sidebar).toBeUndefined();
  });

  it("clears the offline copies, then signs out", async () => {
    const user = await renderMenu();
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Se déconnecter" }));
    expect(clearOfflineCaches).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});

describe("AccountMenu install item (KRB-205)", () => {
  const installItem = () => screen.queryByRole("menuitem", { name: "Installer l'application" });

  it("is not there until the browser says the app can be installed", async () => {
    const user = await renderMenu();
    await openMenu(user);
    expect(installItem()).toBeNull();
  });

  // The event comes before the menu loads: the button's own module listens.
  it("opens the browser's install dialog, then goes away", async () => {
    const user = await renderMenu();
    const prompt = fireInstallEvent();
    await openMenu(user);
    await user.click(installItem()!);
    expect(prompt).toHaveBeenCalledTimes(1);
    await openMenu(user);
    expect(installItem()).toBeNull();
  });

  it("goes away once the app is installed", async () => {
    const user = await renderMenu();
    fireInstallEvent();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    await openMenu(user);
    expect(installItem()).toBeNull();
  });

  it("shows the share menu steps on an iPhone and gives the focus back to the menu button", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(IPHONE);
    const user = await renderMenu();
    await openMenu(user);
    expect(installItem()).toHaveAttribute("aria-haspopup", "dialog");

    await user.click(installItem()!);
    const dialog = await screen.findByRole("dialog", { name: "Installer KolabReport" });
    expect(dialog).toHaveAccessibleDescription(
      "Sur iPhone et iPad, l'installation se fait depuis Safari, en trois gestes.",
    );
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "1Touchez le bouton Partager , un carré avec une flèche vers le haut.",
      "2Choisissez Sur l'écran d'accueil.",
      "3Touchez Ajouter : l'icône KolabReport arrive sur l'écran d'accueil.",
    ]);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(button()).toHaveFocus();
  });

  it("closes the steps with Fermer too", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(IPHONE);
    const user = await renderMenu();
    await openMenu(user);
    await user.click(installItem()!);
    await user.click(await screen.findByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
