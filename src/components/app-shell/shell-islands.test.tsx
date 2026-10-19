import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { MobileMenu } from "./mobile-menu";
import { NavItems } from "./nav-items";
import { PaletteProvider } from "./palette";
import { SearchIconButton, SearchTrigger } from "./search-trigger";
import { WorkspaceSwitcher } from "./workspace-switcher";

// The client parts of the server-rendered shell (KRB-212): the palette
// provider and its shortcut, the menu sheet that loads on use, and the nav
// highlight that loads motion once the sidebar is used.

vi.mock("@/lib/workspaces/actions", () => ({ selectWorkspace: vi.fn() }));
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/tableau-de-bord",
}));

// The palette itself has its own tests: here, only whether it is open and on what.
vi.mock("./command-palette", () => ({
  CommandPalette: ({ open, scope }: { open: boolean; scope: string }) =>
    open ? <div role="dialog" aria-label="Palette de commandes" data-scope={scope} /> : null,
}));

// Set when the module is first imported, which is when its chunk would load.
const loaded = { menuSheet: false, navHighlight: false };
vi.mock("./menu-sheet", async (importOriginal) => {
  loaded.menuSheet = true;
  return importOriginal();
});
vi.mock("./nav-highlight", () => {
  loaded.navHighlight = true;
  return { SlidingHighlight: () => <span data-testid="sliding-highlight" /> };
});

const WORKSPACES: MyWorkspace[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Mission Parakou",
    organizationId: "o-zinsou",
    organizationName: "Cabinet Zinsou",
    ownsOrganization: true,
    role: "owner",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Énergie Bénin",
    organizationId: "o-agence",
    organizationName: "Agence Ahouandjinou",
    ownsOrganization: false,
    role: "expert",
  },
];

let wide = true;
beforeAll(() => {
  // Radix menus and dialogs measure themselves with ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => {
  wide = true;
  window.matchMedia = vi.fn(
    (query: string) => ({ matches: query.includes("min-width") ? wide : false }) as MediaQueryList,
  );
});
afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

function renderInShell(children: React.ReactNode) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      <PaletteProvider workspaces={WORKSPACES} currentWorkspaceId={WORKSPACES[0]!.id}>
        {children}
      </PaletteProvider>
    </NextIntlClientProvider>,
  );
  return user;
}

const palette = () => screen.queryByRole("dialog", { name: "Palette de commandes" });

describe("PaletteProvider", () => {
  it("opens the palette on Ctrl+K and Cmd+K, and closes it on the same keys", async () => {
    const user = renderInShell(<SearchTrigger />);
    expect(palette()).toBeNull();

    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog", { name: "Palette de commandes" })).toHaveAttribute(
      "data-scope",
      "all",
    );
    await user.keyboard("{Meta>}k{/Meta}");
    expect(palette()).toBeNull();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("dialog", { name: "Palette de commandes" })).toBeInTheDocument();
  });

  it("is opened by the search buttons of the sidebar and of the top bar", async () => {
    const user = renderInShell(
      <>
        <SearchTrigger />
        <SearchIconButton className="" />
      </>,
    );
    const [trigger, icon] = screen.getAllByRole("button", {
      name: "Rechercher : ouvrir la palette de commandes",
    });
    await user.click(trigger!);
    expect(await screen.findByRole("dialog", { name: "Palette de commandes" })).toHaveAttribute(
      "data-scope",
      "all",
    );
    await user.keyboard("{Control>}k{/Control}");
    await user.click(icon!);
    expect(await screen.findByRole("dialog", { name: "Palette de commandes" })).toBeInTheDocument();
  });

  it("opens on the workspace search from the switcher, which gets no callback from the server", async () => {
    const user = renderInShell(
      <WorkspaceSwitcher workspaces={WORKSPACES} currentWorkspaceId={WORKSPACES[0]!.id} />,
    );
    await user.click(screen.getByRole("button", { name: /^Espace de travail actuel : Mission Parakou/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Rechercher un espace" }));
    expect(await screen.findByRole("dialog", { name: "Palette de commandes" })).toHaveAttribute(
      "data-scope",
      "workspaces",
    );
  });
});

describe("MobileMenu", () => {
  function renderMenu() {
    return renderInShell(
      <MobileMenu
        className=""
        user={{ name: "Awa Dossou", email: "awa@example.com" }}
        workspaces={WORKSPACES}
        currentWorkspaceId={WORKSPACES[0]!.id}
        manager
        billingOrganizationId={null}
      />,
    );
  }

  it("loads the sheet when the button is used, not with the page, and opens it", async () => {
    loaded.menuSheet = false;
    const user = renderMenu();
    const button = screen.getByRole("button", { name: "Ouvrir le menu" });
    expect(loaded.menuSheet).toBe(false);
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);
    const menu = await screen.findByRole("dialog", { name: "Menu" });
    expect(loaded.menuSheet).toBe(true);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "Navigation de l'application" })).toBeInTheDocument();
    expect(menu).toHaveTextContent("Awa Dossou");
  });

  it("closes when the palette opens, as it did when one component held both", async () => {
    const user = renderMenu();
    await user.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
    await screen.findByRole("dialog", { name: "Menu" });

    await act(() => user.keyboard("{Control>}k{/Control}"));
    expect(await screen.findByRole("dialog", { name: "Palette de commandes" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull());
    expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("NavItems highlight", () => {
  function renderNav(variant: "sidebar" | "sheet") {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
        <NavItems variant={variant} workspaceId={WORKSPACES[0]!.id} manager />
      </NextIntlClientProvider>,
    );
    return { user, dashboard: screen.getByRole("link", { name: "Tableau de bord" }) };
  }

  it("is a plain span on load, and loads the sliding one when the pointer reaches the sidebar", async () => {
    loaded.navHighlight = false;
    const { user, dashboard } = renderNav("sidebar");
    expect(dashboard).toHaveAttribute("aria-current", "page");
    expect(loaded.navHighlight).toBe(false);
    expect(screen.queryByTestId("sliding-highlight")).toBeNull();

    await user.hover(dashboard);
    expect(await screen.findByTestId("sliding-highlight")).toBeInTheDocument();
    expect(loaded.navHighlight).toBe(true);
  });

  it("loads it on keyboard focus too", async () => {
    const { user } = renderNav("sidebar");
    await user.tab();
    expect(await screen.findByTestId("sliding-highlight")).toBeInTheDocument();
  });

  it("never loads it below lg", async () => {
    wide = false;
    const { user, dashboard } = renderNav("sidebar");
    await user.hover(dashboard);
    await user.tab();
    expect(screen.queryByTestId("sliding-highlight")).toBeNull();
  });

  it("never loads it in the menu sheet, which closes on navigation", async () => {
    const { user, dashboard } = renderNav("sheet");
    await user.hover(dashboard);
    await user.tab();
    expect(screen.queryByTestId("sliding-highlight")).toBeNull();
  });
});
